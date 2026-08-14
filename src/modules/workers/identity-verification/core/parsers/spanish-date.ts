import { collapseWhitespace, editDistance, normalizeForMatch } from './text-normalization';

/**
 * Normaliza a ISO-8601 los formatos de fecha que imprimen los documentos de
 * identidad en español. Absorbido sin cambios.
 *
 * Una cédula boliviana escribe las fechas con letra (`7 de Diciembre de 2001`,
 * `26 de Enero de 2026`); otros documentos usan formas numéricas. Los nombres
 * de mes se comparan con una tolerancia de edición pequeña porque el OCR
 * confunde de forma rutinaria `i`/`l` y `o`/`0` dentro de ellos.
 */

const MONTHS = [
  'ENERO',
  'FEBRERO',
  'MARZO',
  'ABRIL',
  'MAYO',
  'JUNIO',
  'JULIO',
  'AGOSTO',
  'SEPTIEMBRE',
  'OCTUBRE',
  'NOVIEMBRE',
  'DICIEMBRE',
] as const;

/** `SETIEMBRE` es una grafía latinoamericana común y legítima. */
const MONTH_ALIASES: Record<string, number> = { SETIEMBRE: 9, SEPBRE: 9, SBRE: 9 };

export interface NormalizedDate {
  /** Fecha de calendario ISO-8601, `YYYY-MM-DD`. */
  iso: string;
  /** El texto del que salió, antes de normalizar. */
  raw: string;
}

function monthFromName(candidate: string): number | null {
  const normalized = normalizeForMatch(candidate).replace(/[^A-Z]/g, '');
  if (!normalized) return null;
  const alias = MONTH_ALIASES[normalized];
  if (alias) return alias;

  let best: { month: number; distance: number } | null = null;
  for (const [index, month] of MONTHS.entries()) {
    if (normalized === month) return index + 1;
    // Formas abreviadas como `DIC` o `SEP.` son inequívocas con tres letras.
    if (normalized.length >= 3 && month.startsWith(normalized)) return index + 1;
    const distance = editDistance(normalized, month, 2);
    if (distance <= 2 && (!best || distance < best.distance)) best = { month: index + 1, distance };
  }
  return best ? best.month : null;
}

function toIso(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (year < 1900 || year > 2200) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  // Rechaza fechas imposibles como el 31 de febrero, que JavaScript desborda.
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Analiza `<día> de <mes> de <año>` y las formas numéricas comunes. Las
 * numéricas se leen con el día delante, que es la convención en Bolivia.
 */
export function parseSpanishDate(input: string | null | undefined): NormalizedDate | null {
  if (!input) return null;
  const raw = collapseWhitespace(input);
  if (!raw) return null;

  const spelled =
    /(\d{1,2})\s*(?:DE|DEL)?\s*[.\-/ ]?\s*([A-Za-zÀ-ÿ.]{3,12})\s*(?:DE|DEL)?\s*[.\-/ ]?\s*(\d{4})/i.exec(
      normalizeForMatch(raw),
    );
  if (spelled) {
    const month = monthFromName(spelled[2] ?? '');
    const day = Number(spelled[1]);
    const year = Number(spelled[3]);
    if (month) {
      const iso = toIso(year, month, day);
      if (iso) return { iso, raw };
    }
  }

  const numeric = /(\d{1,2})\s*[/\-.]\s*(\d{1,2})\s*[/\-.]\s*(\d{2,4})/.exec(raw);
  if (numeric) {
    const day = Number(numeric[1]);
    const month = Number(numeric[2]);
    const rawYear = Number(numeric[3]);
    // Los años de dos cifras en un documento de identidad son abrumadoramente
    // nacimientos 19xx/20xx y caducidades 20xx; el corte de siglo en 70 cubre
    // los dos casos sin adivinar.
    const year = rawYear >= 1000 ? rawYear : rawYear >= 70 ? 1900 + rawYear : 2000 + rawYear;
    const iso = toIso(year, month, day);
    if (iso) return { iso, raw };
  }

  const isoLike = /(\d{4})\s*[/\-.]\s*(\d{1,2})\s*[/\-.]\s*(\d{1,2})/.exec(raw);
  if (isoLike) {
    const iso = toIso(Number(isoLike[1]), Number(isoLike[2]), Number(isoLike[3]));
    if (iso) return { iso, raw };
  }

  return null;
}

/** Interpreta una fecha ISO como un instante a medianoche UTC. */
export function isoDateToUtcDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}
