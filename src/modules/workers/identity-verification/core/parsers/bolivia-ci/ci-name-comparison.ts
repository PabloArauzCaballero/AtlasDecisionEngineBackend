/** ¿Contiene el primero al segundo desde el principio, ya plegados a letras? */
export function empiezaPor(largo: string, corto: string): boolean {
  const a = plegarNombre(largo);
  const b = plegarNombre(corto);
  return a.length > 0 && b.length > 0 && a.startsWith(b);
}

export function plegarNombre(valor: string): string {
  return valor
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toUpperCase()
    .replace(/[^A-Z]/gu, '');
}

/**
 * ¿Estos dos textos nombran a la misma persona?
 *
 * La MRZ trunca a treinta caracteres y sustituye los espacios por `<`, así que
 * la comparación tiene que ser por PREFIJO sobre las letras sueltas: el impreso
 * `MARIA RENEE` y el de la MRZ `MARIA<RENE` son el mismo nombre, y exigir
 * igualdad exacta convertiría la norma de la ICAO en una discrepancia.
 */
export function mismoNombre(izquierda: string, derecha: string): boolean {
  const plegar = (valor: string): string =>
    valor
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/gu, '')
      .toUpperCase()
      .replace(/[^A-Z]/gu, '');
  const a = plegar(izquierda);
  const b = plegar(derecha);
  if (!a || !b) return true;
  if (a.startsWith(b) || b.startsWith(a)) return true;
  /*
   * Y una edición por cada ocho caracteres, que es lo que separa un nombre MAL
   * LEÍDO de un nombre DISTINTO.
   *
   * El prefijo solo no bastaba, y el fallo está medido sobre una cédula
   * boliviana auténtica: el rótulo de los apellidos va pegado al retrato, el
   * reconocedor se comió la primera letra y devolvió `UISPE MAMANI` donde la
   * MRZ dice `QUISPE MAMANI`. Ninguno de los dos es prefijo del otro —la
   * diferencia está al principio— así que la cédula levantaba
   * `NAME_MRZ_MISMATCH`, que es una marca de documento compuesto.
   *
   * Un carácter sobre dieciséis no es otra persona: es el mismo nombre con una
   * letra perdida. Dos apellidos distintos difieren en mucho más que eso, y la
   * tolerancia es la misma proporción que el catálogo ya aplica a sus rótulos.
   */
  const tolerancia = Math.max(1, Math.floor(Math.max(a.length, b.length) / 8));
  return distanciaDeEdicion(a, b, tolerancia) <= tolerancia;
}

/**
 * Distancia de Levenshtein con corte: en cuanto la fila entera se pasa del tope
 * no hay continuación que baje de ahí, porque cada paso sólo suma.
 */
export function distanciaDeEdicion(a: string, b: string, tope: number): number {
  if (Math.abs(a.length - b.length) > tope) return tope + 1;
  let previa = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const actual = new Array<number>(b.length + 1);
    actual[0] = i;
    let minimo = i;
    for (let j = 1; j <= b.length; j += 1) {
      const valor = Math.min(
        (previa[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
        (previa[j] ?? 0) + 1,
        (actual[j - 1] ?? 0) + 1,
      );
      actual[j] = valor;
      if (valor < minimo) minimo = valor;
    }
    if (minimo > tope) return tope + 1;
    previa = actual;
  }
  return previa[b.length] ?? tope + 1;
}
