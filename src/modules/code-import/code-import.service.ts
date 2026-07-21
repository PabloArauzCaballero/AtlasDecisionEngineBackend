import { createHash } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { DomainException } from '../../common/errors/domain-exception';
import { pageResult, paginationArgs } from '../../common/http/pagination';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import { ArtifactGraphWriterService } from '../artifacts/artifact-graph-writer.service';
import { ArtifactLifecycleService } from '../artifacts/artifact-lifecycle.service';
import { VariableService } from '../variables/variable.service';
import { AnalyzeCodeImportDto, CodeImportListQueryDto, SaveCodeImportDto } from './code-import.dto';
import { ContractExtractorService } from './contract-extractor.service';
import { ContractValidatorService } from './contract-validator.service';
import { GraphGeneratorService } from './graph-generator.service';
import { SecurityAnalyzerService } from './security-analyzer.service';
import { SyntaxAnalyzerService } from './syntax-analyzer.service';
import type { AnalyzeCodeImportResult, CodeImportIR, LineIssue } from './code-import.types';

/**
 * Orchestrates the Code -> Flow pipeline (Fase 5):
 * load -> validate language/size -> syntax analysis -> contract extraction ->
 * contract/variable validation -> security analysis -> build IR -> generate graph
 * -> validate graph (GraphValidatorService, via the writer's own validate step) ->
 * preview -> confirm / save draft / cancel.
 * See docs/code-to-flow-specification.md for the full narrative.
 */
