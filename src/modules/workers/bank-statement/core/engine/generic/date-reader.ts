import { toIsoDate } from '../../parsers/parser-helpers';

/**
 * Cómo hay que leer las fechas de **este** documento.
 *
 * `05/07/2026` es ambigua por sí sola. Lo que la resuelve no es una preferencia
 * regional sino el propio documento: basta con que una sola fecha tenga un
 * primer componente mayor que doce para saber que el día va delante en todas.
 */
export interface DateInterpretation {
  readonly dayFirst: boolean;
  /** Año con el que completar las fechas que no lo imprimen. */
  readonly defaultYear?: string;
  /** Cuántas fechas inequívocas respaldan el orden elegido. */
  readonly evidence: number;
}

/** Bolivia escribe el día primero; es el supuesto cuando nada lo contradice. */
export const DEFAULT_DATE_INTERPRETATION: DateInterpretation = {
  dayFirst: true,
  evidence: 0,
};

const NUMERIC = /^(\d{1,4})[-/.](\d{1,2})[-/.](\d{2,4})$/;
const NUMERIC_WITHOUT_YEAR = /^(\d{1,2})[-/.](\d{1,2})$/;
const NAMED = /^(\d{1,2})[-/.\s]([A-Za-zÁÉÍÓÚáéíóú]{3,})[-/.\s]?(\d{2,4})?$/;
const SPELLED = /^(\d{1,2})\s+de\s+([A-Za-zÁÉÍÓÚáéíóú]+),?\s+(?:de\s+)?(\d{4})$/i;

export function detectDateInterpretation(
  samples: Iterable<string>,
  defaultYear?: string,
): DateInterpretation {
  let dayFirst = 0;
  let monthFirst = 0;
  for (const sample of samples) {
    const match = NUMERIC.exec(sample.trim());
    if (!match) continue;
    const [, first, second] = match;
    // Un año delante (`2026/06/01`) no dice nada del orden de los otros dos.
    if ((first ?? '').length === 4) continue;
    if (Number(first) > 12) dayFirst += 1;
    else if (Number(second) > 12) monthFirst += 1;
  }

  if (monthFirst > dayFirst) {
    return { dayFirst: false, defaultYear, evidence: monthFirst };
  }
  return { dayFirst: true, defaultYear, evidence: dayFirst };
}

export interface ReadDateResult {
  readonly iso: string;
  /** `true` si el año no estaba impreso y se completó con el del período. */
  readonly inferredYear: boolean;
}

/**
 * Lee una fecha en cualquiera de las formas que imprimen los extractos y la
 * normaliza a ISO.
 *
 * No valida el calendario por su cuenta: reescribe la fecha a una de las formas
 * que `toIsoDate()` ya sabe validar y delega. Así, un 31 de febrero se rechaza
 * en un solo sitio para todo el módulo.
 */
export function readDate(
  raw: string,
  interpretation: DateInterpretation = DEFAULT_DATE_INTERPRETATION,
): ReadDateResult {
  const text = raw.trim();
  if (!text) return { iso: '', inferredYear: false };

  const spelled = SPELLED.exec(text);
  if (spelled) {
    return { iso: toIsoDate(text), inferredYear: false };
  }

  const numeric = NUMERIC.exec(text);
  if (numeric) {
    const [, first, second, third] = numeric;
    if ((first ?? '').length === 4) {
      return {
        iso: toIsoDate(`${first}/${second}/${third}`),
        inferredYear: false,
      };
    }
    const year = expandYear(third ?? '');
    const day = interpretation.dayFirst ? first : second;
    const month = interpretation.dayFirst ? second : first;
    return { iso: toIsoDate(`${day}/${month}/${year}`), inferredYear: false };
  }

  const named = NAMED.exec(text);
  if (named) {
    const [, day, month, year] = named;
    const resolvedYear = year ? expandYear(year) : (interpretation.defaultYear ?? '');
    if (!resolvedYear) return { iso: '', inferredYear: false };
    return {
      iso: toIsoDate(`${day}/${month}/${resolvedYear}`),
      inferredYear: !year,
    };
  }

  const withoutYear = NUMERIC_WITHOUT_YEAR.exec(text);
  if (withoutYear && interpretation.defaultYear) {
    const [, first, second] = withoutYear;
    const day = interpretation.dayFirst ? first : second;
    const month = interpretation.dayFirst ? second : first;
    return {
      iso: toIsoDate(`${day}/${month}/${interpretation.defaultYear}`),
      inferredYear: true,
    };
  }

  return { iso: '', inferredYear: false };
}

/**
 * Busca la fecha **dentro** de la celda, en lugar de exigir que la celda entera
 * sea una fecha.
 *
 * Hace falta porque no todo formato rotula todas sus columnas: el extracto de
 * Banco Ganadero imprime la hora en una columna sin encabezado, que por tanto
 * cae en la banda de la fecha. Con la celda entera —`01/07/2026 10:15:00`— no
 * parsea nada, y la fila dejaría de reconocerse como movimiento.
 *
 * Se prueba primero la celda completa, porque la forma redactada
 * —`01 de junio, 2026`— ocupa varias palabras y se rompería al trocearla.
 */
export function findDate(
  raw: string,
  interpretation: DateInterpretation = DEFAULT_DATE_INTERPRETATION,
): ReadDateResult {
  const whole = readDate(raw, interpretation);
  if (whole.iso) return whole;

  for (const candidate of raw.trim().split(/\s+/)) {
    const result = readDate(candidate, interpretation);
    if (result.iso) return result;
  }
  return { iso: '', inferredYear: false };
}

export function looksLikeDate(raw: string, interpretation?: DateInterpretation): boolean {
  return findDate(raw, interpretation).iso !== '';
}

/**
 * `26` es 2026 y no 1926: los extractos que abrevian el año lo hacen sobre el
 * siglo en curso, y un extracto bancario del siglo pasado no llega en PDF.
 */
function expandYear(year: string): string {
  if (year.length === 4) return year;
  if (year.length === 2) return `20${year}`;
  return '';
}
