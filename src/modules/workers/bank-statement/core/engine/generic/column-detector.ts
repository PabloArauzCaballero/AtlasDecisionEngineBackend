import type { ExtractedPdf, PageLine, TextToken } from '../../domain/models';
import {
  matchHeaderField,
  normalizeHeaderText,
  type CanonicalField,
  type ExtraAliases,
} from './header-lexicon';

export interface DetectedColumn {
  readonly field: CanonicalField | 'unknown';
  readonly label: string;
  /** Bordes como fracción del ancho de página, igual que el resto del módulo. */
  readonly start: number;
  readonly end: number;
}

export interface TableLayout {
  readonly columns: readonly DetectedColumn[];
  readonly fields: ReadonlySet<CanonicalField>;
  readonly headerText: string;
  readonly page: number;
}

export interface TableRegion {
  readonly layout: TableLayout;
  /** Renglones que hay debajo de esa cabecera y antes de la siguiente. */
  readonly lines: readonly PageLine[];
  /** Índice del primer renglón dentro del documento completo. */
  readonly startIndex: number;
}

/**
 * Rótulos distintos que debe reconocer una línea para considerarse cabecera.
 *
 * Con uno solo, cualquier renglón que diga «Saldo» —incluido el bloque de
 * totales del pie— se tomaría por cabecera de tabla. Con dos, hace falta que
 * coincidan dos campos canónicos diferentes, que es lo que caracteriza a una
 * fila de encabezados y no a una etiqueta suelta.
 */
const MINIMUM_HEADER_FIELDS = 2;

/** Máximo de fichas que se juntan para reconocer un rótulo de varias palabras. */
const MAX_LABEL_TOKENS = 4;

/**
 * Localiza las tablas del documento y traduce sus encabezados a campos
 * canónicos.
 *
 * Devuelve una región por cabecera encontrada, no una por página: es lo que
 * permite manejar a la vez los dos casos difíciles —**varias tablas en la misma
 * página**, con rejillas distintas, y **una tabla que continúa en la página
 * siguiente** repitiendo o no su encabezado—, sin tratarlos como situaciones
 * separadas.
 */
export function detectTables(pdf: ExtractedPdf, extra?: ExtraAliases): TableRegion[] {
  const headerIndexes: number[] = [];
  const layouts: TableLayout[] = [];

  pdf.lines.forEach((line, index) => {
    const layout = headerLayout(line, extra);
    if (!layout) return;
    headerIndexes.push(index);
    layouts.push(layout);
  });

  return layouts.map((layout, position) => {
    const start = (headerIndexes[position] ?? 0) + 1;
    const end = headerIndexes[position + 1] ?? pdf.lines.length;
    return { layout, lines: pdf.lines.slice(start, end), startIndex: start };
  });
}

/**
 * Interpreta una línea como fila de encabezados. Devuelve `undefined` si no
 * reconoce suficientes rótulos.
 */
export function headerLayout(line: PageLine, extra?: ExtraAliases): TableLayout | undefined {
  if (line.tokens.length === 0) return undefined;
  const segments = labelSegments(line, extra);
  const fields = new Set<CanonicalField>();
  for (const segment of segments) {
    if (segment.field !== 'unknown') fields.add(segment.field);
  }
  if (fields.size < MINIMUM_HEADER_FIELDS) return undefined;

  const columns: DetectedColumn[] = segments.map((segment, index) => ({
    field: segment.field,
    label: segment.label,
    // La primera columna empieza en el borde de la página y la última llega
    // hasta el final: los datos de una columna alineada pueden sobresalir del
    // rótulo por cualquiera de los dos lados.
    start: index === 0 ? 0 : segment.start,
    end: segments[index + 1]?.start ?? 1,
  }));

  return {
    columns,
    fields,
    headerText: line.text,
    page: line.page,
  };
}

interface LabelSegment {
  readonly field: CanonicalField | 'unknown';
  readonly label: string;
  readonly start: number;
}

