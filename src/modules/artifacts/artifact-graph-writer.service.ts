/**
 * Atomically replaces editable graph children under optimistic locking. Batched inserts keep the
 * authoring transaction bounded while audit evidence commits with the graph.
 */
import { createHash } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import {
  OutputSourceKind,
  Prisma,
  SensitivityClass,
  TracePolicy,
  VersionStatus,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { DomainException } from '../../common/errors/domain-exception';
import { parseBigIntId } from '../../common/http/id';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import { ReplaceGraphDto } from './artifact.dto';
import { CalculatedFieldBindingService } from './calculated-field-binding.service';

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

      await tx.decisionNodeScript.deleteMany({ where: { artifactVersionId: versionId } });
      await tx.decisionRuleEdge.deleteMany({ where: { artifactVersionId: versionId } });
      await tx.decisionRuleNode.deleteMany({ where: { artifactVersionId: versionId } });
      await tx.decisionRuleCondition.deleteMany({ where: { artifactVersionId: versionId } });
      await tx.decisionRuleAction.deleteMany({ where: { artifactVersionId: versionId } });
      await tx.decisionArtifactVariableDependency.deleteMany({
        where: { artifactVersionId: versionId },
      });
      await tx.decisionArtifactCalculatedFieldUse.deleteMany({
        where: { artifactVersionId: versionId },
      });
      await tx.decisionIntermediateVariable.deleteMany({ where: { artifactVersionId: versionId } });
      await tx.decisionOutputContractField.deleteMany({ where: { artifactVersionId: versionId } });
      await tx.decisionCompiledArtifact.deleteMany({ where: { artifactVersionId: versionId } });

      const dependencyIds = dto.dependencies.map((dependency) =>
        parseBigIntId(dependency.variableVersionId, 'variableVersionId'),
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
        data: dto.dependencies.map((dependency, index) => ({
          artifactVersionId: versionId,
          variableVersionId: dependencyIds[index],
          usageType: dependency.usageType,
          isRequired: dependency.isRequired,
          fallbackPolicy: dependency.fallbackPolicy,
          dependencyPath: dependency.dependencyPath,
        })),
      });

      // Intermedias y contrato de salida: se reemplazan con el resto del grafo, en la
      // misma transacción, para que nunca queden apuntando a nodos que ya no existen.
      if (dto.intermediates?.length) {
        await tx.decisionIntermediateVariable.createMany({
          data: dto.intermediates.map((intermediate) => ({
            tenantId,
            artifactVersionId: versionId,
            code: intermediate.code,
            name: intermediate.name,
            description: intermediate.description,
            dataType: intermediate.dataType,
            producerNodeKey: intermediate.producerNodeKey,
            consumerNodeKeys: intermediate.consumerNodeKeys,
            initialValueJson: intermediate.initialValue as Prisma.InputJsonValue | undefined,
            constraintsJson: intermediate.constraints as Prisma.InputJsonValue | undefined,
            nullable: intermediate.nullable,
            updatePolicy: intermediate.updatePolicy,
            availabilityConditionJson: intermediate.availabilityCondition as
              Prisma.InputJsonValue | undefined,
            sensitivityClass: intermediate.sensitivityClass as SensitivityClass,
            tracePolicy: intermediate.tracePolicy as TracePolicy,
          })),
        });
      }
      if (dto.outputContract?.length) {
        // Igual que las acciones: primero los campos, luego sus motivos, porque
        // `createMany` no puede escribir la relación anidada. Los ids se recuperan
        // por `fieldCode`, que es único dentro de la versión.
        const createdFields = await tx.decisionOutputContractField.createManyAndReturn({
          data: dto.outputContract.map((field) => ({
            tenantId,
            artifactVersionId: versionId,
            fieldCode: field.code,
            name: field.name,
            description: field.description,
            sourceKind: field.sourceKind as OutputSourceKind,
            sourceRef: field.sourceRef,
            valueMappingJson: field.valueMapping as Prisma.InputJsonValue | undefined,
            absenceReasons: field.absenceReasons,
            exampleJson: field.example as Prisma.InputJsonValue | undefined,
            contractVersion: field.contractVersion,
            sensitivityClass: field.sensitivityClass as SensitivityClass,
            tracePolicy: field.tracePolicy as TracePolicy,
          })),
          select: { id: true, fieldCode: true },
        });

        const outputReasonCodes = [
          ...new Set(dto.outputContract.flatMap((field) => field.reasonCodes ?? [])),
        ];
        if (outputReasonCodes.length) {
          const known = await tx.decisionReasonCode.findMany({
            where: { tenantId, reasonCode: { in: outputReasonCodes } },
            select: { id: true, reasonCode: true },
          });
          if (known.length !== outputReasonCodes.length) {
            const found = new Set(known.map((row) => row.reasonCode));
            const missing = outputReasonCodes.filter((code) => !found.has(code));
            throw new DomainException(
              'REASON_CODE_NOT_FOUND',
              `Unknown reason codes in the output contract: ${missing.join(', ')}`,
            );
          }
          const reasonIdByCode = new Map(known.map((row) => [row.reasonCode, row.id]));
          const fieldIdByCode = new Map(createdFields.map((row) => [row.fieldCode, row.id]));
          const rows = dto.outputContract.flatMap((field) =>
            (field.reasonCodes ?? []).map((code, index) => ({
              outputFieldId: fieldIdByCode.get(field.code)!,
              reasonCodeId: reasonIdByCode.get(code)!,
              // El orden declarado es la prioridad: quien consume la decisión lee
              // los motivos en el mismo orden en que el autor los puso.
              priority: (index + 1) * 10,
            })),
          );
          if (rows.length) await tx.decisionOutputFieldReasonMap.createMany({ data: rows });
        }
      }

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
            reasonCodeId: parseBigIntId(reason.reasonCodeId, 'reasonCodeId'),
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
            // Porcentajes del lienzo con dos decimales: redondear a entero movía
            // el nodo ~17 px respecto de donde el autor lo soltó.
            xPos: Math.round(node.x * 100) / 100,
            yPos: Math.round(node.y * 100) / 100,
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

      // Las invocaciones a campos calculados se resuelven contra la base y se congelan
      // aquí: el cliente nunca aporta la definición ejecutable (ver
      // CalculatedFieldBindingService).
      const calculatedFieldCalls = await this.calculatedFields.resolve(tenantId, dto.nodes, tx);
      await this.calculatedFields.persist(tenantId, versionId, calculatedFieldCalls, tx);

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
