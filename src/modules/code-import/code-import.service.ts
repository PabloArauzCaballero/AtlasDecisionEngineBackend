import { createHash } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { layoutSeedNodes } from '../../common/graph/tree-layout';
import { DomainException } from '../../common/errors/domain-exception';
import { pageResult, paginationArgs } from '../../common/http/pagination';
import { parseBigIntId } from '../../common/http/id';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import { normalizeDataTypeOrString } from '../../common/contracts/data-types';
import { ArtifactGraphWriterService } from '../artifacts/artifact-graph-writer.service';
import { ArtifactLifecycleService } from '../artifacts/artifact-lifecycle.service';
import { BranchExtractorService } from './branch-extractor.service';
import { AnalyzeCodeImportDto, CodeImportListQueryDto, SaveCodeImportDto } from './code-import.dto';
import { ContractExtractorService } from './contract-extractor.service';
import { ContractValidatorService } from './contract-validator.service';
import { GraphGeneratorService } from './graph-generator.service';
import { SecurityAnalyzerService } from './security-analyzer.service';
import { SyntaxAnalyzerService } from './syntax-analyzer.service';
import type {
  AnalyzeCodeImportResult,
  CodeImportIR,
  GeneratedGraphPreview,
  LineIssue,
} from './code-import.types';

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
    private readonly branches: BranchExtractorService,
    private readonly contractExtractor: ContractExtractorService,
    private readonly contractValidator: ContractValidatorService,
    private readonly security: SecurityAnalyzerService,
    private readonly graphGenerator: GraphGeneratorService,
    private readonly graphWriter: ArtifactGraphWriterService,
    private readonly lifecycle: ArtifactLifecycleService,
  ) {}

  async analyze(
    tenantId: bigint,
    dto: AnalyzeCodeImportDto,
    principal: AuthenticatedPrincipal,
  ): Promise<AnalyzeCodeImportResult & { id: string }> {
    const maxBytes = this.config.get<number>('CODE_IMPORT_MAX_SOURCE_BYTES') ?? 131_072;
    const sourceBytes = Buffer.byteLength(dto.sourceCode, 'utf8');
    if (sourceBytes > maxBytes) {
      throw new DomainException(
        'CODE_IMPORT_SOURCE_TOO_LARGE',
        `Source exceeds ${maxBytes} bytes`,
        HttpStatus.BAD_REQUEST,
      );
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
      issues.push(
        ...this.contractValidator.validate(contract, dto.language, extraction.scriptBody),
      );
    }

    const hasBlockingIssues = issues.some((issue) => issue.severity === 'ERROR');
    const ir: CodeImportIR = {
      irVersion: '1',
      language: dto.language,
      sourceChecksum: createHash('sha256').update(dto.sourceCode).digest('hex'),
      contract: contract ?? { contractVersion: '1', inputs: [], outputs: [] },
      scriptBody: extraction.scriptBody,
    };
    // Se intenta derivar el árbol de decisión del código; si no es traducible se
    // avisa con el motivo exacto y se cae al nodo de script (nunca a medias).
    if (contract && !hasBlockingIssues) {
      const derived = this.branches.extract(dto.language, extraction.scriptBody, contract);
      ir.branches = derived.branches;
      if (derived.unsupported) issues.push(derived.unsupported);
    }
    const generatedGraph = hasBlockingIssues
      ? { dependencies: [], nodes: [], edges: [] }
      : this.graphGenerator.generate(ir, await this.reasonCodeCatalog(tenantId));
    // El catálogo se comprueba DESPUÉS de generar el grafo, y sus errores no
    // entran en `hasBlockingIssues`: una variable sin declarar tiene que poder
    // verse en la vista previa, porque para declararla bien hay que saber qué
    // pide el algoritmo. Lo que sí impide es escribirla en un artefacto:
    // `writeToArtifact` rechaza cualquier import con errores guardados.
    issues.push(...(await this.catalogIssues(tenantId, generatedGraph.dependencies)));

    const record = await this.prisma.$transaction(async (tx) => {
      const created = await tx.decisionCodeImport.create({
        data: {
          tenantId,
          artifactId: dto.artifactId ? parseBigIntId(dto.artifactId, 'artifactId') : undefined,
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
      await this.audit.append(
        {
          tenantId,
          eventType: 'CODE_IMPORT_ANALYZED',
          aggregateType: 'DecisionCodeImport',
          aggregateId: created.id.toString(),
          actorId: principal.id,
          requestId: principal.requestId,
          payload: { language: dto.language, issueCount: issues.length, hasBlockingIssues },
        },
        tx,
      );
      return created;
    });

    return { id: record.id.toString(), ir, issues, generatedGraph };
  }

  async get(tenantId: bigint, id: bigint) {
    const record = await this.prisma.decisionCodeImport.findFirst({ where: { id, tenantId } });
    if (!record)
      throw new DomainException(
        'CODE_IMPORT_NOT_FOUND',
        'Code import not found',
        HttpStatus.NOT_FOUND,
      );
    return record;
  }

  async list(tenantId: bigint, query: CodeImportListQueryDto) {
    const paging = paginationArgs(query, this.config.get<number>('MAX_PAGE_SIZE') ?? 100);
    const where: Prisma.DecisionCodeImportWhereInput = {
      tenantId,
      ...(query.artifactVersionId
        ? { artifactVersionId: parseBigIntId(query.artifactVersionId, 'artifactVersionId') }
        : {}),
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

  async saveDraft(
    tenantId: bigint,
    id: bigint,
    dto: SaveCodeImportDto,
    principal: AuthenticatedPrincipal,
  ) {
    return this.writeToArtifact(tenantId, id, dto, principal, 'DRAFT_SAVED');
  }

  async confirm(
    tenantId: bigint,
    id: bigint,
    dto: SaveCodeImportDto,
    principal: AuthenticatedPrincipal,
  ) {
    const { record, updatedVersion } = await this.writeToArtifact(
      tenantId,
      id,
      dto,
      principal,
      'CONFIRMED',
    );
    const outcome = await this.lifecycle.validateAndCompile(
      tenantId,
      parseBigIntId(dto.artifactVersionId, 'artifactVersionId'),
      principal,
    );
    return {
      record,
      updatedVersion,
      validation: outcome.validation,
      compiledArtifact: outcome.compiledArtifact,
    };
  }

  async cancel(tenantId: bigint, id: bigint, principal: AuthenticatedPrincipal) {
    const record = await this.get(tenantId, id);
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.decisionCodeImport.update({
        where: { id: record.id },
        data: { status: 'CANCELLED' },
      });
      await this.audit.append(
        {
          tenantId,
          eventType: 'CODE_IMPORT_CANCELLED',
          aggregateType: 'DecisionCodeImport',
          aggregateId: record.id.toString(),
          actorId: principal.id,
          requestId: principal.requestId,
          payload: {},
        },
        tx,
      );
      return updated;
    });
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
    const reasonCodes = await this.reasonCodeCatalog(tenantId);
    const generatedGraph = this.graphGenerator.generate(ir, reasonCodes);
    const versionId = parseBigIntId(dto.artifactVersionId, 'artifactVersionId');
    // Las acciones que emiten motivos necesitan el id del reason code del catálogo:
    // se referencia el que ya existe, nunca se crea uno nuevo desde una importación.
    const reasonIds = await this.reasonCodeIds(
      tenantId,
      (generatedGraph.actions ?? []).map((action) => action.reasonCode),
    );

    const variableVersionIds = await this.resolveVariableVersions(
      tenantId,
      generatedGraph.dependencies,
    );

    // El lienzo del editor coloca los nodos en porcentajes (0–100), no en píxeles:
    // se dibuja el árbol en escalera (una columna por condición, el resultado de
    // cada rama arriba y el camino "no" bajando a la siguiente).
    const layout = layoutSeedNodes(generatedGraph.nodes, generatedGraph.edges);
    const positions = generatedGraph.nodes.map((node) => layout.get(node.key) ?? { x: 38, y: 45 });
    const replaceGraphDto = {
      dependencies: generatedGraph.dependencies.map((dependency) => ({
        variableVersionId: variableVersionIds.get(dependency.variableCode)!.toString(),
        usageType: dependency.usageType,
        isRequired: dependency.required,
        fallbackPolicy: dependency.usageType === 'INPUT' ? 'FAIL_CLOSED' : 'NOT_APPLICABLE',
        dependencyPath: dependency.dependencyPath,
      })),
      conditions: (generatedGraph.conditions ?? []).map((condition) => ({
        code: condition.code,
        name: condition.name,
        expressionType: 'JSON_AST',
        expression: condition.expression as Record<string, unknown>,
        severity: 'BLOCKING',
        reusable: false,
      })),
      actions: (generatedGraph.actions ?? []).map((action) => ({
        code: action.code,
        type: action.type,
        payload: {},
        terminal: false,
        reasonCodes: [{ reasonCodeId: reasonIds.get(action.reasonCode)!.toString(), priority: 10 }],
      })),
      nodes: generatedGraph.nodes.map((node, index) => ({
        key: node.key,
        type: node.type,
        label: node.label,
        config: node.config,
        ...positions[index],
        order: index + 1,
        terminal: node.type === 'RESULT',
        conditions: [],
        actions: node.actions ?? [],
      })),
      edges: generatedGraph.edges.map((edge, index) => ({
        key: edge.key,
        from: edge.from,
        to: edge.to,
        type: edge.conditionCode ? 'CONDITIONAL' : 'DEFAULT',
        priority: edge.default ? 999 : index + 1,
        default: edge.default,
        conditions: edge.conditionCode ? [{ conditionCode: edge.conditionCode, order: 1 }] : [],
      })),
    };

    const updatedVersion = await this.graphWriter.replaceDraftGraph(
      tenantId,
      versionId,
      dto.expectedLockVersion,
      replaceGraphDto,
      principal,
    );

    const updatedRecord = await this.prisma.$transaction(async (tx) => {
      const result = await tx.decisionCodeImport.update({
        where: { id: record.id },
        data: { artifactVersionId: versionId, status },
      });
      await this.audit.append(
        {
          tenantId,
          eventType: status === 'CONFIRMED' ? 'CODE_IMPORT_CONFIRMED' : 'CODE_IMPORT_DRAFT_SAVED',
          aggregateType: 'DecisionCodeImport',
          aggregateId: record.id.toString(),
          actorId: principal.id,
          requestId: principal.requestId,
          payload: { artifactVersionId: versionId.toString() },
        },
        tx,
      );
      return result;
    });

    return { record: updatedRecord, updatedVersion };
  }

  /**
   * Códigos de motivo activos del tenant.
   *
   * Sirven para reconocer, entre los literales que escribe el código importado,
   * cuáles son motivos de negocio ya declarados. Sin esto un `"AGE_NOT_ELIGIBLE"`
   * entra al grafo como una cadena suelta: la decisión no se puede filtrar por
   * motivo, ni explicar al cliente, ni auditar.
   */
  private async reasonCodeCatalog(tenantId: bigint): Promise<ReadonlySet<string>> {
    const rows = await this.prisma.decisionReasonCode.findMany({
      where: { tenantId, isActive: true },
      select: { reasonCode: true },
    });
    return new Set(rows.map((row) => row.reasonCode));
  }

  /** Ids de los motivos que las acciones generadas van a emitir. */
  private async reasonCodeIds(tenantId: bigint, codes: string[]): Promise<Map<string, bigint>> {
    if (!codes.length) return new Map();
    const rows = await this.prisma.decisionReasonCode.findMany({
      where: { tenantId, isActive: true, reasonCode: { in: codes } },
      select: { id: true, reasonCode: true },
    });
    const byCode = new Map(rows.map((row) => [row.reasonCode, row.id]));
    const missing = codes.filter((code) => !byCode.has(code));
    if (missing.length) {
      // No debería ocurrir (la generación sólo usa códigos del catálogo), pero si
      // alguien desactiva un motivo entre analizar y guardar, mejor decirlo claro
      // que escribir un grafo con una acción rota.
      throw new DomainException(
        'CODE_IMPORT_REASON_CODE_MISSING',
        `These reason codes no longer exist in the catalog: ${missing.join(', ')}`,
        HttpStatus.CONFLICT,
        { missing },
      );
    }
    return byCode;
  }

  /**
   * Contraste del contrato contra el catálogo de variables del tenant.
   *
   * Un artefacto sólo puede usar variables ya declaradas; una importación de
   * código tenía la puerta abierta: la variable que el contrato mencionaba y no
   * existía se creaba sola al guardar, con nombre igual al código, sin dueño real
   * y sin restricciones. El catálogo se llenaba de variables que nadie gobierna
   * justo por la vía que menos revisión tiene.
   */
  private async catalogIssues(
    tenantId: bigint,
    dependencies: GeneratedGraphPreview['dependencies'],
  ): Promise<LineIssue[]> {
    if (!dependencies.length) return [];
    const known = await this.variableVersions(
      tenantId,
      dependencies.map((dependency) => dependency.variableCode),
    );
    const issues: LineIssue[] = [];
    for (const dependency of dependencies) {
      const role = dependency.usageType === 'INPUT' ? 'Input' : 'Output';
      const existing = known.get(dependency.variableCode);
      if (!existing) {
        issues.push({
          source: 'CONTRACT',
          severity: 'ERROR',
          line: 1,
          code: 'CODE_IMPORT_VARIABLE_NOT_IN_CATALOG',
          message: `${role} "${dependency.variableCode}" is not declared in the variable catalog; declare it there before importing this code`,
        });
        continue;
      }
      const declared = normalizeDataTypeOrString(dependency.dataType);
      const catalog = normalizeDataTypeOrString(existing.dataType);
      if (declared !== catalog) {
        issues.push({
          source: 'CONTRACT',
          severity: 'ERROR',
          line: 1,
          code: 'CODE_IMPORT_VARIABLE_TYPE_MISMATCH',
          message: `${role} "${dependency.variableCode}" is declared as ${declared} but the catalog registers it as ${catalog}`,
        });
      }
    }
    return issues;
  }

  /** Última versión de cada variable pedida, por código. */
  private async variableVersions(
    tenantId: bigint,
    codes: string[],
  ): Promise<Map<string, { id: bigint; dataType: string }>> {
    const definitions = await this.prisma.decisionVariableDefinition.findMany({
      where: { tenantId, variableCode: { in: codes } },
      include: { versions: { orderBy: { versionNumber: 'desc' }, take: 1 } },
    });
    const byCode = new Map<string, { id: bigint; dataType: string }>();
    for (const definition of definitions) {
      const latest = definition.versions[0];
      if (latest) byCode.set(definition.variableCode, { id: latest.id, dataType: latest.dataType });
    }
    return byCode;
  }

  /**
   * Versiones de variable que usará el grafo. Nunca se crean: si el catálogo no
   * las tiene, se rechaza la escritura con la lista completa de las que faltan.
   *
   * El análisis ya lo avisa como error (ver {@link catalogIssues}) y por eso este
   * camino no debería alcanzarse; queda como red por si alguien retira una
   * variable entre analizar y guardar.
   */
  private async resolveVariableVersions(
    tenantId: bigint,
    dependencies: GeneratedGraphPreview['dependencies'],
  ): Promise<Map<string, bigint>> {
    const known = await this.variableVersions(
      tenantId,
      dependencies.map((dependency) => dependency.variableCode),
    );
    const missing = dependencies
      .map((dependency) => dependency.variableCode)
      .filter((code) => !known.has(code));
    if (missing.length) {
      throw new DomainException(
        'CODE_IMPORT_VARIABLE_NOT_IN_CATALOG',
        `These variables are not declared in the catalog: ${missing.join(', ')}`,
        HttpStatus.CONFLICT,
        { missing },
      );
    }
    return new Map([...known].map(([code, version]) => [code, version.id]));
  }
}
