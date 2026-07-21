import {
  computeMaxDepthFrom,
  detectCycle,
  findAncestors,
  type ArtifactReferenceEdge,
} from '../src/modules/nested-trees/cycle-detector';

describe('cycle-detector (nested decision trees)', () => {
  describe('detectCycle', () => {
    it('rejects a direct self-reference', () => {
      const result = detectCycle([], { parentArtifactId: 'A', childArtifactId: 'A' });
      expect(result.hasCycle).toBe(true);
      expect(result.path).toEqual(['A', 'A']);
    });

    it('allows a simple acyclic edge', () => {
      const result = detectCycle([], { parentArtifactId: 'A', childArtifactId: 'B' });
      expect(result.hasCycle).toBe(false);
    });

    it('detects a 2-artifact cycle (B already references A, now A references B)', () => {
      const existing: ArtifactReferenceEdge[] = [{ parentArtifactId: 'B', childArtifactId: 'A' }];
      const result = detectCycle(existing, { parentArtifactId: 'A', childArtifactId: 'B' });
      expect(result.hasCycle).toBe(true);
      expect(result.path).toEqual(['A', 'B', 'A']);
    });

    it('detects a longer transitive cycle (A -> B -> C, now C -> A)', () => {
      const existing: ArtifactReferenceEdge[] = [
        { parentArtifactId: 'A', childArtifactId: 'B' },
        { parentArtifactId: 'B', childArtifactId: 'C' },
      ];
      const result = detectCycle(existing, { parentArtifactId: 'C', childArtifactId: 'A' });
      expect(result.hasCycle).toBe(true);
    });

    it('allows a diamond dependency (A -> B, A -> C, B -> D, C -> D) with no cycle', () => {
      const existing: ArtifactReferenceEdge[] = [
        { parentArtifactId: 'A', childArtifactId: 'B' },
        { parentArtifactId: 'A', childArtifactId: 'C' },
        { parentArtifactId: 'B', childArtifactId: 'D' },
      ];
      const result = detectCycle(existing, { parentArtifactId: 'C', childArtifactId: 'D' });
      expect(result.hasCycle).toBe(false);
    });

    it('does not flag unrelated existing edges as a cycle', () => {
      const existing: ArtifactReferenceEdge[] = [{ parentArtifactId: 'X', childArtifactId: 'Y' }];
      const result = detectCycle(existing, { parentArtifactId: 'A', childArtifactId: 'B' });
      expect(result.hasCycle).toBe(false);
    });
  });

  describe('computeMaxDepthFrom', () => {
    it('is 1 for an artifact with no references', () => {
      expect(computeMaxDepthFrom([], 'A')).toBe(1);
    });

    it('is 2 for a single hop (A -> B)', () => {
      const edges: ArtifactReferenceEdge[] = [{ parentArtifactId: 'A', childArtifactId: 'B' }];
      expect(computeMaxDepthFrom(edges, 'A')).toBe(2);
    });

    it('follows the longest chain, not the shortest, across branches', () => {
      const edges: ArtifactReferenceEdge[] = [
        { parentArtifactId: 'A', childArtifactId: 'B' },
        { parentArtifactId: 'A', childArtifactId: 'C' },
        { parentArtifactId: 'C', childArtifactId: 'D' },
        { parentArtifactId: 'D', childArtifactId: 'E' },
      ];
      // A -> B is depth 2; A -> C -> D -> E is depth 4. Longest wins.
      expect(computeMaxDepthFrom(edges, 'A')).toBe(4);
    });

    it('accounts for a not-yet-saved candidate edge', () => {
      const edges: ArtifactReferenceEdge[] = [{ parentArtifactId: 'A', childArtifactId: 'B' }];
      const candidate: ArtifactReferenceEdge = { parentArtifactId: 'B', childArtifactId: 'C' };
      expect(computeMaxDepthFrom(edges, 'A', candidate)).toBe(3);
    });
  });

  describe('findAncestors', () => {
    it('includes the artifact itself even with no references', () => {
      expect(findAncestors([], 'A')).toEqual(new Set(['A']));
    });

    it('finds direct and transitive ancestors', () => {
      const edges: ArtifactReferenceEdge[] = [
        { parentArtifactId: 'A', childArtifactId: 'B' },
        { parentArtifactId: 'X', childArtifactId: 'A' },
      ];
      expect(findAncestors(edges, 'B')).toEqual(new Set(['B', 'A', 'X']));
    });
  });
});
