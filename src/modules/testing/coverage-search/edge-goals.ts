import type { CompiledDecisionArtifact, GraphEdgeSnapshot } from '../../graph/graph.types';
import type { Goal } from './types';

/** Lo que hay que cumplir para tomar `edge` desde su nodo: sus condiciones, y no las de las de más prioridad. */
export function edgeGoals(compiled: CompiledDecisionArtifact, edge: GraphEdgeSnapshot): Goal[] {
  const conjunction = (target: GraphEdgeSnapshot) => ({
    op: 'and',
    args: target.conditions.map(
      (condition) => compiled.conditions[condition.code]?.expression ?? { value: true },
    ),
  });
  const goals: Goal[] = [];
  const siblings = compiled.edgesByNode[edge.from] ?? [];
  for (const sibling of siblings) {
    if (sibling.key === edge.key) break;
    if (!sibling.default && sibling.conditions.length)
      goals.push({ expression: conjunction(sibling), truth: false });
  }
  if (edge.default) {
    for (const sibling of siblings) {
      if (sibling.key !== edge.key && !sibling.default && sibling.conditions.length)
        goals.push({ expression: conjunction(sibling), truth: false });
    }
  } else if (edge.conditions.length) {
    goals.push({ expression: conjunction(edge), truth: true });
  }
  return goals;
}

/** Caminos de aristas desde el inicio hasta `target`, los más cortos primero. */
export function pathsTo(
  compiled: CompiledDecisionArtifact,
  target: string,
  limit: number,
): GraphEdgeSnapshot[][] {
  const found: GraphEdgeSnapshot[][] = [];
  const queue: Array<{ node: string; path: GraphEdgeSnapshot[]; seen: Set<string> }> = [
    { node: compiled.startNodeKey, path: [], seen: new Set([compiled.startNodeKey]) },
  ];
  let guard = 0;
  while (queue.length && found.length < limit && guard < 5_000) {
    guard += 1;
    const current = queue.shift()!;
    if (current.node === target) {
      found.push(current.path);
      continue;
    }
    for (const edge of compiled.edgesByNode[current.node] ?? []) {
      if (current.seen.has(edge.to)) continue;
      queue.push({
        node: edge.to,
        path: [...current.path, edge],
        seen: new Set([...current.seen, edge.to]),
      });
    }
  }
  return found;
}
