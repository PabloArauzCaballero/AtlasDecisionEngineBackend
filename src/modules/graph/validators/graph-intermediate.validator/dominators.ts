import type { ArtifactGraphSnapshot } from '../../graph.types';

/**
 * Dominadores por iteración de punto fijo: `dom(n)` es el conjunto de nodos por los que
 * pasa OBLIGATORIAMENTE cualquier camino desde START hasta `n`. Es la única forma
 * correcta de responder "¿está esta variable siempre creada cuando llego aquí?" en un
 * grafo con ramas; una simple búsqueda de alcanzabilidad diría que sí en cuanto exista
 * UN camino que pase por el productor.
 */
export function computeDominators(snapshot: ArtifactGraphSnapshot): Map<string, Set<string>> {
  const start = snapshot.nodes.find((node) => node.type === 'START');
  const allKeys = snapshot.nodes.map((node) => node.key);
  const dominators = new Map<string, Set<string>>();
  if (!start) return dominators;

  const predecessors = new Map<string, string[]>();
  for (const edge of snapshot.edges) {
    predecessors.set(edge.to, [...(predecessors.get(edge.to) ?? []), edge.from]);
  }
  for (const key of allKeys) {
    dominators.set(key, key === start.key ? new Set([start.key]) : new Set(allKeys));
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const key of allKeys) {
      if (key === start.key) continue;
      const preds = predecessors.get(key) ?? [];
      // Un nodo inalcanzable no tiene predecesores: su conjunto se queda vacío para
      // que ninguna lectura suya se considere "cubierta" por accidente.
      let intersection: Set<string> = preds.length
        ? new Set(dominators.get(preds[0]) ?? [])
        : new Set();
      for (const pred of preds.slice(1)) {
        const predDom = dominators.get(pred) ?? new Set<string>();
        intersection = new Set([...intersection].filter((entry) => predDom.has(entry)));
      }
      intersection.add(key);
      const current = dominators.get(key)!;
      if (intersection.size !== current.size || [...intersection].some((e) => !current.has(e))) {
        dominators.set(key, intersection);
        changed = true;
      }
    }
  }
  return dominators;
}
