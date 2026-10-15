import type { CompiledDecisionArtifact, GraphNodeSnapshot } from '../../graph/graph.types';

const MAX_PATH_DEPTH = 40;

/** Los desenlaces que el grafo alcanza de verdad, en orden estable. */
export function reachableOutcomeKeys(compiled: CompiledDecisionArtifact): string[] {
  return [...pathsByOutcome(compiled).keys()];
}

/**
 * Lo mismo, con el nombre que se enseña en pantalla.
 *
 * Va aparte de `reachableOutcomeKeys` porque quien reparte pesos necesita la CLAVE
 * —`nodeKey`, que es lo que valida el servicio— y quien elige en la interfaz necesita el
 * RÓTULO. Devolver sólo uno obligaba a la pantalla a inventar el otro.
 */
export function describeOutcomes(
  compiled: CompiledDecisionArtifact,
): Array<{ nodeKey: string; label: string }> {
  return reachableOutcomeKeys(compiled).map((nodeKey) => ({
    nodeKey,
    label: outcomeLabel(compiled, nodeKey),
  }));
}

/** El primer camino hasta cada terminal. Uno por desenlace: los demás llegan al mismo sitio. */
export function pathsByOutcome(compiled: CompiledDecisionArtifact): Map<string, string[]> {
  const byOutcome = new Map<string, string[]>();
  for (const path of enumeratePaths(compiled)) {
    const terminal = path[path.length - 1];
    if (!byOutcome.has(terminal)) byOutcome.set(terminal, path);
  }
  return byOutcome;
}

/** Todos los caminos nodo a nodo desde el inicio hasta un terminal, sin repetir nodo. */
function enumeratePaths(compiled: CompiledDecisionArtifact): string[][] {
  const found: string[][] = [];
  const walk = (nodeKey: string, trail: string[]): void => {
    if (trail.length > MAX_PATH_DEPTH || found.length > 200) return;
    const node = compiled.nodes[nodeKey];
    if (!node) return;
    const next = compiled.edgesByNode[nodeKey] ?? [];
    // Un nodo terminal cierra el camino aunque tenga aristas colgando: el motor no
    // sigue después de él, y seguir aquí inventaría desenlaces que no ocurren.
    if (node.terminal || !next.length) {
      found.push([...trail, nodeKey]);
      return;
    }
    for (const edge of next) {
      if (trail.includes(edge.to)) continue;
      walk(edge.to, [...trail, nodeKey]);
    }
  };
  walk(compiled.startNodeKey, []);
  return found;
}

/** Cómo se llama el desenlace: la acción terminal manda sobre la etiqueta del nodo. */
export function outcomeLabel(compiled: CompiledDecisionArtifact, nodeKey: string): string {
  const node: GraphNodeSnapshot | undefined = compiled.nodes[nodeKey];
  if (!node) return nodeKey;
  const terminalAction = [...node.actions]
    .sort((a, b) => a.order - b.order)
    .map((reference) => compiled.actions[reference.code])
    .find((action) => action?.terminal);
  const outcome = terminalAction?.payload?.outcome ?? terminalAction?.payload?.value;
  if (typeof outcome === 'string' && outcome.trim()) return outcome;
  return node.label || nodeKey;
}
