import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { DomainException } from '../../common/errors/domain-exception';
import { parseBigIntId } from '../../common/http/id';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import { ArtifactGraphWriterService } from '../artifacts/artifact-graph-writer.service';
import { CodeImportCatalogService } from './code-import-catalog.service';
import { toReplaceGraphDto } from './code-import-replace-graph';
import { SaveCodeImportDto } from './code-import.dto';
import { GraphGeneratorService } from './graph-generator.service';
import type { CodeImportIR, LineIssue } from './code-import.types';

/** Una importación guardada, tal como la lee el escritor. */
interface StoredCodeImport {
  id: bigint;
  issuesJson: unknown;
  irJson: unknown;
}

/**
 * Escribe en el grafo borrador de un artefacto el resultado de una importación
 * ya analizada, y deja constancia en la auditoría. Rechaza las importaciones
 * con errores guardados y las que ya no cuadran con el catálogo.
 */
@Injectable()
export class CodeImportArtifactWriter {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly graphGenerator: GraphGeneratorService,
    private readonly graphWriter: ArtifactGraphWriterService,
    private readonly catalog: CodeImportCatalogService,
  ) {}

  async write(
    tenantId: bigint,
    record: StoredCodeImport,
    dto: SaveCodeImportDto,
    principal: AuthenticatedPrincipal,
    status: 'DRAFT_SAVED' | 'CONFIRMED',
  ) {
    const issues = (record.issuesJson as LineIssue[]) ?? [];
    if (issues.some((issue) => issue.severity === 'ERROR')) {
      throw new DomainException(
        'CODE_IMPORT_HAS_BLOCKING_ISSUES',
        'This code import has unresolved errors and cannot be written to an artifact graph',
        HttpStatus.CONFLICT,
        { issues },
      );
    }
    const ir = record.irJson as CodeImportIR;
    const reasonCodes = await this.catalog.reasonCodeCatalog(tenantId);
    const generatedGraph = this.graphGenerator.generate(ir, reasonCodes);
    const versionId = parseBigIntId(dto.artifactVersionId, 'artifactVersionId');
    // Las acciones que emiten motivos necesitan el id del reason code del catálogo:
    // se referencia el que ya existe, nunca se crea uno nuevo desde una importación.
    const reasonIds = await this.catalog.reasonCodeIds(
      tenantId,
      (generatedGraph.actions ?? []).map((action) => action.reasonCode),
    );
    const variableVersionIds = await this.catalog.resolveVariableVersions(
      tenantId,
      generatedGraph.dependencies,
    );

    const updatedVersion = await this.graphWriter.replaceDraftGraph(
      tenantId,
      versionId,
      dto.expectedLockVersion,
      toReplaceGraphDto(generatedGraph, variableVersionIds, reasonIds),
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
}
