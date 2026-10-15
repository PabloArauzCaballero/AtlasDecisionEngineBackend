import type { Prisma } from '@prisma/client';
import type { CloneSource } from './clone-version-source';

/** Copia condiciones, acciones, nodos y aristas, reasignando los identificadores al clon. */
export async function cloneVersionGraph(
  tx: Prisma.TransactionClient,
  source: CloneSource,
  versionId: bigint,
): Promise<void> {
  const conditionMap = new Map<bigint, bigint>();
  for (const condition of source.conditions) {
    const created = await tx.decisionRuleCondition.create({
      data: {
        artifactVersionId: versionId,
        conditionCode: condition.conditionCode,
        name: condition.name,
        expressionType: condition.expressionType,
        expressionJson: condition.expressionJson as Prisma.InputJsonValue,
        severity: condition.severity,
        isReusable: condition.isReusable,
      },
    });
    conditionMap.set(condition.id, created.id);
  }
  const actionMap = new Map<bigint, bigint>();
  for (const action of source.actions) {
    const created = await tx.decisionRuleAction.create({
      data: {
        artifactVersionId: versionId,
        actionCode: action.actionCode,
        actionType: action.actionType,
        payloadSchemaJson: action.payloadSchemaJson ?? undefined,
        payloadTemplateJson: action.payloadTemplateJson as Prisma.InputJsonValue,
        isTerminal: action.isTerminal,
        reasonMappings: {
          create: action.reasonMappings.map((mapping) => ({
            reasonCodeId: mapping.reasonCodeId,
            priority: mapping.priority,
            messageTemplateJson: mapping.messageTemplateJson ?? undefined,
          })),
        },
      },
    });
    actionMap.set(action.id, created.id);
  }
  const nodeMap = new Map<bigint, bigint>();
  for (const node of source.nodes) {
    const created = await tx.decisionRuleNode.create({
      data: {
        artifactVersionId: versionId,
        nodeKey: node.nodeKey,
        nodeType: node.nodeType,
        label: node.label,
        configJson: node.configJson as Prisma.InputJsonValue,
        xPos: node.xPos,
        yPos: node.yPos,
        orderIndex: node.orderIndex,
        isTerminal: node.isTerminal,
      },
    });
    nodeMap.set(node.id, created.id);
  }
  for (const node of source.nodes) {
    const newNodeId = nodeMap.get(node.id)!;
    await tx.decisionNodeCondition.createMany({
      data: node.nodeConditions.map((binding) => ({
        nodeId: newNodeId,
        conditionId: conditionMap.get(binding.conditionId)!,
        evaluationOrder: binding.evaluationOrder,
        expectedBoolean: binding.expectedBoolean,
      })),
    });
    await tx.decisionNodeAction.createMany({
      data: node.nodeActions.map((binding) => ({
        nodeId: newNodeId,
        actionId: actionMap.get(binding.actionId)!,
        executionOrder: binding.executionOrder,
      })),
    });
  }
  for (const edge of source.edges) {
    const created = await tx.decisionRuleEdge.create({
      data: {
        artifactVersionId: versionId,
        fromNodeId: nodeMap.get(edge.fromNodeId)!,
        toNodeId: nodeMap.get(edge.toNodeId)!,
        edgeKey: edge.edgeKey,
        edgeType: edge.edgeType,
        priority: edge.priority,
        isDefault: edge.isDefault,
      },
    });
    await tx.decisionEdgeCondition.createMany({
      data: edge.edgeConditions.map((binding) => ({
        edgeId: created.id,
        conditionId: conditionMap.get(binding.conditionId)!,
        evaluationOrder: binding.evaluationOrder,
      })),
    });
  }
}
