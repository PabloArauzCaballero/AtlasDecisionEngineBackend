/**
 * Núcleo analítico del monitoreo de modelo.
 *
 * Funciones puras y sin dependencias: reciben filas ya leídas y devuelven números. Está
 * separado del servicio a propósito, porque lo que hay que poder verificar aquí no es que la
 * consulta traiga las filas correctas sino que la **aritmética** sea la correcta —una tasa de
 * malos mal calculada no falla, simplemente miente— y eso se comprueba con casos escritos a
 * mano contra valores conocidos.
 *
 * Las tres medidas responden a preguntas distintas de SR 11-7 §V y CMN 4.557 art. 40:
 *
 *  - `summarizePerformance` — ¿el modelo sigue acertando?
 *  - `populationStabilityIndex` — ¿le siguen llegando los mismos solicitantes?
 *  - `adverseImpactRatios` — ¿trata igual a grupos comparables?
 */
export { adverseImpactRatios, isApproval } from './adverse-impact';
export type { AdverseImpactGroup, AdverseImpactResult, GroupOutcome } from './adverse-impact';
export { summarizePerformance } from './performance';
export type { ObservedDecision, OutcomeLabel, PerformanceSummary } from './performance';
export {
  bucketOfSnapshot,
  bucketOfValue,
  populationStabilityIndex,
  psiAgainstBaseline,
} from './stability';
export type { StabilityBucket, StabilityResult } from './stability';
