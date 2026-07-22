import { createHash } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, VersionStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { DomainException } from '../../common/errors/domain-exception';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import { ReplaceGraphDto } from './artifact.dto';

@Injectable()
export class ArtifactGraphWriterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
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

      await tx.decisionNodeScript.deleteMany({ where: { artifactVersionId: versionId } });
      await tx.decisionRuleEdge.deleteMany({ where: { artifactVersionId: versionId } });
      await tx.decisionRuleNode.deleteMany({ where: { artifactVersionId: versionId } });
      await tx.decisionRuleCondition.deleteMany({ where: { artifactVersionId: versionId } });
      await tx.decisionRuleAction.deleteMany({ where: { artifactVersionId: versionId } });
      await tx.decisionArtifactVariableDependency.deleteMany({
        where: { artifactVersionId: versionId },
      });
      await tx.decisionCompiledArtifact.deleteMany({ where: { artifactVersionId: versionId } });

      const dependencyIds = dto.dependencies.map((dependency) =>
        BigInt(dependency.variableVersionId),
      );
      const variables = await tx.decisionVariableVersion.findMany({
        where: {
          id: { in: dependencyIds },
          definition: { tenantId },
        },
        select: { id: true },
      });
      if (variables.length !== new Set(dependencyIds.map(String)).size) {
        throw new DomainException(
          'VARIABLE_DEPENDENCY_NOT_FOUND',
          'One or more variable versions do not exist in this tenant',
        );
      }

      await tx.decisionArtifactVariableDependency.createMany({
        data: dto.dependencies.map((dependency) => ({
          artifactVersionId: versionId,
          variableVersionId: BigInt(dependency.variableVersionId),
          usageType: dependency.usageType,
          isRequired: dependency.isRequired,
          fallbackPolicy: dependency.fallbackPolicy,
          dependencyPath: dependency.dependencyPath,
        })),
      });

      // Every child insert below is batched with createManyAndReturn / createMany rather
      // than one create() per row. The author path is low-volume, but a graph with
      // hundreds of nodes/edges otherwise issued hundreds of round-trips inside one open
      // transaction — long-held row locks and real contention risk. Generated ids are
      // mapped back by each row's unique business key (conditionCode/actionCode/nodeKey/
      // edgeKey), so the mapping does not depend on any insert-ordering guarantee.
      const conditionIds = new Map<string, bigint>();
      if (dto.conditions.length) {
        const created = await tx.decisionRuleCondition.createManyAndReturn({
          data: dto.conditions.map((condition) => ({
            artifactVersionId: versionId,
            conditionCode: condition.code,
            name: condition.name,
            expressionType: condition.expressionType,
            expressionJson: condition.expression as Prisma.InputJsonValue,
            severity: condition.severity,
            isReusable: condition.reusable,
          })),
          select: { id: true, conditionCode: true },
        });
        for (const row of created) conditionIds.set(row.conditionCode, row.id);
      }

      const reasonIds = [
        ...new Set(
          dto.actions.flatMap((action) => action.reasonCodes.map((reason) => reason.reasonCodeId)),
        ),
      ].map(BigInt);
      if (reasonIds.length) {
        const reasonCount = await tx.decisionReasonCode.count({
          where: { id: { in: reasonIds }, tenantId },
        });
        if (reasonCount !== reasonIds.length) {
          throw new DomainException(
            'REASON_CODE_NOT_FOUND',
            'One or more reason codes do not exist in this tenant',
          );
        }
      }

      // Actions first, then their reason mappings keyed on the returned action ids:
      // createManyAndReturn cannot create the nested mappings, so they are a second batch.
      const actionIds = new Map<string, bigint>();
      if (dto.actions.length) {
        const created = await tx.decisionRuleAction.createManyAndReturn({
          data: dto.actions.map((action) => ({
            artifactVersionId: versionId,
            actionCode: action.code,
            actionType: action.type,
            payloadSchemaJson: action.payloadSchema as Prisma.InputJsonValue | undefined,
            payloadTemplateJson: action.payload as Prisma.InputJsonValue,
            isTerminal: action.terminal,
          })),
          select: { id: true, actionCode: true },
        });
        for (const row of created) actionIds.set(row.actionCode, row.id);

        const reasonMappingRows = dto.actions.flatMap((action) =>
          action.reasonCodes.map((reason) => ({
            actionId: actionIds.get(action.code)!,
            reasonCodeId: BigInt(reason.reasonCodeId),
            priority: reason.priority,
            messageTemplateJson: reason.messageTemplate as Prisma.InputJsonValue | undefined,
          })),
        );
        if (reasonMappingRows.length) {
          await tx.decisionActionReasonMapping.createMany({ data: reasonMappingRows });
        }
      }

      const nodeIds = new Map<string, bigint>();
      if (dto.nodes.length) {
        const created = await tx.decisionRuleNode.createManyAndReturn({
          data: dto.nodes.map((node) => ({
            artifactVersionId: versionId,
            nodeKey: node.key,
            nodeType: node.type,
            label: node.label,
            configJson: node.config as Prisma.InputJsonValue,
            xPos: Math.round(node.x),
            yPos: Math.round(node.y),
            orderIndex: node.order,
            isTerminal: node.terminal,
          })),
          select: { id: true, nodeKey: true },
        });
        for (const row of created) nodeIds.set(row.nodeKey, row.id);
      }

      // Node-condition and node-action join rows: resolve references (fail closed on an
      // unknown code) into flat arrays, then insert each set in a single batch.
      const nodeConditionRows: Prisma.DecisionNodeConditionCreateManyInput[] = [];
      const nodeActionRows: Prisma.DecisionNodeActionCreateManyInput[] = [];
      for (const node of dto.nodes) {
        const nodeId = nodeIds.get(node.key)!;
        for (const binding of node.conditions) {
          const conditionId = conditionIds.get(binding.conditionCode);
          if (!conditionId) {
            throw new DomainException(
              'NODE_CONDITION_NOT_FOUND',
              `Node ${node.key} references unknown condition ${binding.conditionCode}`,
            );
          }
          nodeConditionRows.push({
            nodeId,
            conditionId,
            evaluationOrder: binding.order,
            expectedBoolean: binding.expected,
          });
        }
        for (const binding of node.actions) {
          const actionId = actionIds.get(binding.actionCode);
          if (!actionId) {
            throw new DomainException(
              'NODE_ACTION_NOT_FOUND',
              `Node ${node.key} references unknown action ${binding.actionCode}`,
            );
          }
          nodeActionRows.push({ nodeId, actionId, executionOrder: binding.order });
        }
      }
      if (nodeConditionRows.length)
        await tx.decisionNodeCondition.createMany({ data: nodeConditionRows });
      if (nodeActionRows.length) await tx.decisionNodeAction.createMany({ data: nodeActionRows });

      // Validate every edge endpoint before inserting so an unknown node fails closed.
      for (const edge of dto.edges) {
        if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
          throw new DomainException(
            'EDGE_NODE_NOT_FOUND',
            `Edge ${edge.key} references an unknown node`,
          );
        }
      }
      const edgeIds = new Map<string, bigint>();
      if (dto.edges.length) {
        const created = await tx.decisionRuleEdge.createManyAndReturn({
          data: dto.edges.map((edge) => ({
            artifactVersionId: versionId,
            fromNodeId: nodeIds.get(edge.from)!,
            toNodeId: nodeIds.get(edge.to)!,
            edgeKey: edge.key,
            edgeType: edge.type,
            priority: edge.priority,
            isDefault: edge.default,
          })),
          select: { id: true, edgeKey: true },
        });
        for (const row of created) edgeIds.set(row.edgeKey, row.id);
      }

      const edgeConditionRows = dto.edges.flatMap((edge) =>
        edge.conditions.map((binding) => {
          const conditionId = conditionIds.get(binding.conditionCode);
          if (!conditionId) {
            throw new DomainException(
              'EDGE_CONDITION_NOT_FOUND',
              `Edge ${edge.key} references unknown condition ${binding.conditionCode}`,
            );
          }
          return { edgeId: edgeIds.get(edge.key)!, conditionId, evaluationOrder: binding.order };
        }),
      );
      if (edgeConditionRows.length)
        await tx.decisionEdgeCondition.createMany({ data: edgeConditionRows });

      // Registry copy of node scripts: the engine keeps executing config_json,
      // but every script becomes queryable/auditable with a checksum and the
      // variable contract it was written against.
      const scriptRows = dto.nodes
        .map((node) => {
          const script = (node.config as { script?: { language?: unknown; source?: unknown } })
            ?.script;
          const source = typeof script?.source === 'string' ? script.source : '';
          if (
            String((node.config as { mode?: unknown })?.mode ?? '').toUpperCase() !== 'SCRIPT' ||
            !source.trim()
          ) {
            return null;
          }
          return {
            tenantId,
            artifactVersionId: versionId,
            nodeKey: node.key,
            language: String(script?.language ?? 'JAVASCRIPT').toUpperCase(),
            sourceCode: source,
            sourceChecksum: createHash('sha256').update(source).digest('hex'),
            inputVariablesJson: dto.dependencies
              .filter((dependency) => !dependency.usageType.startsWith('OUTPUT'))
              .map((dependency) => dependency.dependencyPath),
            outputVariablesJson: dto.dependencies
              .filter((dependency) => dependency.usageType.startsWith('OUTPUT'))
              .map((dependency) => dependency.dependencyPath),
            createdBy: principal.id,
          };
        })
        .filter((row): row is NonNullable<typeof row> => row !== null);
      if (scriptRows.length) {
        await tx.decisionNodeScript.createMany({ data: scriptRows });
      }

      await tx.decisionChangeLog.create({
        data: {
          artifactVersionId: versionId,
          entityType: 'RULE_GRAPH',
          entityId: versionId.toString(),
          operation: 'REPLACE',
          newValueJson: {
            dependencies: dto.dependencies.length,
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
