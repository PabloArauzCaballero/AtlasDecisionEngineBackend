/**
 * Tres desenlaces para una confianza, y las dos fronteras que los separan.
 *
 * Nace en el worker de extractos (`bank-statement/core/engine/document-triage.ts`)
 * y sube aquí sin cambiar de comportamiento porque el worker de identidad
 * necesitaba exactamente lo mismo: un solo umbral no alcanza para decidir tres
 * cosas distintas.
 *
 * Con una frontera única, «esto no es lo que este worker procesa» y «esto se le
 * parece pero no estoy seguro» caen del mismo lado y reciben el mismo trato. Los
 * dos acaban en la misma cola, y una cola de revisión con documentos que nadie
 * debió subir deja de revisarse: cuesta dinero, esconde los casos que sí
 * importan y hace imposible medir si el motor mejora.
 *
 * **La franja de en medio es la única que PIDE a una persona.** Por debajo el
 * sistema tiene evidencia suficiente para negarse, y negarse es más útil —y más
 * barato— que preguntar.
 *
 * Lo que NO vive aquí es cuánto vale cada frontera: eso es política de cada
 * worker, medida con sus documentos, y por eso los valores por defecto se
 * declaran en su módulo y no en este archivo.
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
 * Ordena las dos fronteras y las acota a `[0, 1]`.
 *
 * Se sanea aquí y no en quien configura porque los valores llegan del entorno
 * del anfitrión: con `review > accept` la franja de revisión sería vacía y todo
 * documento dudoso se rechazaría en silencio, que es justo el fallo que este
 * módulo existe para impedir.
 */
export function normalizeThresholds(
  thresholds: Partial<TriageThresholds>,
  porDefecto: TriageThresholds,
): TriageThresholds {
  const accept = clamp(thresholds.accept ?? porDefecto.accept);
  const review = clamp(thresholds.review ?? porDefecto.review);
  return { accept, review: Math.min(review, accept) };
}

/**
 * El veredicto. `>= accept` procesa, `>= review` pregunta, y por debajo rechaza.
 *
 * Las comparaciones son inclusivas hacia arriba a propósito: un documento que
 * cae justo en la frontera se trata como el lado más permisivo de las dos, de
 * modo que subir un umbral nunca deja un caso sin clasificar.
 */
export function triageByConfidence(
  confidence: number,
  thresholds: TriageThresholds,
): DocumentVerdict {
  if (confidence >= thresholds.accept) return 'ACCEPT';
  if (confidence >= thresholds.review) return 'REVIEW';
  return 'REJECT';
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
