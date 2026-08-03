import { validateInputContract } from '../src/modules/graph/validators/graph-input-contract.validator';
import type {
  ArtifactGraphSnapshot,
  VariableContractSnapshot,
} from '../src/modules/graph/graph.types';

/**
 * Coherencia del contrato de ENTRADA antes de publicar (§1.2).
 *
 * El motor ya rechaza en ejecución un valor que incumple las restricciones; lo que
 * se prueba aquí es lo que sólo se puede saber ANTES de tener datos: que el
 * contrato declarado admita algún valor y que sus propios ejemplos lo cumplan.
 */
function input(overrides: Partial<VariableContractSnapshot> = {}): VariableContractSnapshot {
  return {
    variableVersionId: '1',
    usageType: 'INPUT',
    code: 'ingreso_mensual',
    version: 1,
    dataType: 'DECIMAL',
    nullable: false,
    required: true,
    fallbackPolicy: 'FAIL_CLOSED',
    sensitive: false,
    validationRules: [],
    sources: [],
    ...overrides,
  };
}

function snapshot(variables: VariableContractSnapshot[]): ArtifactGraphSnapshot {
  return {
    artifact: {
      id: '1',
      tenantId: '1',
      code: 'A',
      type: 'CREDIT_POLICY',
      name: 'A',
      riskDomain: 'CREDIT',
    },
    version: { id: '1', number: 1, semanticVersion: '1.0.0', status: 'DRAFT' },
    variables,
    intermediates: [],
    outputContract: [],
    conditions: [],
    actions: [],
    nodes: [],
    edges: [],
  };
}

const codes = (issues: Array<{ code: string }>) => issues.map((entry) => entry.code);

describe('validación del contrato de entrada', () => {
  it('acepta una entrada cuyas restricciones y ejemplos son coherentes', () => {
    const report = validateInputContract(
      snapshot([
        input({
          constraints: { min: 0, max: 100000 },
          exampleValid: 2500,
          exampleInvalid: -1,
        }),
      ]),
    );
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
  });

  it('rechaza restricciones imposibles: ningún valor podría cumplirlas', () => {
    const report = validateInputContract(
      snapshot([input({ constraints: { min: 1000, max: 10 } })]),
    );
    expect(codes(report.errors)).toContain('INPUT_RANGE_INVERTED');
  });

  it('rechaza un valor por defecto que incumple el propio contrato', () => {
    // Es el caso peligroso: la política de respaldo inyectaría ese valor en una
    // decisión real cuando el dato no llegue.
    const report = validateInputContract(
      snapshot([input({ constraints: { min: 0 }, defaultValue: -50 })]),
    );
    expect(codes(report.errors)).toContain('INPUT_DEFAULT_VALUE_INVALID');
  });

  it('rechaza un defecto nulo en una entrada que no admite nulos', () => {
    const report = validateInputContract(
      snapshot([input({ nullable: false, defaultValue: null })]),
    );
    expect(codes(report.errors)).toContain('INPUT_NULL_DEFAULT_ON_NON_NULLABLE');
  });

  it('rechaza un tipo que no está en el catálogo canónico', () => {
    const report = validateInputContract(snapshot([input({ dataType: 'NUMERO_RARO' })]));
    expect(codes(report.errors)).toContain('INPUT_DATA_TYPE_UNKNOWN');
  });

  it('avisa cuando el ejemplo válido no pasa su propio contrato', () => {
    const report = validateInputContract(
      snapshot([input({ constraints: { min: 100 }, exampleValid: 5 })]),
    );
    expect(codes(report.warnings)).toContain('INPUT_EXAMPLE_VALID_REJECTED');
    expect(report.errors).toEqual([]);
  });

  it('avisa cuando el ejemplo inválido resulta aceptado: no demuestra nada', () => {
    const report = validateInputContract(
      snapshot([input({ constraints: { min: 0 }, exampleInvalid: 10 })]),
    );
    expect(codes(report.warnings)).toContain('INPUT_EXAMPLE_INVALID_ACCEPTED');
  });

  it('avisa de una restricción que el tipo ignora en silencio', () => {
    // `minLength` sobre un DECIMAL no lo comprueba nadie: prometía un control
    // inexistente.
    const report = validateInputContract(
      snapshot([input({ dataType: 'DECIMAL', constraints: { minLength: 3 } })]),
    );
    expect(codes(report.warnings)).toContain('INPUT_CONSTRAINT_NOT_APPLICABLE');
  });

  it('no revisa las salidas: tienen su propio validador de contrato', () => {
    const report = validateInputContract(
      snapshot([
        input({ usageType: 'OUTPUT_PRIMARY', code: 'decision', constraints: { min: 100, max: 1 } }),
      ]),
    );
    expect(report.errors).toEqual([]);
  });
});
