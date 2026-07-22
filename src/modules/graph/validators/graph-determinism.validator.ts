import type { ArtifactGraphSnapshot, ValidationIssue } from '../graph.types';
import type { GraphLookups } from './graph-lookups';
import { issue } from './validation-issue';

export interface GraphDeterminismResult {
  errors: ValidationIssue[];
  metrics: { reachableNodeCount: number; terminalPathCount: number };
}

/** Reachability, cycles and terminal-path coverage — requires exactly one START node to run. */
export function validateGraphDeterminism(
  snapshot: ArtifactGraphSnapshot,
  lookups: GraphLookups,
): GraphDeterminismResult {
  const errors: ValidationIssue[] = [];
  const starts = snapshot.nodes.filter((node) => node.type === 'START');
  if (starts.length !== 1) {
    return { errors, metrics: { reachableNodeCount: 0, terminalPathCount: 0 } };
  }
  const start = starts[0].key;

  const reachable = reachableFrom(start, snapshot);
  for (const node of snapshot.nodes) {
    if (!reachable.has(node.key)) {
      errors.push(
        issue('UNREACHABLE_NODE', `Node ${node.key} is unreachable from START`, 'NODE', node.key),
      );
    }
  }

  const cycle = findCycle(start, snapshot);
  if (cycle) {
    errors.push(issue('PROHIBITED_CYCLE', `Cycle detected: ${cycle.join(' -> ')}`));
  }

  const terminalPathCount = cycle
    ? 0
    : countTerminalPaths(start, snapshot, lookups.terminalActionCodes);
  if (terminalPathCount === 0) {
    errors.push(issue('NO_TERMINAL_PATH', 'START does not lead to any terminal path'));
  }

  return { errors, metrics: { reachableNodeCount: reachable.size, terminalPathCount } };
}

function reachableFrom(start: string, snapshot: ArtifactGraphSnapshot): Set<string> {
  const visited = new Set<string>();
  const stack = [start];
  while (stack.length) {
    const current = stack.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const edge of snapshot.edges.filter((candidate) => candidate.from === current)) {
      if (!visited.has(edge.to)) stack.push(edge.to);
    }
  }
  return visited;
}

function findCycle(start: string, snapshot: ArtifactGraphSnapshot): string[] | undefined {
  const visited = new Set<string>();
  const active = new Set<string>();
  const path: string[] = [];
  const visit = (node: string): string[] | undefined => {
    if (active.has(node)) {
      const index = path.indexOf(node);
      return [...path.slice(index), node];
    }
    if (visited.has(node)) return undefined;
    visited.add(node);
    active.add(node);
    path.push(node);
    for (const edge of snapshot.edges.filter((candidate) => candidate.from === node)) {
      const found = visit(edge.to);
      if (found) return found;
    }
    path.pop();
    active.delete(node);
    return undefined;
  };
  return visit(start);
}

function countTerminalPaths(
  start: string,
  snapshot: ArtifactGraphSnapshot,
  terminalActionCodes: Set<string>,
): number {
  const nodes = new Map(snapshot.nodes.map((node) => [node.key, node]));
  const memo = new Map<string, number>();
  const count = (key: string): number => {
    if (memo.has(key)) return memo.get(key)!;
    const node = nodes.get(key);
    if (!node) return 0;
    if (
      node.terminal ||
      node.type === 'END' ||
      node.type === 'MANUAL_REVIEW' ||
      node.actions.some((reference) => terminalActionCodes.has(reference.code))
    )
      return 1;
    const total = snapshot.edges
      .filter((edge) => edge.from === key)
      .reduce((sum, edge) => sum + count(edge.to), 0);
    memo.set(key, total);
    return total;
  };
  return count(start);
}
