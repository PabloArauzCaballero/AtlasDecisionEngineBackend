import { MARCAS_DE_FALSIFICACION } from '../../catalog/bolivia-ci.catalog';
import { reconocerCedulaBoliviana } from '../../catalog/bolivia-ci.recognizer';
import { plegarTexto } from '../../engine/identity-evidence';
import { examinar } from './examine';
import type { AnalisisDePlantilla, EntradaDePlantilla } from './types';

/**
 * Por debajo de esto, los rótulos de la plantilla no se pueden leer.
 *
 * **Mil píxeles de lado largo**, y el número viene de dos sitios que coinciden:
 *
 * 1. La conversión del corpus: la recomendación general de Tesseract son 300
 *    ppp, y una tarjeta de 85 mm a 300 ppp son 1003,94 px de lado largo.
 * 2. La medición propia sobre una cédula boliviana AUTÉNTICA, que es la que
 *    obliga a poner el suelo aquí y no más abajo:
 *
 *        lado del OCR   600     900     1200    1600
 *        cobertura      0,216   0,463   0,515   0,664
 *
 *    El umbral de cobertura del fusor está en 0,40. A 600 px un documento
 *    legítimo da 0,216 —acusación garantizada— y a 900 da 0,463, que deja un
 *    margen de seis centésimas: cualquier reflejo se lo come.
 *
 * Sobre las 23 cédulas auténticas del directorio de pruebas, la mediana del lado
 * largo es **796 px**. O sea: la mayoría de las fotos que la gente manda por
 * mensajería NO permiten juzgar la plantilla, y el sistema llevaba meses
 * juzgándola igual. Lo que corresponde con esas fotos es pedir otra captura,
 * que es lo que el corpus llama `RECAPTURE_OR_REVIEW`.
 */
export const LADO_LARGO_MINIMO_LEGIBLE = 1000;

/**
 * Contrasta lo leído con todas las plantillas y devuelve el análisis completo.
 *
 * El texto del ANVERSO y el del REVERSO se pasan por separado y no unidos, y es
 * la diferencia entre medir una plantilla y contar palabras: un anclaje del
 * reverso encontrado en el anverso no es la tarjeta que el catálogo describe.
 * Cuando sólo hay anverso —que es una captura legítima y frecuente— los anclajes
 * de reverso no restan: ausentes por no haberse fotografiado, no por no existir.
 */
export function analizarPlantilla(entrada: EntradaDePlantilla): AnalisisDePlantilla {
  const completo = `${plegarTexto(entrada.textoAnverso)}\n${plegarTexto(entrada.textoReverso)}`;
  const { mejor, todas } = reconocerCedulaBoliviana({
    textoAnverso: entrada.textoAnverso,
    textoReverso: entrada.textoReverso,
  });

  const minimo = entrada.ladoLargoMinimo ?? LADO_LARGO_MINIMO_LEGIBLE;
  const lado = entrada.ladoLargoPx ?? null;
  const coberturaEvaluable = lado === null || lado >= minimo;
  const { incoherencias, observaciones } = examinar(entrada, completo, mejor);

  return {
    mejor,
    todas,
    incoherencias,
    observaciones,
    coberturaEvaluable,
    motivoDeNoEvaluable: coberturaEvaluable
      ? null
      : `La imagen mide ${String(lado)} px de lado largo y hacen falta ${String(minimo)} para leer los rótulos de la plantilla.`,
    marcasDeFalsificacion: MARCAS_DE_FALSIFICACION.filter((marca) =>
      marca.patron.test(completo),
    ).map((marca) => marca.codigo),
  };
}
