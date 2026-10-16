import type { Revision } from './revision';
import { NOMBRES_DE_DEPARTAMENTO } from '../../catalog/bolivia-ci.catalog';
import { plegarTexto } from '../../engine/identity-evidence';

export function revisarLugarYNacionalidad(revision: Revision): void {
  const { campos, mrz } = revision.entrada;
  const { notas } = revision;

  // --- 4. El lugar de nacimiento nombra un departamento boliviano ----------
  /*
   * Sólo se comprueba cuando se llegó a leer el campo. Un lugar ilegible es
   * silencio, y el silencio no acusa a nadie: lo que se busca aquí es un lugar
   * PERFECTAMENTE legible que no está en Bolivia, que es la firma de una
   * plantilla de otro país reetiquetada.
   */
  const lugar = campos.placeOfBirth?.value;
  if (lugar && lugar.trim().length >= 4) {
    const plegado = plegarTexto(lugar);
    const conocido = NOMBRES_DE_DEPARTAMENTO.some((departamento) => plegado.includes(departamento));
    if (!conocido && /BOLIVIA/u.test(plegado) === false) {
      notas.push({
        codigo: 'BIRTH_PLACE_NOT_BOLIVIAN',
        detalle: `El lugar de nacimiento leído («${lugar.slice(0, 40)}») no nombra ningún departamento de Bolivia.`,
        razonDeNoAcusar:
          'Una persona nacida fuera de Bolivia puede tener cédula boliviana, y el campo se lee ' +
          'sobre el guilloché del reverso con frecuencia a medias. Medido sobre 23 cédulas ' +
          'auténticas, esta regla acusó a una.',
      });
    }
  }

  // --- 5. La nacionalidad de la MRZ ----------------------------------------
  /*
   * Y sólo cuando el ESTADO EMISOR tampoco dice BOL.
   *
   * Los dos campos son códigos ISO de tres letras y **ninguno de los dos está
   * cubierto por un dígito de control** —el compuesto abarca el número y las dos
   * fechas—, así que los dos se leen mal con la misma facilidad. Medido sobre una
   * cédula boliviana auténtica: el segundo renglón llegó con un glifo de más
   * (`BO0L`), la nacionalidad salió `BOO` y el documento quedaba acusado de
   * declarar una nacionalidad extranjera. El emisor, en el otro renglón, decía
   * `BOL` sin dudar.
   *
   * Exigir que fallen los DOS es lo que separa un montaje de una errata: quien
   * reetiqueta la plantilla de otro país deja los dos campos del país de origen,
   * mientras que el reconocedor se equivoca en uno cada vez.
   */
  if (
    mrz?.nationality &&
    mrz.nationality !== 'BOL' &&
    mrz.issuingState !== 'BOL' &&
    /^[A-Z]{3}$/u.test(mrz.nationality)
  ) {
    notas.push({
      codigo: 'MRZ_NATIONALITY_NOT_BOL',
      detalle: `La MRZ declara nacionalidad ${mrz.nationality} y emisor ${mrz.issuingState ?? '—'} en un documento que se presenta como cédula boliviana.`,
      razonDeNoAcusar:
        'Ni la nacionalidad ni el estado emisor están cubiertos por un dígito de control, así que ' +
        'los dos se leen mal con la misma facilidad; y un titular extranjero con cédula boliviana ' +
        'tiene legítimamente otra nacionalidad.',
    });
  }
}
