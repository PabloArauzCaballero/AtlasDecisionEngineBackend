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
    if (!version) throw new DomainException('VERSION_NOT_FOUND', 'Artifact version not found', HttpStatus.NOT_FOUND);
    if (version.status !== VersionStatus.DRAFT && version.status !== VersionStatus.VALIDATION_FAILED) {
      throw new DomainException('VERSION_IMMUTABLE', `Only DRAFT or VALIDATION_FAILED versions are editable; current state is ${version.status}`, HttpStatus.CONFLICT);
    }
    if (version.lockVersion !== expectedLockVersion) {
      throw new DomainException('LOCK_CONFLICT', 'The version was modified by another actor', HttpStatus.CONFLICT, {
        expected: expectedLockVersion,
        actual: version.lockVersion,
      });
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
        throw new DomainException('LOCK_CONFLICT', 'The version changed while saving', HttpStatus.CONFLICT);
      }

      await tx.decisionRuleEdge.deleteMany({ where: { artifactVersionId: versionId } });
      await tx.decisionRuleNode.deleteMany({ where: { artifactVersionId: versionId } });
      await tx.decisionRuleCondition.deleteMany({ where: { artifactVersionId: versionId } });
      await tx.decisionRuleAction.deleteMany({ where: { artifactVersionId: versionId } });
      await tx.decisionArtifactVariableDependency.deleteMany({ where: { artifactVersionId: versionId } });
      await tx.decisionCompiledArtifact.deleteMany({ where: { artifactVersionId: versionId } });

      const dependencyIds = dto.dependencies.map((dependency) => BigInt(dependency.variableVersionId));
      const variables = await tx.decisionVariableVersion.findMany({
        where: {
          id: { in: dependencyIds },
          definition: { tenantId },
        },
        select: { id: true },
      });
      if (variables.length !== new Set(dependencyIds.map(String)).size) {
        throw new DomainException('VARIABLE_DEPENDENCY_NOT_FOUND', 'One or more variable versions do not exist in this tenant');
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

      const conditionIds = new Map<string, bigint>();
      for (const condition of dto.conditions) {
        const created = await tx.decisionRuleCondition.create({
          data: {
            artifactVersionId: versionId,
            conditionCode: condition.code,
            name: condition.name,
            expressionType: condition.expressionType,
            expressionJson: condition.expression as Prisma.InputJsonValue,
            severity: condition.severity,
            isReusable: condition.reusable,
          },
        });
        conditionIds.set(condition.code, created.id);
      }

      const reasonIds = [...new Set(dto.actions.flatMap((action) => action.reasonCodes.map((reason) => reason.reasonCodeId)))].map(BigInt);
      if (reasonIds.length) {
        const reasonCount = await tx.decisionReasonCode.count({ where: { id: { in: reasonIds }, tenantId } });
        if (reasonCount !== reasonIds.length) {
          throw new DomainException('REASON_CODE_NOT_FOUND', 'One or more reason codes do not exist in this tenant');
        }
      }

      const actionIds = new Map<string, bigint>();
      for (const action of dto.actions) {
        const created = await tx.decisionRuleAction.create({
          data: {
            artifactVersionId: versionId,
            actionCode: action.code,
            actionType: action.type,
            payloadSchemaJson: action.payloadSchema as Prisma.InputJsonValue | undefined,
            payloadTemplateJson: action.payload as Prisma.InputJsonValue,
            isTerminal: action.terminal,
            reasonMappings: {
              create: action.reasonCodes.map((reason) => ({
                reasonCodeId: BigInt(reason.reasonCodeId),
                priority: reason.priority,
                messageTemplateJson: reason.messageTemplate as Prisma.InputJsonValue | undefined,
              })),
            },
          },
        });
        actionIds.set(action.code, created.id);
      }

      const nodeIds = new Map<string, bigint>();
      for (const node of dto.nodes) {
        const created = await tx.decisionRuleNode.create({
          data: {
            artifactVersionId: versionId,
            nodeKey: node.key,
            nodeType: node.type,
            label: node.label,
            configJson: node.config as Prisma.InputJsonValue,
            xPos: Math.round(node.x),
            yPos: Math.round(node.y),
            orderIndex: node.order,
            isTerminal: node.terminal,
          },
        });
        nodeIds.set(node.key, created.id);
      }

      for (const node of dto.nodes) {
        const nodeId = nodeIds.get(node.key)!;
        for (const binding of node.conditions) {
          const conditionId = conditionIds.get(binding.conditionCode);
          if (!conditionId) {
            throw new DomainException('NODE_CONDITION_NOT_FOUND', `Node ${node.key} references unknown condition ${binding.conditionCode}`);
          }
          await tx.decisionNodeCondition.create({
            data: {
              nodeId,
              conditionId,
              evaluationOrder: binding.order,
              expectedBoolean: binding.expected,
            },
          });
        }
        for (const binding of node.actions) {
          const actionId = actionIds.get(binding.actionCode);
          if (!actionId) {
            throw new DomainException('NODE_ACTION_NOT_FOUND', `Node ${node.key} references unknown action ${binding.actionCode}`);
          }
          await tx.decisionNodeAction.create({
            data: { nodeId, actionId, executionOrder: binding.order },
          });
        }
      }

      for (const edge of dto.edges) {
        const fromNodeId = nodeIds.get(edge.from);
        const toNodeId = nodeIds.get(edge.to);
        if (!fromNodeId || !toNodeId) {
          throw new DomainException('EDGE_NODE_NOT_FOUND', `Edge ${edge.key} references an unknown node`);
        }
        const created = await tx.decisionRuleEdge.create({
          data: {
            artifactVersionId: versionId,
            fromNodeId,
            toNodeId,
            edgeKey: edge.key,
            edgeType: edge.type,
            priority: edge.priority,
            isDefault: edge.default,
          },
        });
        for (const binding of edge.conditions) {
          const conditionId = conditionIds.get(binding.conditionCode);
          if (!conditionId) {
            throw new DomainException('EDGE_CONDITION_NOT_FOUND', `Edge ${edge.key} references unknown condition ${binding.conditionCode}`);
          }
          await tx.decisionEdgeCondition.create({
            data: { edgeId: created.id, conditionId, evaluationOrder: binding.order },
          });
        }
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
      return tx.decisionArtifactVersion.findUniqueOrThrow({
        where: { id: versionId },
        select: { id: true, status: true, lockVersion: true, canonicalChecksum: true },
      });
    });

    await this.audit.append({
      tenantId,
      eventType: 'RULE_GRAPH_REPLACED',
      aggregateType: 'ArtifactVersion',
      aggregateId: versionId.toString(),
      actorId: principal.id,
      requestId: principal.requestId,
      payload: {
        lockVersion: result.lockVersion,
        nodes: dto.nodes.length,
        edges: dto.edges.length,
      },
    });
    return result;
  }
}
