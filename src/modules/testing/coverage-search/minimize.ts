import type { CoverageCase } from './types';

/**
 * La suite más corta que conserva la cobertura: en cada vuelta, el caso que más aporta.
 * Los casos se guardaron según aparecieron, y los primeros suelen quedar tapados por otros.
 */
export function minimize(kept: CoverageCase[]): CoverageCase[] {
  const target = new Set<string>();
  const items = (item: CoverageCase) => [
    ...item.observation.visitedNodeKeys.map((key) => `n:${key}`),
    ...item.observation.traversedEdgeKeys.map((key) => `e:${key}`),
  ];
  kept.forEach((item) => items(item).forEach((key) => target.add(key)));
  const chosen: CoverageCase[] = [];
  const remaining = [...kept];
  while (target.size && remaining.length) {
    let best = 0;
    let bestGain = -1;
    remaining.forEach((item, index) => {
      const gain = items(item).filter((key) => target.has(key)).length;
      if (gain > bestGain) {
        best = index;
        bestGain = gain;
      }
    });
    if (bestGain <= 0) break;
    const [picked] = remaining.splice(best, 1);
    items(picked).forEach((key) => target.delete(key));
    chosen.push(picked);
  }
  return chosen;
}
