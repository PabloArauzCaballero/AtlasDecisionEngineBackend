import { checkDigit } from './check-digit';
import { compuesto, leerDesborde } from './control-checks';
import { splitNames, toIsoDate } from './mrz-fields';
import type { MrzTd1 } from './mrz-types';
import { esControlLegible, normalizeAlpha, normalizeNumeric } from './ocr-confusions';

export function interpretar(
  l1: string,
  l2: string,
  l3: string,
  renglonesCompletos: boolean,
): MrzTd1 {
  const numeroCrudo = l1.slice(5, 14);
  // Un dígito de control es un DÍGITO por norma: una letra ahí es un misleído
  // con certeza, así que se deshace antes de comparar.
  const numeroControl = normalizeNumeric(l1.slice(14, 15));
  const nacimientoCrudo = l2.slice(0, 6);
  const nacimientoControl = normalizeNumeric(l2.slice(6, 7));
  const sexo = l2.slice(7, 8);
  const caducidadCruda = l2.slice(8, 14);
  const caducidadControl = normalizeNumeric(l2.slice(14, 15));
  const nacionalidad = normalizeAlpha(l2.slice(15, 18).replace(/</g, ''));
  const compuestoControl = normalizeNumeric(l2.slice(29, 30));

  /*
   * El número se valida en las DOS variantes y se entrega LA QUE CUADRÓ.
   *
   * Antes se validaba lo crudo y se entregaba lo normalizado, que son dos
   * documentos distintos: un número legítimo con letra (una TD1 lo admite)
   * validaba sobre lo crudo y se entregaba con la letra convertida en cifra —un
   * dato corrupto con el control en verde—. Y al revés, un `I234567` que el
   * control demuestra que era `1234567` se descartaba entero.
   */
  const numeroNormalizado = normalizeNumeric(numeroCrudo);
  const numeroValidaCrudo = checkDigit(numeroCrudo) === numeroControl;
  const numeroValidaNormalizado = checkDigit(numeroNormalizado) === numeroControl;
  const numeroBase = (numeroValidaCrudo ? numeroCrudo : numeroNormalizado).replace(/</g, '');

  /*
   * El número DESBORDADO: más de nueve caracteres.
   *
   * La norma reserva nueve posiciones al número y, cuando no caben, marca el
   * hueco del dígito de control con `<` y continúa el número al principio del
   * campo opcional, seguido del dígito de control del número COMPLETO y de un
   * `<`. El corpus lo transcribe entero y añade la parte que importa: ese `<` en
   * la posición 15 **no** significa checksum cero ni número inválido.
   *
   * Una cédula boliviana no llega a nueve caracteres, así que esto no se dispara
   * con `BOLIVIA_CI`. Existe porque `IDENTITY_ACCEPTED_DOCUMENT_TYPES` es una
   * decisión de despliegue: el día que se admita otro documento, un número largo
   * tiene que leerse, no descartarse.
   */
  const desborde = leerDesborde(l1, numeroCrudo);

  const nacimiento = normalizeNumeric(nacimientoCrudo);
  const caducidad = normalizeNumeric(caducidadCruda);

  /*
   * Cada control se declara NO EVALUABLE cuando no se pudo leer.
   *
   * Dos condiciones, y las dos son de LECTURA y no de documento: que el dígito
   * de control no sea un dígito, o que la tira sobre la que se calcula lleve
   * caracteres fuera del alfabeto de la MRZ. Ver `checks` en la interfaz.
   */
  const checks = {
    documentNumber: desborde
      ? desborde.valida
      : !esControlLegible(numeroControl)
        ? null
        : numeroValidaCrudo || numeroValidaNormalizado,
    birthDate: !esControlLegible(nacimientoControl)
      ? null
      : checkDigit(nacimiento) === nacimientoControl,
    expirationDate: !esControlLegible(caducidadControl)
      ? null
      : checkDigit(caducidad) === caducidadControl,
    composite: compuesto(l1, l2, compuestoControl, numeroValidaCrudo, renglonesCompletos),
  };

  const nombres = splitNames(l3);
  return {
    // Cada campo sólo se entrega si SU dígito de control cuadra. Un número que
    // no valida es peor que ninguno: parece un dato y no lo es.
    documentNumber:
      checks.documentNumber === true ? (desborde ? desborde.numero : numeroBase || null) : null,
    birthDate: checks.birthDate === true ? toIsoDate(nacimiento, 'nacimiento') : null,
    expirationDate: checks.expirationDate === true ? toIsoDate(caducidad, 'caducidad') : null,
    sex: sexo === 'M' || sexo === 'F' ? sexo : sexo === '<' ? 'X' : null,
    nationality: nacionalidad || null,
    issuingState: normalizeAlpha(l1.slice(2, 5).replace(/</g, '')) || null,
    lastNames: nombres.lastNames,
    firstNames: nombres.firstNames,
    checks,
  };
}
