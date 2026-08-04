import type { PageLine, TextToken } from '../../domain/models';

/**
 * Lee el valor asociado a un rótulo de carátula usando la **geometría** del
 * documento y no solo su texto.
 *
 * Un extracto rotula sus metadatos de tres formas, y las tres aparecen en el
 * mismo documento:
 *
 * 1. `Saldo final: Bs 29.452,01` — rótulo y valor en la misma celda.
 * 2. `Titular │ CLIENTE DEMO` — valor en la celda contigua de la derecha.
 * 3. Una tarjeta de resumen, con los rótulos en un renglón y sus importes en el
 *    siguiente, cada uno bajo el suyo.
 *
 * Leer esto con una expresión regular sobre el texto plano resuelve (1) y (2),
 * pero en (3) devuelve **el valor equivocado**: `saldo final\s*(importe)` casa
 * con el primer número que aparezca después del rótulo, que es el de la primera
 * tarjeta —el saldo inicial— porque el renglón de rótulos se lee entero antes
 * que el de importes. Un saldo final incorrecto es peor que un saldo final
 * ausente: nadie lo revisa. De ahí que la búsqueda hacia abajo exija
 * solapamiento horizontal con el rótulo.
 */

/**
 * Celdas que son un rótulo y nada más. Sin esta lista, el titular de
 * `Titular │ CLIENTE DEMO │ Moneda │ Bolivianos` se leería hasta el final del
 * renglón, arrastrando el rótulo de la derecha y su valor.
 *
 * La coincidencia es de la celda **entera** y no de su comienzo, a propósito:
 * `CLIENTE DEMOSTRACION QA` empieza por un rótulo conocido pero es un valor, y
 * descartarlo dejaría al titular sin nombre.
 */
const LABEL_ONLY_CELL =
  /^(?:titular(?:es)?|cliente|beneficiario|nombre\s+del\s+titular|cuenta|nro\.?\s*(?:de\s+)?cuenta|numero\s+de\s+cuenta|account(?:\s+(?:number|no|holder|type))?|moneda|divisa|currency|tipo(?:\s+de\s+cuenta)?|producto|documento|comprobante|sucursal|agencia|oficina|branch|per[ií]odo|fecha(?:\s+(?:desde|hasta|inicial|final|de\s+corte))?|desde|hasta|saldos?(?:\s+(?:inicial|final|anterior|actual|disponible|al\s+cierre))?|totales?(?:\s+(?:de\s+)?(?:debitos?|creditos?))?|generado|emitido|impreso|estado|canal|ejecutivo|direccion|nit|ci|pagina)\s*[:.]?$/;

function isLabelOnly(value: string): boolean {
  return LABEL_ONLY_CELL.test(foldLabel(value).trim());
}

/** Separadores entre un rótulo y su valor dentro de la misma celda. */
const LABEL_SEPARATOR = /^[\s:.\-–—]+/;

/**
 * Renglones que se inspeccionan por debajo de un rótulo. Dos permiten que entre
 * la tarjeta y su importe se cuele un renglón de unidades o de moneda; más
 * abajo ya no hay relación visual que justifique atribuir el valor al rótulo.
 */
const MAX_LINES_BELOW = 2;

/**
 * Solapamiento horizontal mínimo entre el rótulo y el valor de abajo, como
 * fracción del más estrecho de los dos. Un roce de bordes entre columnas
 * vecinas no es alineación.
 */
const MIN_OVERLAP_RATIO = 0.25;

/** Minúsculas sin tildes **conservando la longitud**, para poder cortar por índice. */
const FOLDED: Readonly<Record<string, string>> = {
  á: 'a',
  é: 'e',
  í: 'i',
  ó: 'o',
  ú: 'u',
  ü: 'u',
  ñ: 'n',
};

export function foldLabel(value: string): string {
  return value.toLowerCase().replace(/[áéíóúüñ]/g, (character) => FOLDED[character] ?? character);
}

/**
 * @param label Patrón anclado al inicio de la celda (`^…`) y sin bandera
 * global, expresado sobre texto ya plegado por {@link foldLabel}.
 * @param accepts Filtro del valor. Devolver `false` continúa la búsqueda en vez
 * de aceptar la primera celda contigua: es lo que impide que `Saldo inicial`
 * se quede con el rótulo `Total créditos` que tiene al lado.
 */
export function readLabeledCell(
  lines: readonly PageLine[],
  label: RegExp,
  accepts: (value: string) => boolean = () => true,
): string {
  for (const [lineIndex, line] of lines.entries()) {
    for (const [tokenIndex, token] of line.tokens.entries()) {
      const match = label.exec(foldLabel(token.text));
      if (!match || match.index !== 0) continue;

      const inline = token.text.slice(match[0].length).replace(LABEL_SEPARATOR, '').trim();
      if (inline && accepts(inline)) return inline;
      // Una celda que ya traía valor propio pero no aceptado no sigue buscando
      // a su derecha: ese texto es de otra columna, no la continuación de esta.
      if (inline) continue;

      const right = line.tokens[tokenIndex + 1]?.text.trim() ?? '';
      if (right && !isLabelOnly(right) && accepts(right)) return right;

      const below = alignedBelow(lines, lineIndex, token, accepts);
      if (below) return below;
    }
  }
  return '';
}

/**
 * Valor situado debajo del rótulo y alineado con él. Si el renglón de abajo
 * trae una sola celda no se exige alineación: no hay ninguna otra a la que ese
 * valor pueda pertenecer.
 */
function alignedBelow(
  lines: readonly PageLine[],
  lineIndex: number,
  label: TextToken,
  accepts: (value: string) => boolean,
): string {
  const anchor = lines[lineIndex];
  if (!anchor) return '';
  const labelStart = label.x / anchor.pageWidth;
  const labelEnd = (label.x + label.width) / anchor.pageWidth;

  for (let offset = 1; offset <= MAX_LINES_BELOW; offset += 1) {
    const line = lines[lineIndex + offset];
    if (!line || line.page !== anchor.page) return '';

    const single = line.tokens.length === 1 ? line.tokens[0] : undefined;
    if (single) {
      const value = single.text.trim();
      if (value && !isLabelOnly(value) && accepts(value)) return value;
      continue;
    }

    let best = '';
    let bestOverlap = 0;
    for (const token of line.tokens) {
      if (isLabelOnly(token.text)) continue;
      const start = token.x / line.pageWidth;
      const end = (token.x + token.width) / line.pageWidth;
      const overlap = Math.min(end, labelEnd) - Math.max(start, labelStart);
      const narrowest = Math.min(end - start, labelEnd - labelStart);
      if (narrowest <= 0 || overlap / narrowest < MIN_OVERLAP_RATIO) continue;
      if (overlap <= bestOverlap) continue;
      bestOverlap = overlap;
      best = token.text.trim();
    }
    if (best && accepts(best)) return best;
  }
  return '';
}
