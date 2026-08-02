/**
 * Coloca los nodos sembrados como un árbol de izquierda a derecha.
 *
 * Las coordenadas de un nodo son PORCENTAJES (0–100) del "mundo" del lienzo del
 * editor (~1680x1020 px), no píxeles: el editor las lee tal cual. La siembra
 * anterior escribía `xPos = order * 160` (píxeles, todos en `y = 100`), que cae
 * fuera de ese rango, así que el editor tenía que re-acomodar el grafo entero al
 * abrirlo y el resultado se veía apelmazado. Aquí se calcula el mismo layout que
 * usa el editor (`graph-layout.ts`: niveles por camino más largo + baricentro),
 * de modo que lo sembrado ya se ve como un árbol legible.
 */

/** Separación entre columnas y entre filas, en % del mundo (~235 px y ~133 px). */
const COLUMN_PITCH = 14;
const ROW_PITCH = 13;

export interface LayoutNode {
  key: string;
  type: string;
}

export interface LayoutEdge {
  from: string;
  to: string;
}

export interface NodePosition {
  x: number;
  y: number;
}

export function layoutSeedNodes(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
): Map<string, NodePosition> {
  const positions = new Map<string, NodePosition>();
  if (!nodes.length) return positions;

  const keys = nodes.map((node) => node.key);
  const keySet = new Set(keys);
  const incoming = new Map<string, string[]>(keys.map((key) => [key, []]));
  const outgoing = new Map<string, string[]>(keys.map((key) => [key, []]));
  for (const edge of edges) {
    if (!keySet.has(edge.from) || !keySet.has(edge.to) || edge.from === edge.to) continue;
    outgoing.get(edge.from)!.push(edge.to);
    incoming.get(edge.to)!.push(edge.from);
  }

  const levels = longestPathLevels(nodes, keys, incoming, outgoing);
  const columns = new Map<number, string[]>();
  for (const key of keys) {
    const level = levels.get(key) ?? 0;
    columns.set(level, [...(columns.get(level) ?? []), key]);
  }
  orderRowsByBarycentre(columns, levels, incoming, outgoing);

  const maxLevel = Math.max(0, ...columns.keys());
  const maxRows = Math.max(1, ...[...columns.values()].map((column) => column.length));
  const columnPitch = maxLevel ? Math.min(COLUMN_PITCH, 84 / maxLevel) : 0;
  const rowPitch = maxRows > 1 ? Math.min(ROW_PITCH, 80 / (maxRows - 1)) : 0;

  for (const [level, column] of columns) {
    const columnHeight = (column.length - 1) * rowPitch;
    const top = 8 + ((maxRows - 1) * rowPitch - columnHeight) / 2;
    column.forEach((key, row) => {
      positions.set(key, {
        x: round(maxLevel ? 4 + level * columnPitch : 38),
        y: round(top + row * rowPitch),
      });
    });
  }
  return positions;
}

const round = (value: number) => Math.round(value * 100) / 100;

/** Nivel = 1 + máximo nivel de los predecesores; los ciclos caen en la última columna. */
function longestPathLevels(
  nodes: LayoutNode[],
  keys: string[],
  incoming: Map<string, string[]>,
  outgoing: Map<string, string[]>,
): Map<string, number> {
  const startKey = nodes.find((node) => node.type === 'START')?.key ?? '';
  const indegree = new Map(keys.map((key) => [key, incoming.get(key)!.length]));
  const levels = new Map<string, number>();
  const queue = keys.filter((key) => key === startKey || indegree.get(key) === 0);
  for (const key of queue) levels.set(key, 0);

  while (queue.length) {
    const key = queue.shift()!;
    const base = levels.get(key) ?? 0;
    for (const next of outgoing.get(key)!) {
      levels.set(next, Math.max(levels.get(next) ?? 0, base + 1));
      indegree.set(next, (indegree.get(next) ?? 1) - 1);
      if ((indegree.get(next) ?? 0) <= 0 && !queue.includes(next)) queue.push(next);
    }
  }

  const connectedMax = Math.max(0, ...levels.values());
  for (const key of keys) if (!levels.has(key)) levels.set(key, connectedMax + 1);
  return levels;
}

/** Dos barridas por baricentro para reducir cruces manteniendo el orden estable. */
function orderRowsByBarycentre(
  columns: Map<number, string[]>,
  levels: Map<string, number>,
  incoming: Map<string, string[]>,
  outgoing: Map<string, string[]>,
): void {
  const sortedLevels = [...columns.keys()].sort((a, b) => a - b);
  const rowIndex = new Map<string, number>();
  const reindex = () => {
    for (const level of sortedLevels) {
      columns.get(level)!.forEach((key, row) => rowIndex.set(key, row));
    }
  };
  reindex();

  const sweep = (order: number[], neighbours: Map<string, string[]>) => {
    for (const level of order) {
      const column = columns.get(level)!;
      const barycentre = new Map<string, number>();
      column.forEach((key, row) => {
        const rows = neighbours
          .get(key)!
          .filter((other) => levels.get(other) !== level)
          .map((other) => rowIndex.get(other) ?? 0);
        barycentre.set(key, rows.length ? rows.reduce((a, b) => a + b, 0) / rows.length : row);
      });
      column.sort((a, b) => barycentre.get(a)! - barycentre.get(b)!);
      reindex();
    }
  };

  sweep(sortedLevels, incoming);
  sweep([...sortedLevels].reverse(), outgoing);
}
