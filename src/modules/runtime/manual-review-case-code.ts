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
