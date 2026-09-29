/**
 * El codigo del caso de revision manual que abre una ejecucion.
 *
 * Vive aparte porque lo escriben DOS sitios que no pueden discrepar: `ExecutionWriterService`, que
 * crea la fila, y la respuesta de `execute`, que se lo anuncia a quien llamo para que sepa que aqui
 * hay una bandeja que atender. Si los dos lo construyeran por su cuenta, un cambio de formato en
 * uno dejaria al otro nombrando un caso que no existe.
 */
export function manualReviewCaseCode(executionId: bigint): string {
  return `MR-${executionId.toString().padStart(10, '0')}`;
}

/**
 * Los desenlaces que significan «a revisión humana». `MANUAL_REVIEW` lo pone el motor (nodo
 * MANUAL_REVIEW o acción CREATE_MANUAL_REVIEW); `REVISION_MANUAL` y `REVISAR` son los rótulos que los
 * artefactos de negocio (KYB, onboarding) devuelven por OUTPUT_PRIMARY en un nodo RESULT. Cualquiera
 * de ellos obliga a que exista un caso; ver `ExecutionWriterService.assertManualReviewConsistency`.
 */
export const MANUAL_REVIEW_OUTCOMES: ReadonlySet<string> = new Set([
  'MANUAL_REVIEW',
  'REVISION_MANUAL',
  'REVISAR',
]);

export function isManualReviewOutcome(outcome: unknown): boolean {
  return typeof outcome === 'string' && MANUAL_REVIEW_OUTCOMES.has(outcome.trim().toUpperCase());
}