@Injectable()
export class CodeImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    private readonly syntax: SyntaxAnalyzerService,
    private readonly contractExtractor: ContractExtractorService,
    private readonly contractValidator: ContractValidatorService,
    private readonly security: SecurityAnalyzerService,
    private readonly graphGenerator: GraphGeneratorService,
    private readonly variables: VariableService,
    private readonly graphWriter: ArtifactGraphWriterService,
    private readonly lifecycle: ArtifactLifecycleService,
  ) {}

  async analyze(tenantId: bigint, dto: AnalyzeCodeImportDto, principal: AuthenticatedPrincipal): Promise<AnalyzeCodeImportResult & { id: string }> {
    const maxBytes = this.config.get<number>('CODE_IMPORT_MAX_SOURCE_BYTES') ?? 131_072;
    const sourceBytes = Buffer.byteLength(dto.sourceCode, 'utf8');
    if (sourceBytes > maxBytes) {
      throw new DomainException('CODE_IMPORT_SOURCE_TOO_LARGE', `Source exceeds ${maxBytes} bytes`, HttpStatus.BAD_REQUEST);
    }

    const issues: LineIssue[] = [];
    const syntaxIssues = this.syntax.analyze(dto.language, dto.sourceCode);
    issues.push(...syntaxIssues);

    const extraction = this.contractExtractor.extract(dto.language, dto.sourceCode);
    issues.push(...extraction.issues);

    const securityIssues = this.security.analyze(dto.language, extraction.scriptBody);
    issues.push(...securityIssues);

    const contract = extraction.contract;
    if (contract) {
      issues.push(...this.contractValidator.validate(contract, dto.language, extraction.scriptBody));
    }

    const hasBlockingIssues = issues.some((issue) => issue.severity === 'ERROR');
    const ir: CodeImportIR = {
      irVersion: '1',
      language: dto.language,
      sourceChecksum: createHash('sha256').update(dto.sourceCode).digest('hex'),
      contract: contract ?? { contractVersion: '1', inputs: [], outputs: [] },
      scriptBody: extraction.scriptBody,
    };
    const generatedGraph = hasBlockingIssues
      ? { dependencies: [], nodes: [], edges: [] }
      : this.graphGenerator.generate(ir);

    const record = await this.prisma.decisionCodeImport.create({
      data: {
        tenantId,
        artifactId: dto.artifactId ? BigInt(dto.artifactId) : undefined,
        language: dto.language,
        sourceCode: dto.sourceCode,
        sourceChecksum: ir.sourceChecksum,
        contractVersion: ir.contract.contractVersion,
        contractJson: ir.contract as unknown as Prisma.InputJsonValue,
        irJson: ir as unknown as Prisma.InputJsonValue,
        issuesJson: issues as unknown as Prisma.InputJsonValue,
        status: 'ANALYZED',
        createdBy: principal.id,
      },
    });
    await this.audit.append({
      tenantId,
      eventType: 'CODE_IMPORT_ANALYZED',
      aggregateType: 'DecisionCodeImport',
      aggregateId: record.id.toString(),
      actorId: principal.id,
      requestId: principal.requestId,
      payload: { language: dto.language, issueCount: issues.length, hasBlockingIssues },
    });

    return { id: record.id.toString(), ir, issues, generatedGraph };
  }

  async get(tenantId: bigint, id: bigint) {
    const record = await this.prisma.decisionCodeImport.findFirst({ where: { id, tenantId } });
    if (!record) throw new DomainException('CODE_IMPORT_NOT_FOUND', 'Code import not found', HttpStatus.NOT_FOUND);
    return record;
  }

  async list(tenantId: bigint, query: CodeImportListQueryDto) {
    const paging = paginationArgs(query, this.config.get<number>('MAX_PAGE_SIZE') ?? 100);
    const where: Prisma.DecisionCodeImportWhereInput = {
      tenantId,
      ...(query.artifactVersionId ? { artifactVersionId: BigInt(query.artifactVersionId) } : {}),
    };
    const [total, items] = await this.prisma.$transaction([
      this.prisma.decisionCodeImport.count({ where }),
      this.prisma.decisionCodeImport.findMany({
        where,
        skip: paging.skip,
        take: paging.take,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    ]);
    return pageResult(items, total, paging.page, paging.pageSize);
  }

  async saveDraft(tenantId: bigint, id: bigint, dto: SaveCodeImportDto, principal: AuthenticatedPrincipal) {
    return this.writeToArtifact(tenantId, id, dto, principal, 'DRAFT_SAVED');
  }

  async confirm(tenantId: bigint, id: bigint, dto: SaveCodeImportDto, principal: AuthenticatedPrincipal) {
    const { record, updatedVersion } = await this.writeToArtifact(tenantId, id, dto, principal, 'CONFIRMED');
    const outcome = await this.lifecycle.validateAndCompile(tenantId, BigInt(dto.artifactVersionId), principal);
    return { record, updatedVersion, validation: outcome.validation, compiledArtifact: outcome.compiledArtifact };
  }

  async cancel(tenantId: bigint, id: bigint, principal: AuthenticatedPrincipal) {
    const record = await this.get(tenantId, id);
    const updated = await this.prisma.decisionCodeImport.update({
      where: { id: record.id },
      data: { status: 'CANCELLED' },
    });
    await this.audit.append({
      tenantId,
      eventType: 'CODE_IMPORT_CANCELLED',
      aggregateType: 'DecisionCodeImport',
      aggregateId: record.id.toString(),
      actorId: principal.id,
      requestId: principal.requestId,
      payload: {},
    });
    return updated;
  }

  private async writeToArtifact(
    tenantId: bigint,
    id: bigint,
    dto: SaveCodeImportDto,
    principal: AuthenticatedPrincipal,
    status: 'DRAFT_SAVED' | 'CONFIRMED',
  ) {
    const record = await this.get(tenantId, id);
    const issues = (record.issuesJson as unknown as LineIssue[]) ?? [];
    if (issues.some((issue) => issue.severity === 'ERROR')) {
      throw new DomainException(
        'CODE_IMPORT_HAS_BLOCKING_ISSUES',
        'This code import has unresolved errors and cannot be written to an artifact graph',
        HttpStatus.CONFLICT,
        { issues },
      );
    }
    const ir = record.irJson as unknown as CodeImportIR;
    const generatedGraph = this.graphGenerator.generate(ir);
    const versionId = BigInt(dto.artifactVersionId);

    const variableVersionIds = new Map<string, bigint>();
    for (const dependency of generatedGraph.dependencies) {
      const variableVersionId = await this.resolveVariableVersion(
        tenantId,
        dependency.variableCode,
        dependency.dataType,
        principal,
      );
      variableVersionIds.set(dependency.variableCode, variableVersionId);
    }

    const replaceGraphDto = {
      dependencies: generatedGraph.dependencies.map((dependency) => ({
        variableVersionId: variableVersionIds.get(dependency.variableCode)!.toString(),
        usageType: dependency.usageType,
        isRequired: dependency.required,
        fallbackPolicy: 'FAIL_CLOSED',
        dependencyPath: dependency.dependencyPath,
      })),
      conditions: [],
      actions: [],
      nodes: generatedGraph.nodes.map((node, index) => ({
        key: node.key,
        type: node.type,
        label: node.label,
        config: node.config,
        x: index * 200,
        y: 0,
        order: index + 1,
        terminal: node.type === 'RESULT',
        conditions: [],
        actions: [],
      })),
      edges: generatedGraph.edges.map((edge) => ({
        key: edge.key,
        from: edge.from,
        to: edge.to,
        type: 'DEFAULT',
        priority: 1,
        default: edge.default,
        conditions: [],
      })),
    };

    const updatedVersion = await this.graphWriter.replaceDraftGraph(
      tenantId,
      versionId,
      dto.expectedLockVersion,
      replaceGraphDto,
      principal,
    );

    const updatedRecord = await this.prisma.decisionCodeImport.update({
      where: { id: record.id },
      data: { artifactVersionId: versionId, status },
    });
    await this.audit.append({
      tenantId,
      eventType: status === 'CONFIRMED' ? 'CODE_IMPORT_CONFIRMED' : 'CODE_IMPORT_DRAFT_SAVED',
      aggregateType: 'DecisionCodeImport',
      aggregateId: record.id.toString(),
      actorId: principal.id,
      requestId: principal.requestId,
      payload: { artifactVersionId: versionId.toString() },
    });

    return { record: updatedRecord, updatedVersion };
  }

  /** Finds an existing variable definition by code within the tenant, or provisions
   *  a minimal one — the contract is the source of truth for id/type/required, so a
   *  fresh variable just needs a definition + one version to exist for the graph
   *  writer's dependency check to pass. */
  private async resolveVariableVersion(
    tenantId: bigint,
    variableCode: string,
    dataType: string,
    principal: AuthenticatedPrincipal,
  ): Promise<bigint> {
    const existing = await this.prisma.decisionVariableDefinition.findFirst({
      where: { tenantId, variableCode },
      include: { versions: { orderBy: { versionNumber: 'desc' }, take: 1 } },
    });
    if (existing?.versions[0]) return existing.versions[0].id;

    const created = await this.variables.createDefinition(
      tenantId,
      {
        variableCode,
        canonicalName: variableCode,
        businessDescription: `Auto-provisioned from a Code -> Flow import for ${variableCode}.`,
        dataClassification: 'INTERNAL',
        ownerTeam: 'CODE_IMPORT',
        isSensitive: false,
        initialVersion: {
          dataType,
          nullable: false,
          sources: [],
          validationRules: [],
        },
      },
      principal,
    );
    return created.versions[0].id;
  }
}
