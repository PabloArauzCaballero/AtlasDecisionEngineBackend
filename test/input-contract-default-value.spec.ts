/**
 * "Sin valor por defecto" no es "valor por defecto nulo".
 *
 * Una columna JSON vacía vuelve de Prisma como `null`. El lector del grafo lo pasaba tal
 * cual al contrato de entrada, así que el validador leía «no se declaró defecto» como
 * «se declaró el defecto nulo» y rechazaba con `INPUT_NULL_DEFAULT_ON_NON_NULLABLE`
 * cualquier variable no anulable sin defecto — es decir, casi todo el catálogo sembrado.
 * El efecto era que ningún grafo podía declarar como entrada una variable del catálogo.
 *
 * Lo detectó el smoke integral al validar su primer grafo contra la variable `age`.
 */
import { validateInputContract } from '../src/modules/graph/validators/graph-input-contract.validator';

/** Instantánea mínima: al validador de entradas sólo le interesa `variables`. */
function snapshotWith(overrides: Record<string, unknown>) {
  return {
    variables: [
      {
        code: 'age',
        usageType: 'INPUT',
        dataType: 'INTEGER',
        nullable: false,
        constraints: { minimum: 0, maximum: 120 },
        ...overrides,
      },
    ],
  } as never;
}

describe('contrato de entrada · valor por defecto', () => {
  it('acepta una entrada no anulable que no declara defecto', () => {
    const report = validateInputContract(snapshotWith({ defaultValue: undefined }));

    expect(report.errors.map((issue) => issue.code)).not.toContain(
      'INPUT_NULL_DEFAULT_ON_NON_NULLABLE',
    );
  });

  it('sigue rechazando un defecto explícitamente nulo sobre una entrada no anulable', () => {
    const report = validateInputContract(snapshotWith({ defaultValue: null }));

    expect(report.errors.map((issue) => issue.code)).toContain(
      'INPUT_NULL_DEFAULT_ON_NON_NULLABLE',
    );
  });

  it('rechaza un defecto que incumple las restricciones declaradas', () => {
    const report = validateInputContract(snapshotWith({ defaultValue: 999 }));

    expect(report.errors.map((issue) => issue.code)).toContain('INPUT_DEFAULT_VALUE_INVALID');
  });

  it('acepta un defecto que sí cumple el contrato', () => {
    const report = validateInputContract(snapshotWith({ defaultValue: 30 }));

    expect(report.errors).toHaveLength(0);
  });
});
