import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { DomainException } from '../../common/errors/domain-exception';
import { pageResult, paginationArgs } from '../../common/http/pagination';
import { parseBigIntId } from '../../common/http/id';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import { ArtifactLifecycleService } from '../artifacts/artifact-lifecycle.service';
import { CodeImportAnalyzer } from './code-import-analyzer.service';
import { CodeImportArtifactWriter } from './code-import-artifact-writer.service';
import { AnalyzeCodeImportDto, CodeImportListQueryDto, SaveCodeImportDto } from './code-import.dto';
import type { AnalyzeCodeImportResult } from './code-import.types';

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
    private readonly analyzer: CodeImportAnalyzer,
    private readonly artifactWriter: CodeImportArtifactWriter,
    private readonly lifecycle: ArtifactLifecycleService,
  ) {}

  async analyze(
    tenantId: bigint,
    dto: AnalyzeCodeImportDto,
    principal: AuthenticatedPrincipal,
  ): Promise<AnalyzeCodeImportResult & { id: string }> {
    const { ir, issues, generatedGraph, hasBlockingIssues } = await this.analyzer.analyze(
      tenantId,
      dto,
    );

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
    return this.artifactWriter.write(tenantId, record, dto, principal, status);
  }
}
