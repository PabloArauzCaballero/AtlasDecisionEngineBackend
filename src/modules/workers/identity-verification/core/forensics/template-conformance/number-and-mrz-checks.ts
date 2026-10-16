import type { Revision } from './revision';
import { esNumeroDeCedulaValido } from '../../catalog/bolivia-ci.catalog';

export function revisarNumeroYMrz(revision: Revision): void {
  const { campos, mrz } = revision.entrada;
  const { fallos, notas } = revision;

  // --- 1. El número de cédula respeta el formato del SEGIP -----------------
  const numero = campos.documentNumber?.value ?? null;
  if (numero && !esNumeroDeCedulaValido(numero)) {
    notas.push({
      codigo: 'DOCUMENT_NUMBER_SHAPE_UNEXPECTED',
      detalle: `El número leído («${numero.slice(0, 16)}») no encaja en la forma que este catálogo espera.`,
      razonDeNoAcusar:
        'La gramática del número del SEGIP no está verificada: no se conocen longitud mínima, ' +
        'longitud máxima, política de ceros iniciales ni la forma exacta del complemento. ' +
        'Rechazar por una longitud no verificada descartaría cédulas legítimas.',
    });
  }

  // --- 2. La MRZ y el anverso dicen lo mismo -------------------------------
  /*
   * Sólo se contrasta cuando el dígito de control del número de la MRZ CUADRA.
   *
   * Sin esa condición, una MRZ mal leída —que es lo normal en una foto con
   * reflejos— produciría una acusación de manipulación contra un documento
   * legítimo. Con ella, la discrepancia significa lo que parece: los dos números
   * están bien leídos y son distintos, o sea que el reverso y el anverso no son
   * de la misma tarjeta.
   */
  if (mrz?.documentNumber && mrz.checks.documentNumber === true && numero) {
    const enMrz = mrz.documentNumber.replace(/\D/gu, '');
    const enAnverso = numero.replace(/\D/gu, '');
    if (enMrz && enAnverso && !enMrz.endsWith(enAnverso) && !enAnverso.endsWith(enMrz)) {
      fallos.push({
        codigo: 'MRZ_DOCUMENT_NUMBER_MISMATCH',
        detalle:
          'El número de la zona de lectura mecánica valida su dígito de control y aun así no coincide con el impreso en el anverso.',
        peso: 0.45,
      });
    }
  }

  if (mrz && mrz.sex !== null && !['M', 'F', 'X'].includes(mrz.sex)) {
    fallos.push({
      codigo: 'MRZ_SEX_INVALID',
      detalle: 'El campo de sexo de la MRZ no es ninguno de los tres valores que admite la norma.',
      peso: 0.2,
    });
  }

  /*
   * Una MRZ presente cuyo control COMPUESTO no cuadra.
   *
   * El compuesto se calcula sobre los dos renglones enteros, así que acertarlo
   * por casualidad es difícil y fallarlo por un glifo mal leído es fácil. Por
   * eso pesa poco: es una señal para escalar, nunca para rechazar sola.
   */
  if (mrz && mrz.checks.composite === null) {
    notas.push({
      codigo: 'MRZ_COMPOSITE_NOT_EVALUABLE',
      detalle:
        'Se leyó una zona de lectura mecánica pero su dígito de control compuesto no es legible.',
      razonDeNoAcusar:
        'Un dígito que el reconocedor no leyó no es un dígito que no cuadre. Medido sobre 23 ' +
        'cédulas auténticas, cuatro traían ese dígito ilegible.',
    });
  }
  if (mrz && mrz.checks.composite === false) {
    fallos.push({
      codigo: 'MRZ_COMPOSITE_CHECK_FAILED',
      detalle:
        'Se leyó una zona de lectura mecánica pero su dígito de control compuesto no cuadra.',
      peso: 0.15,
    });
  }
}
