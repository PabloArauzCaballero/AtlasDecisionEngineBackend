import { layoutSeedNodes } from '../../common/graph/tree-layout';
import type { GeneratedGraphPreview } from './code-import.types';

/**
 * El grafo generado, traducido a lo que el escritor de artefactos acepta.
 *
 * Los ids vienen ya resueltos contra el catálogo: este paso no consulta nada.
 */
export function toReplaceGraphDto(
  generatedGraph: GeneratedGraphPreview,
  variableVersionIds: ReadonlyMap<string, bigint>,
  reasonIds: ReadonlyMap<string, bigint>,
) {
  // El lienzo del editor coloca los nodos en porcentajes (0–100), no en píxeles:
  // se dibuja el árbol en escalera (una columna por condición, el resultado de
  // cada rama arriba y el camino "no" bajando a la siguiente).
  const layout = layoutSeedNodes(generatedGraph.nodes, generatedGraph.edges);
  const positions = generatedGraph.nodes.map((node) => layout.get(node.key) ?? { x: 38, y: 45 });
  return {
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
}
