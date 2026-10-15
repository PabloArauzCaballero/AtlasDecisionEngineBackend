/** Confusiones de OCR sobre OCR-B y alfabeto de la MRZ: lo que se puede deshacer sin riesgo. */

/**
 * ¿Se puede COMPROBAR este dígito de control?
 *
 * Sólo si es un dígito. La norma reserva esa posición a `0-9` (y admite `<` como
 * relleno cuando el campo entero está vacío), así que cualquier otra cosa es un
 * fallo de lectura y no un fallo del documento.
 */
export function esControlLegible(control: string): boolean {
  return /^[0-9]$/.test(control);
}

/**
 * ¿Está esta tira dentro del alfabeto de la MRZ?
 *
 * La norma fija `A-Z`, `0-9` y `<`. Un espacio, una tilde o un signo de
 * interrogación dentro de la entrada de un control significan que el renglón se
 * leyó mal: el control calculado sobre esa tira no dice nada del documento.
 */
export function tiraLegible(tira: string): boolean {
  return /^[A-Z0-9<]*$/.test(tira);
}

/** Longitud de cada renglón de una TD1. Lo que no la tenga, no es TD1. */
export const LINE_LENGTH = 30;

/**
 * Confusiones que comete cualquier OCR sobre OCR-B y que se pueden deshacer
 * SIN riesgo: en las posiciones numéricas de la MRZ no puede haber letras, así
 * que una `O` ahí es un cero con certeza, no una interpretación.
 */
const NUMERIC_FIXES: Record<string, string> = {
  O: '0',
  Q: '0',
  D: '0',
  I: '1',
  L: '1',
  S: '5',
  B: '8',
  /*
   * `T` por `7`, y ésta es la que costaba un número de cédula.
   *
   * En OCR-B el 7 no lleva travesaño y su asta descendente arranca de un trazo
   * horizontal, así que a poca resolución es exactamente una T. Medido sobre una
   * cédula boliviana auténtica fotografiada con un móvil: el primer renglón
   * llegó como `I<BOL7689658<<T<<<…` a 600 y a 900 px de lado —la `T` está en la
   * posición 14, que es el DÍGITO DE CONTROL del número—, y con el control roto
   * se descartaban el número de documento y la fecha de nacimiento enteros. A
   * 1200 px el mismo renglón se lee `…<<7<<<…` y todo cuadra.
   *
   * Deshacerla no es adivinar: la norma garantiza que esa posición es un dígito,
   * igual que las demás entradas de esta tabla, y si la corrección fuera
   * incorrecta el propio dígito de control seguiría sin cuadrar.
   */
  T: '7',
  /* Por lo mismo, y por el mismo sitio: la `Z` y el `2`, la `G` y el `6`. */
  Z: '2',
  G: '6',
};

/**
 * Confusiones al revés, para las posiciones que la norma reserva a LETRAS.
 *
 * El estado emisor y la nacionalidad de una TD1 son códigos ISO 3166-1 alfa-3:
 * tres letras, nunca un dígito. Así que un `0` ahí es una `O` con la misma
 * certeza con la que una `O` en una fecha es un `0`, y deshacerlo no es
 * interpretar.
 *
 * Hacía falta porque el dato salía mal a la vista de quien revisa un caso: la
 * pantalla llegó a enseñar `B0L` —con un cero— como nacionalidad de una cédula
 * boliviana auténtica. Ninguna de estas dos posiciones está cubierta por el
 * dígito de control compuesto, así que nada más iba a corregirlo.
 */
const ALPHA_FIXES: Record<string, string> = {
  '0': 'O',
  '1': 'I',
  '2': 'Z',
  '5': 'S',
  '6': 'G',
  '8': 'B',
};

/** Deshace las confusiones de OCR en un campo que sólo puede llevar letras. */
export function normalizeAlpha(valor: string): string {
  return [...valor].map((caracter) => ALPHA_FIXES[caracter] ?? caracter).join('');
}

/** Deshace las confusiones de OCR que sólo pueden ser dígitos. */
export function normalizeNumeric(valor: string): string {
  return [...valor].map((caracter) => NUMERIC_FIXES[caracter] ?? caracter).join('');
}
