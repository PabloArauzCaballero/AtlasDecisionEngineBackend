import { collapseWhitespace } from '../text-normalization';
import { BIRTH_ANCHOR, NAME_ANCHOR } from './ci-anchors';
import { limpiarValor, pareceNombre } from './ci-noise-cleaning';
import type { Extraction, SourceLine } from './ci-source-lines';

export function nombreAnclado(lines: SourceLine[]): Extraction | null {
  for (const [index, line] of lines.entries()) {
    const match = NAME_ANCHOR.exec(line.normalized);
    const captured = match?.[1];
    if (!captured) continue;
    // `A:` introduce el nombre del titular; menos de dos palabras es ruido.
    const words = captured
      .trim()
      .split(/\s+/)
      .filter((word) => /^[A-ZÑ'’-]{2,}$/.test(word));
    if (words.length < 2) continue;
    // Recupera de la línea intacta las mayúsculas y los diacríticos.
    const original = lines[index]?.text ?? '';
    const separator = original.search(/[:;.,]/);
    const value =
      separator >= 0 ? collapseWhitespace(original.slice(separator + 1)) : words.join(' ');
    return { value: limpiarValor(value || words.join(' ')), confidence: line.confidence };
  }
  return null;
}

/**
 * El nombre del formato ANTERIOR cuando su ancla `A:` no se dejó leer.
 *
 * En esa generación el nombre vive en el reverso y lo único que lo anuncia es
 * una `A:` — el glifo más pequeño con el que se puede anclar un campo, y el
 * primero que el reconocedor pierde. Medido sobre una cédula de 2023, el
 * reverso volvió así:
 *
 *   `cedido es e`
 *   `r - ANA LUCIA QUISPE MAMANI`
 *   `— Nacido el 25 de Febrero de 2002 : o`
 *
 * El nombre está impreso, es legible y se leyó ENTERO; lo que se perdió fue su
 * ancla, y con ella el campo. El expediente salía con `NAME_NOT_FOUND`.
 *
 * Lo que sí sobrevive es la ESTRUCTURA de la tarjeta: el nombre es el renglón
 * que va justo encima de `Nacido el`. No es una coincidencia de maquetación,
 * es el orden que esa generación imprime —`A: <nombre>` y debajo `Nacido el
 * <fecha>`— y por eso se busca desde ahí y no por la forma del texto.
 *
 * Tres condiciones lo mantienen honesto:
 *
 * - Se mira sólo el renglón INMEDIATAMENTE anterior y el siguiente a ése hacia
 *   arriba. Ampliar la ventana empezaría a alcanzar el bloque de `CERTIFICA:
 *   Que la firma, fotografía…`, que es texto fijo de la tarjeta.
 * - Tiene que parecer un nombre (`pareceNombre`) y traer al menos DOS palabras
 *   de tres letras: un nombre boliviano completo lleva nombres y dos
 *   apellidos, y el ruido del reconocedor llega en glifos sueltos.
 * - **Va marcado `NAME_SPLIT_HEURISTIC`** igual que el corte por convención,
 *   porque igual que aquél es una suposición sobre la maqueta y no un dato
 *   rotulado. Quien revise el caso tiene que poder saberlo.
 */
export function nombrePorVecindad(lines: SourceLine[]): Extraction | null {
  for (const [indice, line] of lines.entries()) {
    if (!BIRTH_ANCHOR.test(line.normalized)) continue;
    for (const salto of [1, 2]) {
      const candidata = lines[indice - salto];
      if (!candidata) break;
      const valor = limpiarValor(candidata.text);
      if (!pareceNombre(valor)) continue;
      const palabras = valor.split(/\s+/).filter((p) => (p.match(/\p{L}/gu) ?? []).length >= 3);
      if (palabras.length < 2) continue;
      return { value: palabras.join(' '), confidence: candidata.confidence };
    }
  }
  return null;
}

/**
 * Los registros bolivianos imprimen `<nombres> <apellido paterno> <apellido
 * materno>`. El corte es una convención, no un delimitador, así que las dos
 * mitades se marcan `DERIVED` y se avisa; `fullName` sigue siendo la
 * autoridad.
 */
export function splitName(fullName: string): { firstNames: string; lastNames: string } | null {
  const words = collapseWhitespace(fullName).split(' ').filter(Boolean);
  if (words.length < 2) return null;
  if (words.length === 2) return { firstNames: words[0], lastNames: words[1] };
  return {
    firstNames: words.slice(0, words.length - 2).join(' '),
    lastNames: words.slice(words.length - 2).join(' '),
  };
}
