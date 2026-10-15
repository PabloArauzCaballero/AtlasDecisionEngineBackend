import { checkDigit } from './check-digit';
import { esControlLegible, normalizeNumeric, tiraLegible } from './ocr-confusions';

/**
 * El control compuesto en TRES estados.
 *
 * Cuadra, no cuadra, o **no se puede comprobar**. Lo tercero ocurre por tres
 * motivos, todos de LECTURA:
 *
 * 1. El dígito de control no es un dígito —llegó `?`, `c`, un espacio—.
 * 2. Alguno de los dos renglones lleva caracteres fuera del alfabeto de la MRZ.
 * 3. Alguno de los dos renglones llegó corto y hubo que rellenarlo: el control
 *    se calcularía sobre caracteres que no leyó nadie.
 *
 * El tercero sólo invalida cuando el control FALLA. Si cuadra con el relleno
 * puesto, el relleno era el correcto y no hay nada que dudar.
 */
export function compuesto(
  l1: string,
  l2: string,
  control: string,
  numeroValidaCrudo: boolean,
  renglonesCompletos: boolean,
): boolean | null {
  if (!esControlLegible(control) || !tiraLegible(`${l1}${l2}`)) return null;
  const cuadra = compositeCheck(l1, l2, control, numeroValidaCrudo);
  if (cuadra) return true;
  return renglonesCompletos ? false : null;
}

/**
 * Control compuesto de la TD1, con un intento de RECUPERACIÓN.
 *
 * El compuesto abarca el número, las dos fechas y sus controles: basta un
 * misleído numérico en cualquiera de ellos —la `Q` por un `0`— para que falle
 * sobre lo crudo aunque cada campo individual se haya recuperado. Así que se
 * prueba primero tal cual llegó y, si no cuadra, sobre la misma tira con las
 * confusiones numéricas deshechas en las posiciones que SÓLO pueden ser
 * dígitos (las fechas y sus controles). El número entra con la variante que
 * validó su propio control: si validó crudo, con letra legítima incluida.
 */
function compositeCheck(
  l1: string,
  l2: string,
  control: string,
  numeroValidaCrudo: boolean,
): boolean {
  const crudo = `${l1.slice(5, 30)}${l2.slice(0, 7)}${l2.slice(8, 15)}${l2.slice(18, 29)}`;
  if (checkDigit(crudo) === control) return true;
  /*
   * El DÍGITO DE CONTROL del número se normaliza SIEMPRE, valide el número
   * crudo o no. Aquí había un defecto que se llevaba por delante el compuesto de
   * cualquier cédula real: `numeroValidaCrudo` se calcula contra el control ya
   * normalizado —`interpretar` hace `normalizeNumeric(l1.slice(14, 15))`— pero
   * la variante «recuperada» volvía a tomar el tramo `5..15` en CRUDO, o sea con
   * la letra mal leída dentro. Medido sobre una cédula boliviana auténtica: el
   * renglón llegó como `I<BOL7689658<<T<<<…`, el número y sus tres compañeros
   * validaban, y el compuesto fallaba por esa misma `T` que el propio módulo ya
   * había decidido que era un `7`. Salía `MRZ_COMPOSITE_CHECK_FAILED` en el
   * expediente de un documento cuyos cuatro campos estaban demostrados.
   *
   * El número (`5..14`) sí conserva su forma cruda cuando validó así: una TD1
   * admite letras en el número de documento y convertirlas sería corromperlo. Lo
   * que no admite letras, por norma, es la posición 14.
   */
  const numero = numeroValidaCrudo ? l1.slice(5, 14) : normalizeNumeric(l1.slice(5, 14));
  const numeroSpan = `${numero}${normalizeNumeric(l1.slice(14, 15))}`;
  const recuperado =
    `${numeroSpan}${l1.slice(15, 30)}${normalizeNumeric(l2.slice(0, 7))}` +
    `${normalizeNumeric(l2.slice(8, 15))}${l2.slice(18, 29)}`;
  return checkDigit(recuperado) === control;
}

/**
 * El número de documento cuando NO cabe en las nueve posiciones de la TD1.
 *
 * Devuelve `null` cuando no hay desbordamiento —el caso normal— y, cuando lo
 * hay, el número completo con el veredicto de su dígito de control. Si la
 * continuación no se puede interpretar, `valida` es `null`: no evaluable, que es
 * lo que el corpus manda hacer con un desbordamiento ambiguo («REVISIÓN;
 * conservar raw»).
 */
export function leerDesborde(
  l1: string,
  numeroCrudo: string,
): { numero: string; valida: boolean | null } | null {
  // El disparador es EXACTAMENTE un `<` en la posición del dígito de control.
  if (l1.slice(14, 15) !== '<') return null;

  /*
   * El campo opcional lleva `<continuación><control del número completo><`.
   *
   * El orden importa y es fácil de leer al revés: el dígito de control va
   * DESPUÉS de la continuación y ANTES del relleno, así que es el carácter que
   * precede al primer `<`, no el que lo sigue.
   */
  const opcional = l1.slice(15, 30);
  const corte = opcional.indexOf('<');
  if (corte <= 1) return null;
  const continuacion = opcional.slice(0, corte - 1);
  const control = normalizeNumeric(opcional.slice(corte - 1, corte));
  const completo = `${numeroCrudo.replace(/</g, '')}${continuacion}`;

  if (!esControlLegible(control)) return { numero: completo, valida: null };
  const cuadra =
    checkDigit(completo) === control || checkDigit(normalizeNumeric(completo)) === control;
  return {
    numero: cuadra && checkDigit(completo) !== control ? normalizeNumeric(completo) : completo,
    valida: cuadra,
  };
}
