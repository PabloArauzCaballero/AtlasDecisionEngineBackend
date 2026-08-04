import type { PageLine } from '../../domain/models';

export interface AssembledRow {
  /** Renglón que lleva la fecha del movimiento. */
  readonly anchor: PageLine;
  /** Todos los renglones de la fila, en orden de lectura. */
  readonly lines: readonly PageLine[];
}

export interface RowAssembly {
  readonly rows: readonly AssembledRow[];
  /** Renglones que no se pudieron atribuir a ninguna fila. */
  readonly orphanLines: number;
  /** Separación vertical típica entre renglones de la región. */
  readonly typicalGap: number;
}

/**
 * Factor sobre la separación típica a partir del cual un renglón deja de
 * pertenecer a la fila.
 *
 * Solo se aplica en los extremos —antes de la primera fecha y después de la
 * última—, que es donde no hay un ancla siguiente con la que comparar. Entre
 * dos anclas la frontera se decide comparando, sin umbral.
 */
const EDGE_GAP_FACTOR = 1.5;

/**
 * Reconstruye los movimientos a partir de los renglones de una tabla.
 *
 * El problema real no es unir líneas, sino **saber dónde termina un movimiento
 * y empieza el siguiente**, y las plantillas medidas se reparten en dos
 * familias que parecen exigir algoritmos distintos: unas escriben la glosa
 * debajo de la fecha y otras la centran verticalmente sobre ella, de modo que
 * parte del texto queda *encima* del renglón que lleva la fecha.
 *
 * Ambas se resuelven con una sola regla, y sin umbrales: entre dos fechas
 * consecutivas, la frontera está en el **mayor salto vertical** del tramo,
 * porque el interlineado dentro de una celda siempre es menor que la separación
 * entre filas. Es una comparación relativa, así que no depende del cuerpo
 * tipográfico con el que el banco haya impreso el documento.
 */
export function assembleRows(
  lines: readonly PageLine[],
  isAnchor: (line: PageLine) => boolean,
): RowAssembly {
  const anchors = lines.flatMap((line, index) => (isAnchor(line) ? [index] : []));
  if (anchors.length === 0) {
    return { rows: [], orphanLines: lines.length, typicalGap: 0 };
  }

  const gaps = verticalGaps(lines);
  const typicalGap = median(gaps.filter(Number.isFinite));
  const maxEdgeGap = typicalGap * EDGE_GAP_FACTOR;

  const boundaries: number[] = [];
  for (let position = 1; position < anchors.length; position += 1) {
    const from = anchors[position - 1] ?? 0;
    const to = anchors[position] ?? 0;
    let boundary = to;
    let widest = Number.NEGATIVE_INFINITY;
    for (let index = from + 1; index <= to; index += 1) {
      const gap = gaps[index] ?? 0;
      // `>=` y no `>`: con separaciones iguales —una plantilla de interlineado
      // uniforme— el empate se resuelve dejando los renglones con la fila
      // **anterior**, que es donde va la glosa en cinco de los siete formatos
      // medidos. Quedarse con el primer máximo se los daría a la fila
      // siguiente, partiendo cada movimiento en dos.
      if (gap >= widest) {
        widest = gap;
        boundary = index;
      }
    }
    boundaries.push(boundary);
  }

  const firstAnchor = anchors[0] ?? 0;
  const lastAnchor = anchors.at(-1) ?? 0;
  const start = edgeStart(firstAnchor, gaps, maxEdgeGap);
  const end = edgeEnd(lastAnchor, lines.length, gaps, maxEdgeGap);

  const starts = [start, ...boundaries];
  const ends = [...boundaries, end];

  const rows: AssembledRow[] = [];
  let assigned = 0;
  anchors.forEach((anchorIndex, position) => {
    const from = starts[position] ?? anchorIndex;
    const to = ends[position] ?? anchorIndex + 1;
    const anchor = lines[anchorIndex];
    if (!anchor) return;
    const rowLines = lines.slice(from, to);
    assigned += rowLines.length;
    rows.push({ anchor, lines: rowLines });
  });

  return { rows, orphanLines: lines.length - assigned, typicalGap };
}

/**
 * Un cambio de página no es una separación medible: se marca como infinita para
 * que nunca una fila absorba renglones de la página siguiente. Un movimiento
 * partido por un salto de página deja sus renglones sueltos, contados como
 * huérfanos, en lugar de pegarse a un encabezado repetido.
 */
function verticalGaps(lines: readonly PageLine[]): number[] {
  return lines.map((line, index) => {
    if (index === 0) return Number.POSITIVE_INFINITY;
    const previous = lines[index - 1];
    if (!previous) return Number.POSITIVE_INFINITY;
    if (previous.page !== line.page) return Number.POSITIVE_INFINITY;
    return previous.y - line.y;
  });
}

function edgeStart(firstAnchor: number, gaps: readonly number[], maxEdgeGap: number): number {
  let start = firstAnchor;
  while (start > 0 && (gaps[start] ?? Infinity) <= maxEdgeGap) start -= 1;
  return start;
}

function edgeEnd(
  lastAnchor: number,
  total: number,
  gaps: readonly number[],
  maxEdgeGap: number,
): number {
  let end = lastAnchor + 1;
  while (end < total && (gaps[end] ?? Infinity) <= maxEdgeGap) end += 1;
  return end;
}

/**
 * Mediana **inferior**: con un número par de separaciones se queda con la menor
 * de las dos centrales.
 *
 * La diferencia importa con pocas filas. Una región de dos separaciones —una
 * dentro de la fila y otra que la separa del pie— tiene como mediana alta
 * justamente el hueco del pie, y con ella el pie acabaría dentro de la última
 * fila. La mediana inferior representa el interlineado, que es lo que se busca.
 */
function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)] ?? 0;
}
