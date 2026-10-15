import { collapseWhitespace, normalizeForMatch, toLines } from '../text-normalization';
import { casarGrafias, plegarParaCotejo, valorTrasEtiqueta } from '../../catalog/approximate-match';
import type { DocumentOcrResult } from '../../ports/identity.ports';
import { ES_ROTULO } from './ci-anchors';
import { limpiarValor, pareceValor } from './ci-noise-cleaning';

export interface SourceLine {
  text: string;
  normalized: string;
  confidence: number | null;
}

export interface Extraction {
  value: string;
  confidence: number | null;
}

export function sourceLines(ocr: Pick<DocumentOcrResult, 'rawText' | 'lines'>): SourceLine[] {
  const ocrLines = ocr.lines ?? [];
  if (ocrLines.length > 0) {
    return ocrLines
      .map((line) => ({
        text: collapseWhitespace(line.text),
        normalized: normalizeForMatch(collapseWhitespace(line.text)),
        confidence: line.confidence,
      }))
      .filter((line) => line.text.length > 0);
  }
  return toLines(ocr.rawText).map((text) => ({
    text,
    normalized: normalizeForMatch(text),
    confidence: null,
  }));
}

export function anchored(lines: SourceLine[], pattern: RegExp): Extraction | null {
  for (const line of lines) {
    const match = pattern.exec(line.normalized);
    const captured = match?.[1];
    if (captured) return { value: collapseWhitespace(captured), confidence: line.confidence };
  }
  return null;
}

/**
 * Lo que sigue a un rótulo EN LA MISMA LÍNEA, cotejándolo con tolerancia.
 *
 * Es el hermano de `anchored` para los rótulos que el reconocedor mutila. El
 * cotejo aproximado no daba posiciones y por eso sólo se podía usar para mirar
 * el renglón de debajo; ahora `valorTrasEtiqueta` devuelve el corte, y con él
 * se alcanzan los rótulos del formato anterior —`Emitida el 22 de Mayo de
 * 2023`, `Expira el 22 de Mayo de 2028`— que ponen su valor detrás.
 *
 * Se lee de la línea ORIGINAL y no de la normalizada: la fecha larga lleva
 * espacios y la corta lleva barras, y los dos separadores hacen falta para
 * interpretarla.
 */
export function anchoredTolerante(
  lines: SourceLine[],
  grafias: readonly string[],
): Extraction | null {
  for (const line of lines) {
    const resto = valorTrasEtiqueta(line.text, grafias);
    if (resto === null) continue;
    const valor = collapseWhitespace(resto);
    if (!valor) continue;
    return { value: valor, confidence: line.confidence };
  }
  return null;
}

/**
 * Valor de un campo ROTULADO, esté en la misma línea o en la siguiente.
 *
 * En la cédula vigente el rótulo va ENCIMA del valor, no delante: la tarjeta
 * imprime `NOMBRES` y debajo `MARIA RENEE`. El reconocedor los devuelve como
 * dos renglones distintos, así que buscar `NOMBRES: <algo>` en una sola línea
 * no encuentra nada —y ése era el motivo real de que un documento
 * perfectamente legible saliera «sin campos»—.
 *
 * Se mira la línea siguiente sólo si no es OTRO rótulo: dos rótulos seguidos
 * significan que el valor se perdió, y tomar el segundo rótulo como valor
 * sería inventarse el dato.
 *
 * Y lo que acompaña al rótulo en su propia línea tiene que PARECER un valor.
 * El retrato va al lado de los rótulos, así que el reconocedor mete en el
 * mismo renglón los glifos que cree ver en la foto: sobre una cédula legible
 * devolvió `NOMBRES í Y`, y quedarse con eso daba el nombre completo
 * «I Y RODRIGUEZ GONZALEZ» —un dato inventado, con la pinta de uno leído—.
 * Descartarlo hace que se lea el renglón de debajo, que es donde está el
 * valor de verdad.
 */
export function labelled(
  lines: SourceLine[],
  etiqueta: RegExp,
  grafias: readonly string[] = [],
  excluye?: RegExp,
): Extraction | null {
  for (const [indice, line] of lines.entries()) {
    const match = etiqueta.exec(line.normalized);
    if (!match) continue;

    const enLinea = collapseWhitespace(match[1] ?? '');
    if (enLinea && pareceValor(enLinea)) {
      return { value: limpiarValor(enLinea), confidence: line.confidence };
    }

    const siguiente = lines[indice + 1];
    if (!siguiente || ES_ROTULO.test(siguiente.normalized)) continue;
    return {
      value: limpiarValor(collapseWhitespace(siguiente.text)),
      confidence: siguiente.confidence,
    };
  }

  /*
   * El rótulo, cotejado con tolerancia. Segundo intento y no primero: cuando
   * la expresión regular encuentra el rótulo también sabe dónde ACABA, y con
   * eso puede tomar el valor de la misma línea. El cotejo aproximado no
   * devuelve posiciones, así que aquí sólo se puede mirar el renglón de
   * DEBAJO — que es donde la cédula vigente imprime el valor de todos modos,
   * porque el rótulo va encima y no delante.
   */
  for (const [indice, line] of lines.entries()) {
    /*
     * Un renglón que lleva LITERALMENTE el rótulo de otro campo no se
     * adjudica por parecido. Es lo que impide que `FECHA DE NACIMIENTO`, que
     * está a dos ediciones de `FECHA DE VENCIMIENTO`, se lleve la caducidad —y
     * con ella la fecha de nacimiento puesta en el campo equivocado—.
     */
    if (excluye?.test(line.normalized)) continue;
    if (casarGrafias(plegarParaCotejo(line.normalized), grafias) === null) continue;
    const siguiente = lines[indice + 1];
    if (!siguiente || ES_ROTULO.test(siguiente.normalized)) continue;
    const valor = limpiarValor(collapseWhitespace(siguiente.text));
    if (!pareceValor(valor)) continue;
    return { value: valor, confidence: siguiente.confidence };
  }
  return null;
}

export function firstGroup(lines: SourceLine[], pattern: RegExp): string | null {
  for (const line of lines) {
    const match = pattern.exec(line.normalized);
    if (match?.[1]) return match[1];
  }
  return null;
}
