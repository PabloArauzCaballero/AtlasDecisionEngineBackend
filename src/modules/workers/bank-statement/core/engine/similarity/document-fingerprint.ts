/**
 * Reduce el documento a las cuatro caras contra las que se mide el parecido.
 *
 * Son cuatro y no una porque una señal buscada en todo el texto no dice lo mismo
 * que buscada donde corresponde: «SALDO» aparece en cualquier extracto y en el
 * encabezado de la tabla significa que ESA columna existe. Separar los ámbitos
 * es lo que impide que un descriptor laxo puntúe alto por coincidencias que
 * ocurren en cualquier parte.
 */

import type { ExtractedPdf } from '../../domain/models';
import type { PdfProvenance } from '../authenticity/pdf-forensics';
import { matchHeaderField } from '../generic/header-lexicon';
import { coverText } from '../statement-context';
import type { DocumentFingerprint } from './similarity-scorer';

/** Campos canónicos que tiene que reconocer un renglón para ser el encabezado. */
const MINIMO_DE_CAMPOS = 3;

export function buildDocumentFingerprint(
  pdf: ExtractedPdf,
  provenance: Pick<PdfProvenance, 'producer' | 'creator'>,
): DocumentFingerprint {
  return {
    cover: coverText(pdf),
    fullText: pdf.text,
    columnHeaders: detectColumnHeaders(pdf),
    provenance,
  };
}

/**
 * El renglón de encabezados de la tabla, reconocido por el léxico canónico.
 *
 * Se busca aquí —y no se toma del analizador que ganó la cascada— porque el
 * parecido se mide ANTES de elegir estrategia: si esperáramos al analizador, un
 * documento que ninguna estrategia acepta no tendría medida de parecido, que es
 * justo el documento sobre el que la medida más ayuda a decidir.
 *
 * Gana el renglón con más campos reconocidos, no el primero que llegue a tres:
 * las carátulas suelen tener rótulos sueltos —«SALDO ANTERIOR», «FECHA DE
 * EMISIÓN»— que alcanzan el mínimo sin ser la tabla.
 */
function detectColumnHeaders(pdf: ExtractedPdf): string[] {
  let mejor: { campos: number; textos: string[] } | undefined;

  for (const line of pdf.lines) {
    const tokens = line.text
      .split(/\s{2,}|\t|\|/)
      .map((token) => token.trim())
      .filter((token) => token.length > 0);
    if (tokens.length < MINIMO_DE_CAMPOS) continue;

    const reconocidos = tokens.filter((token) => matchHeaderField(token) !== undefined);
    if (reconocidos.length < MINIMO_DE_CAMPOS) continue;
    if (!mejor || reconocidos.length > mejor.campos) {
      mejor = { campos: reconocidos.length, textos: tokens };
    }
  }

  return mejor?.textos ?? [];
}
