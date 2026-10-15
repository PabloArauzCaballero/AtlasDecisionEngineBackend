import { LINE_LENGTH } from './ocr-confusions';

/** Un renglón candidato: el texto ya ajustado a 30 y si hizo falta inventarse un recorte. */
export interface Variante {
  linea: string;
  /** Se quitó un carácter de EN MEDIO. Sólo vale si lo respalda el control compuesto. */
  arriesgada: boolean;
  /**
   * El renglón traía sus 30 caracteres; no hubo que rellenarlo.
   *
   * Importa para el control COMPUESTO, que abarca los dos renglones enteros: si
   * el reconocedor se comió el relleno final —cosa que hace, porque veinte `<`
   * seguidos son justo lo que un OCR abrevia— la tira sobre la que se calcula
   * lleva caracteres que pusimos nosotros. Que un control falle sobre caracteres
   * inventados no dice nada del documento.
   */
  completa: boolean;
}

/**
 * ¿Empieza este renglón donde empieza una TD1 de verdad?
 *
 * La norma fija la CABECERA del primer renglón: la posición 0 es el tipo de
 * documento —`I`, `A` o `C` para una tarjeta de identidad— y las posiciones 2 a
 * 4 son el estado emisor, un código ISO 3166-1 alfa-3 de tres LETRAS. Nada de
 * eso depende de los dígitos de control, y por eso sirve para elegir de dónde
 * arranca el renglón cuando el reconocedor le ha colgado glifos por delante.
 *
 * Es lo que hacía falta para no perder un número de documento por dos caracteres
 * de basura. Medido sobre una cédula boliviana auténtica del DS 4924: el primer
 * renglón llegó como `LEI<BOL4521966<<6<<<…` —el reconocedor metió las dos
 * letras de un rótulo vecino— y las dos únicas variantes que había, «tal cual» y
 * «sin el primer carácter», dejaban el número corrido dos y una posición. Su
 * dígito de control CUADRA en cuanto el renglón se alinea, así que el documento
 * traía la prueba de su propio número y el analizador no llegaba a mirarla.
 *
 * Se usa como criterio de desempate y no como filtro: un renglón cuya cabecera
 * no case sigue probándose, porque el emisor podría no ser boliviano y porque
 * el propio tipo de documento se lee mal a veces. Lo que hace es que, entre dos
 * alineaciones que valen lo mismo para los controles, gane la que ADEMÁS tiene
 * la forma que la norma describe.
 */
export function cabeceraPlausible(linea: string): boolean {
  return /^[IAC][A-Z<][A-Z]{3}/.test(linea);
}

/**
 * El renglón tal cual, realineado sin su primer carácter, y —si sobra longitud—
 * sin cada uno de sus caracteres.
 *
 * El ajuste a 30 se hace AQUÍ y no al filtrar candidatos: un renglón de 31
 * caracteres —espurio + 30 reales— recortado antes de tiempo ya habría perdido
 * su último carácter real, que es justamente el control compuesto que la
 * variante realineada necesita para demostrarse.
 *
 * ## Por qué hace falta quitar de EN MEDIO
 *
 * Medido sobre una cédula fotografiada a 445 px: el reconocedor devolvió
 * `IDBOL1234567<<A4<<<...` — treinta y un caracteres, con una `A` colada entre
 * el relleno y el dígito de control. El número estaba impreso, era legible y se
 * leyó entero; lo que se perdió fue su control, corrido una posición. Ni el
 * renglón tal cual ni el realineado por delante recuperan eso, así que el
 * expediente se quedaba sin número de documento por un glifo de más.
 *
 * Sólo se generan cuando el renglón MIDE de más: un renglón de treinta ya está
 * completo y quitarle algo sólo puede empeorarlo.
 *
 * ## Por qué el recorte por DELANTE llega ahora hasta cuatro
 *
 * Era de uno, y uno no basta. El espurio de delante no es un carácter suelto:
 * es texto de la propia tarjeta que el reconocedor arrastra al renglón de la
 * MRZ —el borde impreso, el resto de un rótulo, el sello— y llega en grupo.
 * Medido sobre cinco cédulas bolivianas auténticas, el primer renglón de una de
 * ellas volvió como `LEI<BOL4521966<<6<<<…`: dos caracteres de más, número
 * legible, control correcto, y **ninguna variante que lo alineara**. El
 * expediente salía sin número de documento por eso.
 *
 * Cuatro es donde se para porque más allá el recorte deja de ser un realineado
 * y empieza a comerse el tipo de documento y el emisor, que son lo único con lo
 * que se puede comprobar que el arranque es el bueno.
 *
 * **Un recorte de más de uno NO es gratis**: sigue siendo `arriesgada` salvo que
 * la cabecera resultante tenga la forma que la norma exige (`cabeceraPlausible`).
 * Sin esa condición, ofrecer cinco arranques distintos multiplicaría por cinco
 * las ocasiones de que un dígito de control de una sola cifra cuadre por azar, y
 * un número inventado con el sello de «validado» es exactamente lo que este
 * analizador existe para no producir.
 */
export function variantes(linea: string): Variante[] {
  const ajustar = (texto: string): string => texto.padEnd(LINE_LENGTH, '<').slice(0, LINE_LENGTH);
  const completa = (texto: string): boolean => texto.length >= LINE_LENGTH;
  const seguras: Variante[] = [
    { linea: ajustar(linea), arriesgada: false, completa: completa(linea) },
    { linea: ajustar(linea.slice(1)), arriesgada: false, completa: completa(linea.slice(1)) },
  ];

  /*
   * Los recortes de 2 a 4 por delante. Se marcan seguros SÓLO si el renglón
   * resultante empieza como empieza una TD1; en otro caso quedan como
   * arriesgados y tendrán que demostrarse con el control compuesto, igual que
   * las supresiones de en medio.
   */
  const porDelante: Variante[] = [];
  for (let corte = 2; corte <= 4 && corte < linea.length; corte += 1) {
    const recortada = ajustar(linea.slice(corte));
    porDelante.push({
      linea: recortada,
      arriesgada: !cabeceraPlausible(recortada),
      completa: completa(linea.slice(corte)),
    });
  }

  if (linea.length <= LINE_LENGTH) return [...seguras, ...porDelante];

  const sinUno: Variante[] = [];
  for (let i = 1; i < linea.length; i += 1) {
    const sin = `${linea.slice(0, i)}${linea.slice(i + 1)}`;
    sinUno.push({ linea: ajustar(sin), arriesgada: true, completa: completa(sin) });
  }
  return [...seguras, ...porDelante, ...sinUno];
}
