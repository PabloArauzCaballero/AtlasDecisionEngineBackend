import { parseSpanishDate } from '../spanish-date';
import type { Extraction } from './ci-source-lines';

/**
 * Fecha normalizada, eligiendo cuál cuando el renglón trae más de una.
 *
 * La cédula vigente imprime `FECHA DE EMISION` y `FECHA DE EXPIRACION` UNA AL
 * LADO DE LA OTRA, y el reconocedor devuelve los dos rótulos en un renglón y
 * los dos valores en el siguiente: `01/11/2023 01/11/2028`. Quedarse con la
 * primera fecha daba la de emisión como caducidad y **declaraba caducado un
 * documento vigente** — un rechazo silencioso sobre alguien que no había
 * hecho nada mal.
 *
 * Se resuelve con un hecho del documento y no con posiciones de píxeles: la
 * emisión SIEMPRE es anterior a la expiración. Así el criterio sobrevive a
 * que el reconocedor cambie el orden de las columnas.
 */
export function fechaNormalizada(
  extraction: Extraction | null,
  cual: 'primera' | 'ultima' = 'primera',
): Extraction | null {
  if (!extraction) return null;
  const fechas = todasLasFechas(extraction.value);
  if (fechas.length === 0) return null;
  const elegida = cual === 'ultima' ? fechas[fechas.length - 1] : fechas[0];
  return { value: elegida, confidence: extraction.confidence };
}

/** Todas las fechas de un texto, en el orden en que aparecen y ya en ISO. */
export function todasLasFechas(texto: string): string[] {
  const trozos = texto.match(/\d{1,4}[/\-.]\d{1,2}[/\-.]\d{2,4}|\d{1,2}\s+DE\s+\S+\s+DE\s+\d{4}/gi);
  const candidatos = trozos && trozos.length > 0 ? trozos : [texto];
  return candidatos
    .map((trozo) => parseSpanishDate(trozo)?.iso)
    .filter((iso): iso is string => Boolean(iso));
}
