import { esNumeroDeCedulaValido } from '../../catalog/bolivia-ci.catalog';
import {
  CONTROL_NUMBER_LINE,
  DOCUMENT_NUMBER_ANCHOR,
  NUMBER_NOISE,
  SECTION_ANCHOR,
  SERIE_ANCHOR,
  STANDALONE_NUMBER_LINE,
} from './ci-anchors';
import { repararDigitos } from './ci-noise-cleaning';
import type { Extraction, SourceLine } from './ci-source-lines';

/**
 * El número de cédula, prefiriendo el anclaje explícito `No <dígitos>`.
 *
 * Tres cambios sobre lo que había, los tres medidos contra cinco cédulas
 * bolivianas auténticas:
 *
 * 1. **El candidato se REPARA y se VALIDA**, en vez de aceptarse tal cual.
 *    Reparar deshace las confusiones de glifo del reconocedor sobre cifras
 *    grandes; validar lo contrasta con la forma que el SEGIP emite
 *    (`esNumeroDeCedulaValido`: cinco a ocho dígitos, sin cero delante). Un
 *    candidato que no cumple la forma se descarta en vez de viajar al
 *    expediente, que es lo que impide que un número de control de nueve
 *    dígitos ocupe el sitio del bueno.
 * 2. **La serie y la sección se excluyen explícitamente.** Son los dos campos
 *    administrativos del anverso, van en cifras y **tienen cinco dígitos**, o
 *    sea que cumplen la forma de un número de cédula corto. Cuando el
 *    reconocedor se come su rótulo —pasa: van en gris a cuerpo pequeño— el
 *    renglón queda como cifras sueltas y la vía de los dígitos sueltos los
 *    adjudicaba como número de documento. Medido sobre las cinco cédulas:
 *    `42343`, `32333`, `21222`, `44333`, `54222`, todos candidatos legítimos
 *    según la forma y ninguno el número de nadie.
 * 3. **A igualdad de vía, gana el candidato MÁS LARGO.** El número de una
 *    cédula boliviana tiene siete u ocho cifras y los ruidos que compiten con
 *    él tienen cinco; sin este criterio, el orden de los renglones decidía.
 */
export function numeroDeDocumento(lines: SourceLine[]): Extraction | null {
  const excluidos = new Set<string>();
  for (const line of lines) {
    const control = CONTROL_NUMBER_LINE.exec(line.normalized);
    const numero = control?.[1] ? control[1].replace(/\s/g, '') : null;
    if (numero) excluidos.add(numero);
    const serie = SERIE_ANCHOR.exec(line.normalized)?.[1];
    if (serie) excluidos.add(serie);
    const seccion = SECTION_ANCHOR.exec(line.normalized)?.[1];
    if (seccion) excluidos.add(seccion);
  }

  const anclados: Extraction[] = [];
  const sueltos: Extraction[] = [];
  for (const line of lines) {
    if (NUMBER_NOISE.test(line.normalized)) continue;

    const anchored = DOCUMENT_NUMBER_ANCHOR.exec(line.normalized)?.[1];
    const reparado = anchored ? repararDigitos(anchored) : null;
    if (reparado && !excluidos.has(reparado) && esNumeroDeCedulaValido(reparado)) {
      anclados.push({ value: reparado, confidence: line.confidence });
    }

    const standalone = STANDALONE_NUMBER_LINE.exec(line.normalized)?.[1];
    if (standalone && !excluidos.has(standalone) && esNumeroDeCedulaValido(standalone)) {
      sueltos.push({ value: standalone, confidence: line.confidence });
    }
  }

  const masLargo = (candidatos: Extraction[]): Extraction | null =>
    candidatos.length === 0
      ? null
      : candidatos.reduce((mejor, actual) =>
          actual.value.length > mejor.value.length ? actual : mejor,
        );

  // El anclado manda siempre: `No 1234567` es el número porque la tarjeta lo
  // dice, y unas cifras sueltas sólo lo son porque no hay nada mejor.
  return masLargo(anclados) ?? masLargo(sueltos);
}
