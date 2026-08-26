/**
 * La PRIMERA compuerta: si el archivo es el que emitió un banco o lo fabricó
 * alguien.
 *
 * Va antes que la clasificación y antes que el emisor, y el orden es la mitad
 * del arreglo. Las otras dos se contestan leyendo el texto impreso, y el texto
 * impreso lo escribe quien fabrica el archivo: un documento compuesto en Word
 * con la carátula de un banco copiada pasa las dos, y llega al análisis con una
 * tabla de movimientos que redactó el propio solicitante. Preguntar primero por
 * el CONTENEDOR —con qué se produjo, si se reescribió, si lleva tachaduras— es
 * lo único que ese documento no puede satisfacer escribiendo el texto correcto.
 *
 * ## Tres veredictos
 *
 * - `AUTHENTIC`: nada que objetar, o sólo señales débiles ya explicadas. Se
 *   procesa.
 * - `SUSPECT`: hay indicios y ninguno concluyente. **Va a una persona.** Es la
 *   franja donde vive el «Guardar como PDF» del navegador, el archivo con una
 *   revisión incremental y el que no declara su generador: casos en los que
 *   rechazar castigaría a un cliente honesto y aceptar sería mirar para otro
 *   lado.
 * - `TAMPERED`: hay evidencia positiva de composición o de edición. Se rechaza
 *   en el momento y con su motivo, porque es la única acción que mueve el caso:
 *   quien lo subió tiene que ir a por el PDF que descarga de su banco.
 *
 * ## Por qué el rechazo se le explica al usuario
 *
 * Porque el motivo es accionable y decírselo cuesta lo mismo que callarlo. «No
 * pudimos procesar tu extracto» deja a la persona reintentando con el mismo
 * archivo hasta que se rinde; «este PDF pasó por un editor, sube el que descarga
 * tu banca por internet» se resuelve en un minuto. El detalle técnico —qué
 * herramienta, cuántas revisiones— queda en la traza para quien audite, no en la
 * pantalla del cliente.
 */

import type { DocumentVerdict } from '../document-triage';
import { assessProvenance, readPdfProvenance, type ForensicReport } from './pdf-forensics';

export type AuthenticityVerdict = 'AUTHENTIC' | 'SUSPECT' | 'TAMPERED';

export interface AuthenticityAssessment {
  readonly verdict: AuthenticityVerdict;
  /** Qué hacer con el documento, en la misma escala que el triage y el emisor. */
  readonly disposition: DocumentVerdict;
  readonly report: ForensicReport;
  /** Por qué, ya redactado. Queda en la traza y en el detalle del error. */
  readonly reasons: readonly string[];
}

export interface AuthenticityGateOptions {
  /**
   * Si un documento con evidencia de manipulación se rechaza de verdad.
   *
   * Está aquí y no compilado a `true` por el mismo motivo que en la compuerta de
   * emisor: encender una exigencia nueva sobre un motor en marcha rechaza
   * documentos que ayer pasaban, y esa decisión es de quien opera el sistema.
   * Con `false` la compuerta sigue midiendo y dejando constancia — se puede ver
   * cuánto rechazaría antes de dejar que rechace.
   */
  readonly enforce: boolean;
  /** A partir de aquí el documento se rechaza. */
  readonly rejectScore: number;
  /** A partir de aquí va a una persona. */
  readonly reviewScore: number;
}

/**
 * Fronteras por defecto, calibradas contra los pesos de `pdf-forensics`.
 *
 * `reject` en 70 deja fuera cualquier combinación de señales débiles: la suma de
 * impresión desde navegador (15) + sin metadatos (20) + fuentes sin incrustar
 * (25) + una revisión (30) llega a 90 en el peor caso, pero esas cuatro juntas
 * describen un archivo que sí merece rechazarse. Una sola señal media nunca
 * rechaza; una alta (anotaciones superpuestas, 70) sí, y es correcto: no hay
 * lectura inocente de un extracto con contenido superpuesto.
 *
 * `review` en 30 es donde deja de haber duda razonable de que algo pasó con el
 * archivo. Por debajo hay ruido de generador.
 */
export const DEFAULT_AUTHENTICITY_OPTIONS: AuthenticityGateOptions = {
  enforce: true,
  rejectScore: 70,
  reviewScore: 30,
};

export function assessAuthenticity(
  buffer: Buffer,
  textPageRatio: number,
  options: AuthenticityGateOptions = DEFAULT_AUTHENTICITY_OPTIONS,
): AuthenticityAssessment {
  const report = assessProvenance(readPdfProvenance(buffer), textPageRatio);
  const assessment = classify(report, options);
  if (options.enforce || assessment.disposition === 'ACCEPT') return assessment;
  /*
   * En modo de medición el veredicto se conserva íntegro y sólo se relaja el
   * desenlace: guardar el veredicto real es lo que permite responder «¿cuántos
   * documentos rechazaríamos?» sin haber rechazado ninguno todavía.
   */
  return {
    ...assessment,
    disposition: 'ACCEPT',
    reasons: [...assessment.reasons, 'compuerta-en-medicion'],
  };
}

function classify(
  report: ForensicReport,
  options: AuthenticityGateOptions,
): AuthenticityAssessment {
  /*
   * Las señales que sostienen el veredicto son las POSITIVAS. La retirada de
   * sospecha (`GENERADOR_INSTITUCIONAL`, peso negativo) ya hizo su trabajo
   * bajando el puntaje; repetirla como «motivo» del rechazo diría lo contrario
   * de lo que significa.
   */
  const reasons = report.signals
    .filter((signal) => signal.weight > 0)
    .sort((left, right) => right.weight - left.weight)
    .map((signal) => `${signal.code}: ${signal.detail}`);

  if (report.suspicionScore >= options.rejectScore) {
    return { verdict: 'TAMPERED', disposition: 'REJECT', report, reasons };
  }
  if (report.suspicionScore >= options.reviewScore) {
    return { verdict: 'SUSPECT', disposition: 'REVIEW', report, reasons };
  }
  return {
    verdict: 'AUTHENTIC',
    disposition: 'ACCEPT',
    report,
    reasons: reasons.length > 0 ? reasons : ['sin-indicios-de-manipulacion'],
  };
}

/**
 * La frase que se le enseña a quien subió el documento.
 *
 * Deliberadamente SIN el detalle técnico. «Producido con Adobe Photoshop» le
 * dice a un defraudador exactamente qué señal evitar la próxima vez, y a un
 * cliente honesto no le dice nada que pueda usar. Lo que sí necesita saber está
 * en la segunda frase: dónde conseguir el archivo bueno.
 */
export function tamperingMessage(verdict: AuthenticityVerdict): string {
  if (verdict === 'TAMPERED') {
    return (
      'El archivo no es el PDF original que emite un banco: fue compuesto o editado con otro programa. ' +
      'Sube el extracto tal como lo descargas de tu banca por internet, sin abrirlo ni volver a guardarlo.'
    );
  }
  return (
    'El archivo tiene indicios de haber sido modificado después de emitirse y necesita una revisión manual. ' +
    'Si puedes, vuelve a descargar el extracto de tu banca por internet y súbelo sin abrirlo.'
  );
}
