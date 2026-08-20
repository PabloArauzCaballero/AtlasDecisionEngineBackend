/**
 * Qué se hace con un documento según lo que la clasificación demostró.
 *
 * Existe porque un solo umbral no alcanza para decidir tres cosas. Con la
 * frontera única de antes (`confidence >= 0.55`), un contrato y un extracto con
 * el encabezado ilegible caían del mismo lado y recibían el mismo trato: los dos
 * se rechazaban con el mismo código, y cuando ese código empezó a derivar a
 * revisión humana los dos empezaron a llenar la misma cola. Una cola de revisión
 * con facturas dentro no se revisa: se ignora.
 *
 * La franja de en medio es la única que PIDE a una persona. Por debajo el
 * sistema tiene evidencia suficiente para negarse, y negarse es más útil —y más
 * barato— que preguntar.
 */

import {
  triageByConfidence,
  normalizeThresholds as normalizeConUmbrales,
  type DocumentVerdict,
  type TriageThresholds,
} from '../../../../../common/triage/confidence-triage';

export type { DocumentVerdict, TriageThresholds };

/**
 * Fronteras por defecto, calibrables con datos reales.
 *
 * `accept` es el umbral histórico y no se mueve: un extracto sin ningún rótulo
 * reconocible suma 0.70 —título, filas con fecha y filas con importe— y un
 * documento que sólo tenga fechas e importes se queda en 0.40 antes de la
 * penalización.
 *
 * `review` se sitúa donde deja de haber duda razonable. Con 0.30 caben todavía
 * tres señales sueltas —un rótulo de cuenta, uno de saldo y una columna de
 * importe— o bien la tabla de movimientos sin ningún rótulo; por debajo no queda
 * ni eso, y lo que hay delante es otro documento. Medido sobre los escenarios
 * del módulo: una factura con fechas e importes puntúa 0.40 y baja a 0.05 con la
 * penalización de contraindicador, y una carta o una fotografía no pasan de 0.
 */
export const DEFAULT_TRIAGE_THRESHOLDS: TriageThresholds = {
  accept: 0.55,
  review: 0.3,
};

/** Los umbrales del worker de extractos, saneados contra sus propios valores. */
export function normalizeThresholds(thresholds: Partial<TriageThresholds> = {}): TriageThresholds {
  return normalizeConUmbrales(thresholds, DEFAULT_TRIAGE_THRESHOLDS);
}

/** El veredicto de un documento contra los umbrales del worker de extractos. */
export function triageDocument(
  confidence: number,
  thresholds: TriageThresholds = DEFAULT_TRIAGE_THRESHOLDS,
): DocumentVerdict {
  return triageByConfidence(confidence, thresholds);
}
