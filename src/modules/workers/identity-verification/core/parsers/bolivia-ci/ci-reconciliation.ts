import type { MrzTd1 } from '../mrz-td1';
import { BOLIVIA_CI_WARNINGS } from './bolivia-ci-warnings';
import { fechaNormalizada } from './ci-dates';
import { preferir } from './ci-mrz-preference';
import { resolverNombre } from './ci-name-resolution';
import type { CamposImpresos } from './ci-printed-fields';

/** Cada campo resuelto —MRZ validada o texto impreso— y los avisos que dejó el contraste. */
export type CamposConciliados = ReturnType<typeof conciliarConMrz>;

/**
 * Contrasta lo impreso con la MRZ y resuelve cada campo: MRZ validada > texto
 * impreso, con aviso cuando las dos existen y no coinciden.
 */
export function conciliarConMrz(mrz: MrzTd1 | null, impresos: CamposImpresos) {
  const warnings: string[] = [];
  const { documentNumber, nombres, apellidos, fullName, birth, expiry, caducidadIndefinida } =
    impresos;

  const dateOfBirth = fechaNormalizada(birth);
  // La ÚLTIMA de las fechas del renglón: la emisión va antes que la expiración.
  // Salvo que la tarjeta diga que no caduca: entonces la única fecha del
  // renglón es la de EMISIÓN, y tomarla como caducidad declara caducado en
  // 2024 un documento que no vence nunca.
  const expirationDate = caducidadIndefinida ? null : fechaNormalizada(expiry, 'ultima');

  /*
   * Resolución de cada campo: MRZ validada > texto impreso.
   *
   * Y cuando las dos existen y NO coinciden, se avisa. Un anverso y un
   * reverso que no dicen lo mismo es la firma de un documento compuesto, no
   * un problema de lectura, y esconderlo detrás de «la MRZ manda» sería
   * quedarse con el dato bueno y tirar la señal.
   */
  const numero = preferir(mrz?.documentNumber ?? null, documentNumber?.value ?? null);
  const nacimiento = preferir(mrz?.birthDate ?? null, dateOfBirth?.value ?? null);
  const caducidad = preferir(mrz?.expirationDate ?? null, expirationDate?.value ?? null);
  /*
   * La caducidad indefinida NO cuenta como discrepancia con la MRZ.
   *
   * La norma ICAO exige seis dígitos en el campo de caducidad y no admite
   * «indefinido», así que el SEGIP codifica lo indefinido con una fecha
   * centinela lejana: medido sobre una cédula auténtica cuyo anverso imprime
   * `FECHA DE EXPIRACIÓN: INDEFINIDO`, su MRZ dice `491125`, o sea 2049. El
   * impreso y la MRZ dicen cosas distintas y las DOS son correctas — no es un
   * documento compuesto, es cómo se escribe «no caduca» en una zona de lectura
   * mecánica. Sin esta excepción, la cédula salía marcada con
   * `DOCUMENT_MRZ_MISMATCH`, que es una señal de fraude.
   */
  /*
   * El número discrepa → documento compuesto. Sólo las fechas → mala lectura.
   *
   * Ver `mrzDateMismatch`: son dos acusaciones distintas y antes compartían
   * marca, así que una cédula auténtica con una fecha mal leída llegaba al
   * análisis de fraude con la señal de montaje.
   */
  const fechasDiscrepan = nacimiento.discrepa || (caducidad.discrepa && !caducidadIndefinida);
  if (numero.discrepa) warnings.push(BOLIVIA_CI_WARNINGS.mrzMismatch);
  else if (fechasDiscrepan) warnings.push(BOLIVIA_CI_WARNINGS.mrzDateMismatch);
  /*
   * Sólo cuando el control se pudo COMPROBAR y no cuadró.
   *
   * `null` significa que el dígito llegó ilegible —un `?`, una minúscula, un
   * espacio— y avisar de «control fallido» ahí acusaba al documento de un
   * defecto que es de la fotografía. Ver `checks` en `mrz-td1.ts`.
   */
  if (mrz && mrz.checks.composite === false) warnings.push(BOLIVIA_CI_WARNINGS.mrzCheckFailed);

  /*
   * El nombre sale, por este orden, de: la MRZ, los rótulos del formato
   * vigente, o el corte por convención del formato anterior. Sólo el último
   * es una suposición, y sólo ése levanta el aviso.
   */
  const partes = resolverNombre(mrz, nombres, apellidos, fullName);
  if (partes.heuristico) warnings.push(BOLIVIA_CI_WARNINGS.nameSplitHeuristic);
  if (partes.rotuloIlegible) warnings.push(BOLIVIA_CI_WARNINGS.printedNameUnusable);
  if (partes.discrepaConMrz) warnings.push(BOLIVIA_CI_WARNINGS.nameMrzMismatch);

  if (!numero.valor) warnings.push(BOLIVIA_CI_WARNINGS.documentNumberNotFound);
  if (!partes.firstNames && !partes.lastNames && !partes.fullName) {
    warnings.push(BOLIVIA_CI_WARNINGS.nameNotFound);
  }
  if (!birth && !mrz?.birthDate) warnings.push(BOLIVIA_CI_WARNINGS.dateOfBirthNotFound);
  else if (!nacimiento.valor) warnings.push(BOLIVIA_CI_WARNINGS.unparsableDateOfBirth);
  if (caducidadIndefinida) warnings.push(BOLIVIA_CI_WARNINGS.expiryIndefinite);
  else if (!expiry && !mrz?.expirationDate) warnings.push(BOLIVIA_CI_WARNINGS.expiryNotFound);
  else if (!caducidad.valor) warnings.push(BOLIVIA_CI_WARNINGS.unparsableExpiry);

  return { numero, nacimiento, caducidad, partes, warnings };
}