/**
 * Agrupa las fichas de la cabecera en rótulos.
 *
 * Recorre de izquierda a derecha probando primero las ventanas más largas, para
 * que `fecha valor` no se lea como `fecha` y `nro documento` no se lea como un
 * `documento` que pertenece a otra columna. Las fichas contiguas que no
 * corresponden a ningún campo conocido se funden en un solo rótulo
 * desconocido: separarlas fabricaría columnas que no existen.
 */
function labelSegments(line: PageLine, extra?: ExtraAliases): LabelSegment[] {
  const tokens = line.tokens;
  const segments: LabelSegment[] = [];
  let index = 0;

  while (index < tokens.length) {
    const matched = longestMatch(tokens, index, line.pageWidth, extra);
    if (matched) {
      segments.push(matched.segment);
      index += matched.length;
      continue;
    }

    const token = tokens[index];
    if (!token) break;
    const start = token.x / line.pageWidth;
    const previous = segments.at(-1);
    if (previous?.field === 'unknown') {
      segments[segments.length - 1] = {
        ...previous,
        label: `${previous.label} ${token.text}`.trim(),
      };
    } else {
      segments.push({ field: 'unknown', label: token.text, start });
    }
    index += 1;
  }

  return segments;
}

function longestMatch(
  tokens: readonly TextToken[],
  index: number,
  pageWidth: number,
  extra?: ExtraAliases,
): { segment: LabelSegment; length: number } | undefined {
  const maxWindow = Math.min(MAX_LABEL_TOKENS, tokens.length - index);
  for (let size = maxWindow; size >= 1; size -= 1) {
    const window = tokens.slice(index, index + size);
    const label = window.map((token) => token.text).join(' ');
    const field = matchHeaderField(label, extra);
    const first = window[0];
    if (!field || !first) continue;
    return {
      segment: {
        field,
        label: normalizeHeaderText(label),
        start: first.x / pageWidth,
      },
      length: size,
    };
  }
  return undefined;
}

/**
 * Reparte las fichas de una línea entre las columnas de la tabla.
 *
 * La asignación es por **solapamiento horizontal**, no por el borde izquierdo
 * de la ficha, y esa diferencia es la que hace que funcione con columnas
 * alineadas a la derecha: en el extracto de Banco Mercantil, el saldo
 * `11,620.04` empieza a la izquierda del rótulo `SALDO` e invadiría la columna
 * de créditos si se mirara solo dónde empieza. Comparando cuánto ocupa la ficha
 * dentro de cada banda, gana la columna correcta sin necesidad de saber de
 * antemano cómo está alineada.
 */
export function assignToColumns(
  line: PageLine,
  columns: readonly DetectedColumn[],
): Map<number, string[]> {
  const assigned = new Map<number, string[]>();
  for (const token of line.tokens) {
    const start = token.x / line.pageWidth;
    const end = start + token.width / line.pageWidth;
    let bestIndex = -1;
    let bestOverlap = 0;

    columns.forEach((column, index) => {
      const overlap = Math.min(end, column.end) - Math.max(start, column.start);
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestIndex = index;
      }
    });

    // Una ficha sin ancho medible —o fuera de toda banda— se adjudica por su
    // borde izquierdo, que es la única posición de la que se tiene certeza.
    if (bestIndex < 0) {
      bestIndex = columns.findIndex((column) => start >= column.start && start < column.end);
    }
    if (bestIndex < 0) continue;

    const bucket = assigned.get(bestIndex) ?? [];
    bucket.push(token.text);
    assigned.set(bestIndex, bucket);
  }
  return assigned;
}

/** Texto de una línea en la primera columna asociada a un campo canónico. */
export function columnText(
  assigned: ReadonlyMap<number, string[]>,
  columns: readonly DetectedColumn[],
  field: CanonicalField,
): string {
  for (const [index, column] of columns.entries()) {
    if (column.field !== field) continue;
    const value = assigned.get(index)?.join(' ').trim();
    if (value) return value;
  }
  return '';
}
