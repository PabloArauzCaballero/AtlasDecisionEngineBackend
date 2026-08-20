/**
 * Triaje por confianza: aceptar, preguntar o rechazar.
 *
 * ## Por qué vive en `common/` y no dentro de un worker
 *
 * Es la misma decisión en todos los clasificadores del motor: un número entre 0 y 1 y tres
 * destinos. Cada worker calibra sus propias fronteras —lo que para extractos es duda razonable para
 * identidad no lo es—, pero la REGLA de reparto no cambia, y con una copia por worker basta con que
 * dos se separen para que dos colas de revisión se comporten distinto sin que nadie lo note.
 *
 * ## La franja de en medio es la que cuesta dinero
 *
 * Por debajo, el sistema tiene evidencia suficiente para negarse, y negarse es más útil —y más
 * barato— que preguntar. Por encima, procesa. La franja intermedia es la única que **pide a una
 * persona**, así que es la única que consume tiempo humano: abrirla de más llena la cola de casos
 * que el sistema podría haber resuelto solo, y una cola que no se puede vaciar deja de leerse.
 */

/** Qué hacer con el documento. */
export type DocumentVerdict = 'ACCEPT' | 'REVIEW' | 'REJECT';

/** Las dos fronteras que reparten el rango [0, 1] en los tres destinos. */
export interface TriageThresholds {
  /** Desde aquí, inclusive, se procesa sin intervención. */
  accept: number;
  /** Desde aquí, inclusive, se pregunta a una persona. Por debajo se rechaza. */
  review: number;
}

/** Deja un número dentro de [0, 1]. Lo que no es número se trata como 0. */
function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * Sanea unos umbrales contra sus valores por defecto.
 *
 * Hace dos cosas, y las dos importan:
 *
 * 1. **Acota al rango [0, 1]**, en vez de propagar el valor. Una confianza es una probabilidad; un
 *    umbral de 5 no rechaza «casi todo», rechaza TODO, y el síntoma —una cola vacía— es
 *    indistinguible de que el clasificador vaya perfecto.
 * 2. **Impide una franja de revisión imposible.** Con `review` por encima de `accept` la franja de
 *    duda queda VACÍA y todo documento dudoso pasa a rechazarse sin que nada lo delate: la pantalla
 *    sigue funcionando igual y la cola simplemente no se llena. Se baja `review` hasta `accept` en
 *    lugar de subir `accept`, porque relajar lo que se procesa sin intervención por un error de
 *    configuración sería peor: convertiría una errata en una política de aceptación más laxa.
 *
 * Lo que no venga en `overrides` se toma de `defaults`, que también se saneen: un valor por defecto
 * mal escrito no debería colarse solo por serlo.
 */
export function normalizeThresholds(
  overrides: Partial<TriageThresholds>,
  defaults: TriageThresholds,
): TriageThresholds {
  const accept = clamp01(overrides.accept ?? defaults.accept);
  const review = clamp01(overrides.review ?? defaults.review);
  return { accept, review: Math.min(review, accept) };
}

/**
 * El veredicto de una confianza contra unas fronteras.
 *
 * Ambas fronteras son **inclusivas**: una confianza exactamente igual al umbral de aceptación se
 * procesa, y una igual al de revisión se pregunta. Es lo contrario de lo intuitivo al escribir el
 * `if`, y es deliberado: un umbral se calibra observando dónde empieza a fallar, así que el valor
 * medido debe caer del lado bueno de su propia frontera.
 *
 * Se asume que `thresholds` ya pasó por {@link normalizeThresholds}; si no, una franja invertida
 * haría que `review` no se alcanzara nunca — que es exactamente el fallo silencioso que esa función
 * existe para impedir.
 */
export function triageByConfidence(
  confidence: number,
  thresholds: TriageThresholds,
): DocumentVerdict {
  const value = clamp01(confidence);
  if (value >= thresholds.accept) return 'ACCEPT';
  if (value >= thresholds.review) return 'REVIEW';
  return 'REJECT';
}
