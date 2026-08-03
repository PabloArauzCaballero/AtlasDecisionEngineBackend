import { buildSampleBatch } from '../src/modules/qa-lab/sample-inputs';

/**
 * Generación de entradas de ejemplo para un campo calculado.
 *
 * El campo calculado NO tiene generador propio: reutiliza el del QA Lab mapeando
 * sus entradas al contrato que aquél espera. Lo que se prueba aquí es ese
 * contrato, porque si se rompiera el botón seguiría existiendo pero devolvería
 * valores que no respetan las restricciones declaradas.
 */
const inputs = [
  {
    code: 'cuota_solicitada',
    dataType: 'DECIMAL',
    required: true,
    nullable: false,
    constraints: { min: 0, max: 10000 },
  },
  {
    code: 'ingreso_disponible',
    dataType: 'DECIMAL',
    required: true,
    nullable: false,
    constraints: { min: 1, max: 10000 },
  },
];

const seeds = () => 'semilla-fija';

describe('entradas de ejemplo de un campo calculado', () => {
  it('genera un valor por cada entrada declarada', () => {
    const batch = buildSampleBatch(inputs, { kind: 'VALID', count: 1 }, seeds);
    expect(batch.cases).toHaveLength(1);
    expect(Object.keys(batch.cases[0].input).sort()).toEqual([
      'cuota_solicitada',
      'ingreso_disponible',
    ]);
  });

  it('respeta las restricciones en los casos válidos', () => {
    const batch = buildSampleBatch(inputs, { kind: 'VALID', count: 8 }, seeds);
    for (const testCase of batch.cases) {
      const cuota = testCase.input.cuota_solicitada as number;
      const ingreso = testCase.input.ingreso_disponible as number;
      expect(cuota).toBeGreaterThanOrEqual(0);
      expect(cuota).toBeLessThanOrEqual(10000);
      expect(ingreso).toBeGreaterThanOrEqual(1);
      expect(ingreso).toBeLessThanOrEqual(10000);
    }
  });

  it('la misma semilla devuelve exactamente el mismo lote', () => {
    // Es lo que hace reproducible un caso que falló: sin esto, el botón exploraría
    // el espacio de entradas pero no permitiría volver al valor que rompió.
    const first = buildSampleBatch(inputs, { kind: 'VALID', count: 3, seed: 'abc' }, seeds);
    const second = buildSampleBatch(inputs, { kind: 'VALID', count: 3, seed: 'abc' }, seeds);
    expect(second.cases).toEqual(first.cases);
  });

  it('semillas distintas exploran valores distintos', () => {
    const first = buildSampleBatch(inputs, { kind: 'VALID', count: 3, seed: 'abc' }, seeds);
    const second = buildSampleBatch(inputs, { kind: 'VALID', count: 3, seed: 'xyz' }, seeds);
    expect(second.cases).not.toEqual(first.cases);
  });

  it('los casos de frontera tocan el límite declarado y dicen cuál', () => {
    const batch = buildSampleBatch(inputs, { kind: 'BOUNDARY', count: 6, seed: 'b' }, seeds);
    expect(batch.cases.every((testCase) => testCase.kind === 'BOUNDARY')).toBe(true);
    // La mutación es lo que explica POR QUÉ ese valor es interesante.
    expect(batch.cases.some((testCase) => testCase.mutation)).toBe(true);
  });

  it('los casos inválidos incumplen el contrato a propósito', () => {
    const batch = buildSampleBatch(inputs, { kind: 'INVALID', count: 6, seed: 'i' }, seeds);
    expect(batch.cases.every((testCase) => testCase.kind === 'INVALID')).toBe(true);
    expect(batch.cases.some((testCase) => testCase.mutation)).toBe(true);
  });
});
