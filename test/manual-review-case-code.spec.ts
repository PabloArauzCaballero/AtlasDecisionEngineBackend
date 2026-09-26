import { manualReviewCaseCode } from '../src/modules/runtime/manual-review-case-code';

/**
 * El codigo del caso lo escriben DOS sitios que no pueden discrepar.
 *
 * `ExecutionWriterService` crea la fila y la respuesta de `execute` se lo anuncia a quien llamo,
 * para que AtlasBackend sepa que aqui hay una bandeja que atender y no abra una segunda para el
 * mismo cliente. Si cada uno construyera el codigo por su cuenta, un cambio de formato en uno
 * dejaria al otro nombrando un caso que no existe — y el fallo no seria ruidoso: el analista
 * llegaria a una pantalla vacia con su cola ya cerrada.
 */
describe('manualReviewCaseCode', () => {
  it('rellena con ceros a diez digitos', () => {
    expect(manualReviewCaseCode(1n)).toBe('MR-0000000001');
    expect(manualReviewCaseCode(88001n)).toBe('MR-0000088001');
  });

  it('no trunca un id mas largo que el relleno', () => {
    expect(manualReviewCaseCode(12345678901n)).toBe('MR-12345678901');
  });
});
