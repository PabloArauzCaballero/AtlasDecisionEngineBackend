/**
 * Atomically replaces editable graph children under optimistic locking. Batched inserts keep the
 * authoring transaction bounded while audit evidence commits with the graph.
 */
import { HttpStatus, Injectable } from '@nestjs/common';
import { VersionStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { DomainException } from '../../common/errors/domain-exception';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import { ReplaceGraphDto } from './artifact.dto';
import { CalculatedFieldBindingService } from './calculated-field-binding.service';
import { clearDraftGraph } from './graph-writer/clear-draft-graph';
import { writeConditionsAndActions } from './graph-writer/write-rules';
import { writeIntermediatesAndOutputContract } from './graph-writer/write-contract';
import { writeNodeScripts } from './graph-writer/write-node-scripts';
import { writeNodesAndEdges } from './graph-writer/write-nodes-and-edges';
import { writeVariableDependencies } from './graph-writer/write-variable-dependencies';

@Injectable()
export class ArtifactGraphWriterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly calculatedFields: CalculatedFieldBindingService,
  ) {}

  async replaceDraftGraph(
    tenantId: bigint,
    versionId: bigint,
    expectedLockVersion: number,
    dto: ReplaceGraphDto,
    principal: AuthenticatedPrincipal,
  ) {
    const version = await this.prisma.decisionArtifactVersion.findFirst({
      where: { id: versionId, artifact: { tenantId } },
      select: { id: true, status: true, lockVersion: true },
    });
    if (!version)
      throw new DomainException(
        'VERSION_NOT_FOUND',
        'Artifact version not found',
        HttpStatus.NOT_FOUND,
      );
    if (
      version.status !== VersionStatus.DRAFT &&
      version.status !== VersionStatus.VALIDATION_FAILED
    ) {
      throw new DomainException(
        'VERSION_IMMUTABLE',
        `Only DRAFT or VALIDATION_FAILED versions are editable; current state is ${version.status}`,
        HttpStatus.CONFLICT,
      );
    }
    if (version.lockVersion !== expectedLockVersion) {
      throw new DomainException(
        'LOCK_CONFLICT',
        'The version was modified by another actor',
        HttpStatus.CONFLICT,
        {
          expected: expectedLockVersion,
          actual: version.lockVersion,
        },
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const lock = await tx.decisionArtifactVersion.updateMany({
        where: {
          id: versionId,
          lockVersion: expectedLockVersion,
          status: { in: [VersionStatus.DRAFT, VersionStatus.VALIDATION_FAILED] },
        },
        data: {
          lockVersion: { increment: 1 },
          status: VersionStatus.DRAFT,
          canonicalChecksum: null,
        },
      });
      if (lock.count !== 1) {
        throw new DomainException(
          'LOCK_CONFLICT',
          'The version changed while saving',
          HttpStatus.CONFLICT,
        );
      }

      const ctx = { tenantId, versionId };
      await clearDraftGraph(tx, versionId);
      await writeVariableDependencies(tx, ctx, dto);
      await writeIntermediatesAndOutputContract(tx, ctx, dto);
      const rules = await writeConditionsAndActions(tx, ctx, dto);
      await writeNodesAndEdges(tx, ctx, dto, rules);

      // Las invocaciones a campos calculados se resuelven contra la base y se congelan
      // aquí: el cliente nunca aporta la definición ejecutable (ver
      // CalculatedFieldBindingService).
      const calculatedFieldCalls = await this.calculatedFields.resolve(tenantId, dto.nodes, tx);
      await this.calculatedFields.persist(tenantId, versionId, calculatedFieldCalls, tx);

      await writeNodeScripts(tx, ctx, dto, principal.id);

      await tx.decisionChangeLog.create({
        data: {
          artifactVersionId: versionId,
          entityType: 'RULE_GRAPH',
          entityId: versionId.toString(),
          operation: 'REPLACE',
          newValueJson: {
            dependencies: dto.dependencies.length,
            intermediates: dto.intermediates?.length ?? 0,
            calculatedFieldCalls: calculatedFieldCalls.length,
            outputContract: dto.outputContract?.length ?? 0,
            conditions: dto.conditions.length,
            actions: dto.actions.length,
            nodes: dto.nodes.length,
            edges: dto.edges.length,
          },
          changedBy: principal.id,
        },
      });
      const updated = await tx.decisionArtifactVersion.findUniqueOrThrow({
        where: { id: versionId },
        select: { id: true, status: true, lockVersion: true, canonicalChecksum: true },
      });
      await this.audit.append(
        {
          tenantId,
          eventType: 'RULE_GRAPH_REPLACED',
          aggregateType: 'ArtifactVersion',
          aggregateId: versionId.toString(),
          actorId: principal.id,
          requestId: principal.requestId,
          payload: {
            lockVersion: updated.lockVersion,
            nodes: dto.nodes.length,
            edges: dto.edges.length,
          },
        },
        tx,
      );
      return updated;
    });
    return result;
  }
}
