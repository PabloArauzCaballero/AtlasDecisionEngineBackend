import type { ExtractedPdf, PageLine } from '../../../domain/models';
import { type TableRegion } from '../column-detector';
import { findAccountNumbers } from '../metadata-extractor';
import { FURNITURE_MIN_PAGES, FURNITURE_Y_TOLERANCE } from './settings';

/**
 * Renglones que no acabaron dentro de ninguna fila **y que no son el
 * encabezado o el pie que la página repite**.
 *
 * La distinción es el motivo de que esta función exista. «Renglones no
 * atribuidos» se publica como advertencia y se lee como pérdida de datos, y en
 * un documento paginado la inmensa mayoría no lo era: el membrete, el número de
 * página y el aviso legal del pie caen fuera de toda fila por definición. Un
 * extracto de sesenta páginas leído al completo —1.200 filas, ni una perdida—
 * advertía de 415 renglones sueltos, de los cuales 398 eran su propio
 * mobiliario. Con la advertencia inflada así, la que sí importa —un movimiento
 * partido que no se pudo recomponer— queda enterrada.
 *
 * Se cuenta sobre los SOBRANTES y no se filtra la entrada a propósito: lo que
 * cambia es el recuento, nunca lo que compone una fila, así que esta heurística
 * no puede perder un movimiento por más que se equivoque.
 */
export function countOrphans(
  region: TableRegion,
  rows: readonly { readonly lines: readonly PageLine[] }[],
  isFurniture: (line: PageLine) => boolean,
): number {
  const attached = new Set<PageLine>();
  for (const row of rows) for (const line of row.lines) attached.add(line);
  return region.lines.filter((line) => !attached.has(line) && !isFurniture(line)).length;
}

/**
 * Reconoce el mobiliario de página: lo que se repite igual, a la misma altura,
 * en varias páginas.
 *
 * Las dos condiciones se necesitan mutuamente. Sólo por texto, una glosa
 * recurrente —«COMISION MANTENIMIENTO CUENTA»— pasaría por membrete; sólo por
 * altura, cualquier renglón de una tabla regular coincidiría con el de la
 * página siguiente. Juntas describen lo que de verdad es un encabezado: el mismo
 * contenido impreso en el mismo sitio de cada hoja.
 *
 * Las cifras se enmascaran porque el mobiliario suele llevar la única parte que
 * cambia —«PAGINA 3 / 60», el saldo de la página— dentro de un texto por lo
 * demás idéntico.
 */
export function pageFurniture(pdf: ExtractedPdf): (line: PageLine) => boolean {
  if (pdf.pageCount < FURNITURE_MIN_PAGES) return () => false;

  const key = (line: PageLine): string =>
    `${Math.round(line.y / FURNITURE_Y_TOLERANCE)}|${line.text.replace(/\d/g, '#')}`;

  const pagesByKey = new Map<string, Set<number>>();
  for (const line of pdf.lines) {
    const pages = pagesByKey.get(key(line)) ?? new Set<number>();
    pages.add(line.page);
    pagesByKey.set(key(line), pages);
  }

  return (line) => (pagesByKey.get(key(line))?.size ?? 0) >= FURNITURE_MIN_PAGES;
}

/**
 * Cuenta vigente en cada renglón del documento: la última rotulada por encima
 * de él. Es lo que permite atribuir cada tabla a su cuenta en un extracto que
 * publica varias.
 */
export function accountsByLine(pdf: ExtractedPdf): string[] {
  let current = '';
  return pdf.lines.map((line) => {
    const found = findAccountNumbers(line.text);
    if (found[0]) current = found[0];
    return current;
  });
}

export function lastAccountBefore(accountByLine: readonly string[], index: number): string {
  return accountByLine[Math.max(0, index - 1)] ?? '';
}
