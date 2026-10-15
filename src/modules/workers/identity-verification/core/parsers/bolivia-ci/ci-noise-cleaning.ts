/**
 * Deshace las confusiones de glifo en algo que YA es casi todo dígitos.
 *
 * Es la misma tabla que usa la MRZ y por la misma razón —la `O` y el `0`, la `T`
 * y el `7` son el mismo trazo a poca resolución— pero aquí no hay una norma que
 * garantice que la posición sea numérica, así que la garantía la pone el
 * CONTEXTO: sólo se repara lo que va detrás del ancla `N°`/`No`/`C.I.`, que es
 * el único sitio del anverso donde la tarjeta imprime un número de cédula.
 *
 * Y aun así se exige que la MAYORÍA de los caracteres ya fueran dígitos. Sin esa
 * condición, `No SOLTERO` se convertiría en un número: reparar un texto que no
 * era un número no lo corrige, lo inventa.
 */
export function repararDigitos(bruto: string): string | null {
  const limpio = bruto.replace(/[\s\u00b7.]/g, '');
  if (limpio.length === 0) return null;
  const yaDigitos = (limpio.match(/\d/g) ?? []).length;
  if (yaDigitos * 2 < limpio.length) return null;
  const reparado = [...limpio]
    .map((caracter) => CONFUSIONES_A_DIGITO[caracter] ?? caracter)
    .join('');
  return /^\d+$/.test(reparado) ? reparado : null;
}

/** Las confusiones que un reconocedor comete sobre cifras impresas grandes. */
const CONFUSIONES_A_DIGITO: Record<string, string> = {
  O: '0',
  Q: '0',
  D: '0',
  I: '1',
  L: '1',
  S: '5',
  B: '8',
  Z: '2',
  G: '6',
  T: '7',
};

/**
 * ¿Lo que acompaña al rótulo en su línea parece un valor, o es ruido?
 *
 * El retrato del titular va al lado de los rótulos, y el reconocedor mete en el
 * mismo renglón los glifos que cree ver dentro de la foto. Sobre una cédula
 * perfectamente legible devolvió `NOMBRES í Y`, y tomarlo por bueno producía el
 * nombre «I Y RODRIGUEZ GONZALEZ»: un dato inventado con toda la pinta de uno
 * leído, que es la peor clase de dato en un expediente de identidad.
 *
 * El criterio es una TIRA SEGUIDA de al menos tres caracteres alfanuméricos.
 * Una palabra la tiene; una fecha la tiene en su año. El ruido del reconocedor
 * llega en letras sueltas separadas por espacios, y no la tiene. Cuando no la
 * hay se sigue mirando el renglón de debajo, que es donde vive el valor.
 */
export function pareceValor(texto: string): boolean {
  return /[\p{L}\p{N}]{3,}/u.test(texto);
}

/**
 * ¿Esto puede ser el nombre de una persona?
 *
 * Flojo a propósito: tres letras o más en total y al menos una palabra de dos,
 * sin cifras. Un apellido puede ser prácticamente cualquier cosa, así que lo
 * único que se descarta es lo que NO puede serlo — los glifos sueltos que el
 * reconocedor saca del retrato (`í Y`, `CMI`, `Priti`) y las tiras con números.
 */
export function pareceNombre(valor: string | null | undefined): boolean {
  if (!valor) return false;
  const texto = valor.trim();
  if (/\d/u.test(texto)) return false;
  const letras = (texto.match(/\p{L}/gu) ?? []).length;
  if (letras < 3) return false;
  return texto.split(/\s+/).some((palabra) => (palabra.match(/\p{L}/gu) ?? []).length >= 2);
}

/**
 * Quita la COLA de ruido que el retrato deja pegada al valor.
 *
 * El mismo fenómeno que arriba, un renglón más abajo: el valor está donde debe
 * —`MARIA RENEE`— pero el reconocedor le añade lo que cree ver en la cara que
 * tiene al lado, y devuelve `MARIA RENEE Oo o |`. Sin esto, el nombre completo
 * salía «MARIA RENEE Oo o | RODRIGUEZ GONZALEZ».
 *
 * Se recorta sólo por el FINAL y sólo mientras el último trozo sea corto: un
 * nombre castellano no termina en una palabra de dos letras, pero sí puede
 * llevarlas en medio —«JOSE DE LA CRUZ»—, así que quitarlas donde quiera que
 * aparecieran sí rompería nombres de verdad.
 *
 * Se intentó resolver antes, filtrando por la confianza que da el reconocedor
 * palabra a palabra, y NO sirve: medido sobre esa tarjeta, esos glifos llegan
 * con 60, 83 y 94 —está seguro de lo que ve— mientras que el `N°` que precede al
 * número llega con 28. El corte tiraba un anclaje bueno y dejaba pasar el ruido.
 */
export function sinColaDeRuido(texto: string): string {
  const trozos = texto.split(/\s+/).filter(Boolean);
  while (trozos.length > 1 && !/[\p{L}\p{N}]{3,}/u.test(trozos[trozos.length - 1] ?? '')) {
    trozos.pop();
  }
  return trozos.join(' ');
}

/**
 * Y la CABEZA, que es por donde entra el ruido de verdad.
 *
 * `sinColaDeRuido` recortaba sólo por el final, y la medición sobre cinco
 * cédulas bolivianas auténticas dice que el ruido llega sobre todo por DELANTE:
 * el valor está impreso a la derecha del retrato, y a la izquierda del renglón
 * quedan el borde de la tarjeta, el número vertical en rojo y los restos del
 * sello. Lo que devolvió el reconocedor, literal:
 *
 *   `” .UISPE MAMANI`     `e QUISPE MAMANI`     `S ANA LUCIA. $`
 *   `5 ANA LUCIA >= |`     `r - ANA LUCIA QUISPE MAMANI`
 *
 * Sin este recorte, esos glifos viajaban al expediente COMO PARTE DEL NOMBRE de
 * una persona, y además rompían el cotejo con la MRZ —`” .UISPE MAMANI` no es
 * prefijo de `QUISPE MAMANI`— así que una cédula auténtica levantaba
 * `NAME_MRZ_MISMATCH`, que es una marca de documento compuesto.
 *
 * El criterio es simétrico al de la cola y por lo mismo: se quitan los trozos
 * iniciales que no lleven una tira seguida de tres alfanuméricos. Un nombre
 * castellano no EMPIEZA por una palabra de dos letras —«DE LA CRUZ» va en medio—
 * y el ruido del reconocedor llega justamente así, en glifos sueltos.
 */
export function sinCabezaDeRuido(texto: string): string {
  const trozos = texto.split(/\s+/).filter(Boolean);
  while (trozos.length > 1 && !/[\p{L}\p{N}]{3,}/u.test(trozos[0] ?? '')) {
    trozos.shift();
  }
  return trozos.join(' ');
}

/**
 * Las dos puntas, más los signos que cuelgan de los extremos.
 *
 * Los signos se quitan aparte de los trozos porque van PEGADOS a la palabra y no
 * sueltos: `ANA LUCIA. $` pierde el `$` como trozo y la `.` como signo, y `.UISPE`
 * conserva su cuerpo. Sólo se tocan los extremos —un `D'ANDREA` o un `PEREZ-GIL`
 * llevan el signo en medio y son nombres de verdad—.
 */
export function limpiarValor(texto: string): string {
  return sinCabezaDeRuido(sinColaDeRuido(texto))
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .replace(/[^\p{L}\p{N}]+$/u, '')
    .trim();
}
