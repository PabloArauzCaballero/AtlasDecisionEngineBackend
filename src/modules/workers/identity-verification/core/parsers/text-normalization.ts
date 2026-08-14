/**
 * Ayudas de texto para los analizadores de documento. Absorbido sin cambios.
 *
 * Los documentos de identidad mezclan la misma palabra con y sin tilde
 * (`CÉDULA` delante, `CEDULA` detrás en la misma cédula boliviana) y el OCR
 * añade su propio ruido encima. Por eso los anclajes se buscan sobre una
 * proyección en mayúsculas y sin diacríticos, mientras que el valor extraído
 * conserva los caracteres originales.
 */

const DIACRITICS = /\p{Diacritic}/gu;

export function stripDiacritics(value: string): string {
  return value.normalize('NFD').replace(DIACRITICS, '');
}

/** Proyección en mayúsculas y sin diacríticos, sólo para localizar anclajes. */
export function normalizeForMatch(value: string): string {
  return stripDiacritics(value).toUpperCase();
}

export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** Parte el texto crudo del OCR en líneas recortadas y no vacías. */
export function toLines(rawText: string): string[] {
  return rawText
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => collapseWhitespace(line))
    .filter((line) => line.length > 0);
}

/** Distancia de edición, acotada para que un desajuste largo salga pronto. */
export function editDistance(left: string, right: string, cap = 3): number {
  if (Math.abs(left.length - right.length) > cap) return cap + 1;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    let rowMinimum = i;
    for (let j = 1; j <= right.length; j += 1) {
      const substitution = (previous[j - 1] ?? 0) + (left[i - 1] === right[j - 1] ? 0 : 1);
      const deletion = (previous[j] ?? 0) + 1;
      const insertion = (current[j - 1] ?? 0) + 1;
      const value = Math.min(substitution, deletion, insertion);
      current[j] = value;
      if (value < rowMinimum) rowMinimum = value;
    }
    if (rowMinimum > cap) return cap + 1;
    previous = current;
  }
  return previous[right.length] ?? cap + 1;
}
