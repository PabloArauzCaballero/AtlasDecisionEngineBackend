/**
 * Escribe en las tablas relacionales del grafo lo que ya describe un compilado.
 *
 * Existe porque hay DOS representaciones del mismo grafo y es fácil sembrar sólo
 * una: el compilado (`decision_compiled_artifact.compiled_payload_json`) es lo
 * que ejecuta el motor, mientras que el editor y la vista de grafo del portal
 * leen `decision_rule_node`, `decision_rule_edge` y `decision_rule_condition`.
 *
 * Un seeder que escriba sólo el compilado produce un artefacto que decide
 * perfectamente y que el portal muestra VACÍO, sin un solo nodo. No falla, no
 * avisa: simplemente no se ve. Le pasó al demo de contratos, que se sembró así
 * y llevaba desde entonces sin poder abrirse en el editor.
 *
 * Compartido a propósito: cualquier seeder nuevo que llame aquí queda inmune al
 * mismo olvido.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import type { CompiledDecisionArtifact } from '../../graph/graph.types';

export async function writeGraphRows(
  prisma: PrismaClient,
  artifactVersionId: bigint,
  compiled: CompiledDecisionArtifact,
): Promise<{ nodes: number; edges: number; conditions: number }> {
  const conditionByCode: Record<string, { id: bigint }> = {};
  for (const [code, condition] of Object.entries(compiled.conditions ?? {})) {
    conditionByCode[code] = await prisma.decisionRuleCondition.create({
      data: {
        artifactVersionId,
        conditionCode: code,
        name: condition.name,
        expressionType: 'JSON_AST',
        expressionJson: condition.expression as unknown as Prisma.InputJsonValue,
        severity: 'BLOCKING',
        isReusable: true,
      },
    });
  }

  const nodeByKey: Record<string, { id: bigint }> = {};
  for (const node of Object.values(compiled.nodes)) {
    nodeByKey[node.key] = await prisma.decisionRuleNode.create({
      data: {
        artifactVersionId,
        nodeKey: node.key,
        nodeType: node.type,
        label: node.label,
        configJson: node.config as unknown as Prisma.InputJsonValue,
        xPos: node.x,
        yPos: node.y,
        orderIndex: node.order,
        isTerminal: node.terminal,
      },
    });
  }

  let edges = 0;
  for (const list of Object.values(compiled.edgesByNode ?? {})) {
    for (const edge of list) {
      // Una arista cuyo origen o destino no exista rompería la referencia; se
      // salta en vez de abortar la siembra entera por un grafo mal formado.
      if (!nodeByKey[edge.from] || !nodeByKey[edge.to]) continue;
      const row = await prisma.decisionRuleEdge.create({
        data: {
          artifactVersionId,
          fromNodeId: nodeByKey[edge.from].id,
          toNodeId: nodeByKey[edge.to].id,
          edgeKey: edge.key,
          edgeType: edge.default ? 'DEFAULT' : 'CONDITIONAL',
          priority: edge.priority,
          isDefault: edge.default,
        },
      });
      edges += 1;
      for (const condition of edge.conditions ?? []) {
        const target = conditionByCode[condition.code];
        if (!target) continue;
        await prisma.decisionEdgeCondition.create({
          data: {
            edgeId: row.id,
            conditionId: target.id,
            evaluationOrder: condition.order,
          },
        });
      }
    }
  }

  return {
    nodes: Object.keys(nodeByKey).length,
    edges,
    conditions: Object.keys(conditionByCode).length,
  };
}

/**
 * Borra un artefacto de demostración con todo lo que cuelga de él.
 *
 * `decisionArtifact.delete` en cascada NO alcanza a las corridas de prueba: una
 * `decision_test_run` apunta al compilado por clave foránea, así que rehacer un
 * demo que ya se ejecutó alguna vez fallaba con P2003 y dejaba la siembra a
 * medias. Se limpian primero las corridas, luego el artefacto.
 */
export async function deleteDemoArtifact(prisma: PrismaClient, artifactId: bigint): Promise<void> {
  const versions = await prisma.decisionArtifactVersion.findMany({
    where: { artifactId },
    select: { id: true },
  });
  const versionIds = versions.map((version) => version.id);
  if (versionIds.length) {
    const compiled = await prisma.decisionCompiledArtifact.findMany({
      where: { artifactVersionId: { in: versionIds } },
      select: { id: true },
    });
    const compiledIds = compiled.map((entry) => entry.id);
    if (compiledIds.length) {
      await prisma.decisionTestRun.deleteMany({
        where: { compiledArtifactId: { in: compiledIds } },
      });
    }
    await prisma.decisionRuntimeBinding.deleteMany({
      where: { activeDeployment: { artifactVersionId: { in: versionIds } } },
    });
    await prisma.decisionDeployment.deleteMany({
      where: { artifactVersionId: { in: versionIds } },
    });
  }
  await prisma.decisionArtifact.delete({ where: { id: artifactId } });
}
