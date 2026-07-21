/**
 * Pure graph algorithms for the nested-decision-tree reference graph (Fase 7).
 *
 * Cycle detection runs at the ARTIFACT level (not artifact-version), because the
 * meaningful invariant is "artifact A can never end up depending on itself again",
 * regardless of which pinned version carries the edge. A version-level check would
 * miss the case where A v2 references B v1 which references A v1: different version
 * ids, same forbidden cycle in practice once anyone edits A again.
 */

export interface ArtifactReferenceEdge {
  /** The artifact that owns the reference (its DRAFT/authored version). */
  parentArtifactId: string;
  /** The artifact being referenced. */
  childArtifactId: string;
}

export interface CycleCheckResult {
  hasCycle: boolean;
  /** The cycle path (artifact ids), starting and ending at the same artifact, if found. */
  path?: string[];
}

/**
 * Checks whether adding `candidate` to `existingEdges` would introduce a cycle
 * reachable from `candidate.parentArtifactId`.
 */
export function detectCycle(
  existingEdges: ArtifactReferenceEdge[],
  candidate: ArtifactReferenceEdge,
): CycleCheckResult {
  if (candidate.parentArtifactId === candidate.childArtifactId) {
    return { hasCycle: true, path: [candidate.parentArtifactId, candidate.childArtifactId] };
  }
  const adjacency = buildAdjacency([...existingEdges, candidate]);
  const path = findPath(adjacency, candidate.childArtifactId, candidate.parentArtifactId);
  if (!path) return { hasCycle: false };
  return { hasCycle: true, path: [candidate.parentArtifactId, ...path] };
}

/**
 * Longest chain of reference edges starting at `artifactId` (in either the existing
 * graph, or the graph with `candidate` added when provided). Used to enforce
 * NESTED_TREE_MAX_DEPTH before a reference is saved: depth 1 means "the artifact's
 * own graph, no references"; each hop through a reference adds one.
 */
export function computeMaxDepthFrom(
  edges: ArtifactReferenceEdge[],
  artifactId: string,
  candidate?: ArtifactReferenceEdge,
): number {
  const adjacency = buildAdjacency(candidate ? [...edges, candidate] : edges);
  const memo = new Map<string, number>();
  const visiting = new Set<string>();

  function depthFrom(node: string): number {
    const cached = memo.get(node);
    if (cached !== undefined) return cached;
    if (visiting.has(node)) {
      // A cycle reachable from here; detectCycle() is responsible for rejecting the
      // save before this is ever called, so treat it as "unbounded" rather than loop.
      return Number.POSITIVE_INFINITY;
    }
    visiting.add(node);
    const children = adjacency.get(node) ?? [];
    const depth = children.length ? 1 + Math.max(...children.map((child) => depthFrom(child))) : 1;
    visiting.delete(node);
    memo.set(node, depth);
    return depth;
  }

  return depthFrom(artifactId);
}

/**
 * Every artifact that can reach `artifactId` through zero or more reference edges
 * (including `artifactId` itself). Used to check that adding a new edge does not push
 * any of `artifactId`'s ancestors past the configured max nesting depth, not just
 * `artifactId` itself.
 */
export function findAncestors(edges: ArtifactReferenceEdge[], artifactId: string): Set<string> {
  const reverse = new Map<string, string[]>();
  for (const edge of edges) {
    const parents = reverse.get(edge.childArtifactId) ?? [];
    parents.push(edge.parentArtifactId);
    reverse.set(edge.childArtifactId, parents);
  }
  const ancestors = new Set<string>([artifactId]);
  const queue = [artifactId];
  while (queue.length) {
    const current = queue.shift()!;
    for (const parent of reverse.get(current) ?? []) {
      if (!ancestors.has(parent)) {
        ancestors.add(parent);
        queue.push(parent);
      }
    }
  }
  return ancestors;
}

function buildAdjacency(edges: ArtifactReferenceEdge[]): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    const children = adjacency.get(edge.parentArtifactId) ?? [];
    children.push(edge.childArtifactId);
    adjacency.set(edge.parentArtifactId, children);
  }
  return adjacency;
}

/** DFS for a path from `start` to `target`. Returns the path (excluding `start`) or undefined. */
function findPath(adjacency: Map<string, string[]>, start: string, target: string): string[] | undefined {
  const visited = new Set<string>();

  function walk(node: string): string[] | undefined {
    if (node === target) return [node];
    if (visited.has(node)) return undefined;
    visited.add(node);
    for (const child of adjacency.get(node) ?? []) {
      const found = walk(child);
      if (found) return [node, ...found];
    }
    return undefined;
  }

  const result = walk(start);
  return result;
}
