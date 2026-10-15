import type { Prisma } from '@prisma/client';
import { DomainException } from '../../../common/errors/domain-exception';
import type { ReplaceGraphDto } from '../artifact.dto';
import type { GraphWriteContext } from './graph-write-context';

/** Nodos, aristas y sus enlaces a condiciones y acciones; un código desconocido falla cerrado. */
export async function writeNodesAndEdges(
  tx: Prisma.TransactionClient,
  { versionId }: GraphWriteContext,
  dto: ReplaceGraphDto,
  {
    conditionIds,
    actionIds,
  }: { conditionIds: Map<string, bigint>; actionIds: Map<string, bigint> },
): Promise<void> {
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
}
