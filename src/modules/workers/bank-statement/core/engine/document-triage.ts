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

/** Qué hacer con el documento, decidido antes de intentar extraer nada. */
export type DocumentVerdict = 'ACCEPT' | 'REVIEW' | 'REJECT';

export interface TriageThresholds {
  /** Desde aquí se procesa sin preguntar. */
  readonly accept: number;
  /** Desde aquí hay duda razonable; por debajo, no la hay. */
  readonly review: number;
}

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

/**
 * Ordena las dos fronteras y las acota a `[0, 1]`.
 *
 * Se saneia aquí y no en quien configura porque los valores llegan del entorno
 * del anfitrión: con `review > accept` la franja de revisión sería vacía y todo
 * documento dudoso se rechazaría en silencio, que es justo el fallo que este
 * módulo existe para impedir.
 */
export function normalizeThresholds(thresholds: Partial<TriageThresholds> = {}): TriageThresholds {
  const accept = clamp(thresholds.accept ?? DEFAULT_TRIAGE_THRESHOLDS.accept);
  const review = clamp(thresholds.review ?? DEFAULT_TRIAGE_THRESHOLDS.review);
  return { accept, review: Math.min(review, accept) };
}

/**
 * El veredicto. `>= accept` procesa, `>= review` pregunta, y por debajo rechaza.
 *
 * Las comparaciones son inclusivas hacia arriba a propósito: un documento que
 * cae justo en la frontera se trata como el lado más permisivo de las dos, de
 * modo que subir un umbral nunca deja un caso sin clasificar.
 */
export function triageDocument(
  confidence: number,
  thresholds: TriageThresholds = DEFAULT_TRIAGE_THRESHOLDS,
): DocumentVerdict {
  if (confidence >= thresholds.accept) return 'ACCEPT';
  if (confidence >= thresholds.review) return 'REVIEW';
  return 'REJECT';
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
