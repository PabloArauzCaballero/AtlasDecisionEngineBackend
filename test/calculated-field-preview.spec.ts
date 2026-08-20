import { ConfigService } from '@nestjs/config';
import { MetricsService } from '../src/common/observability/metrics.service';
import { ScriptNodeRunnerService } from '../src/modules/graph/script-node-runner.service';
import { CalculatedFieldExecutorService } from '../src/modules/calculated-fields/calculated-field-executor.service';
import { CalculatedFieldPreviewService } from '../src/modules/calculated-fields/calculated-field-preview.service';
import { declaredOutcomes } from '../src/modules/calculated-fields/calculated-field-outcomes';
import type { LibraryService } from '../src/modules/libraries/library.service';
import type { CreateCalculatedFieldVersionDto } from '../src/modules/calculated-fields/calculated-field.dto';
import type { ExecutableCalculatedField } from '../src/modules/calculated-fields/calculated-field-runtime';

/**
 * Ensayar un campo calculado ANTES de crearlo (§6.1).
 *
 * Lo que estas pruebas fijan no es que el ensayo funcione, sino que sea el MISMO motor:
 * mismo validador de contrato, mismo ejecutor, mismo generador. Un ensayo más permisivo
 * que el guardado daría luz verde a versiones que después se rechazan, y uno más estricto
 * escondería fórmulas que sí son válidas.
 */
const config = new ConfigService({ SCRIPT_NODES_ENABLED: false });
const executor = new CalculatedFieldExecutorService(
  new ScriptNodeRunnerService(config),
  new MetricsService(),
);
// El borrador no selecciona librerías: sin ids que resolver, el servicio real ni siquiera
// consulta la base. El doble deja la prueba sin Prisma y sigue ejercitando el camino.
const libraries = { resolveForExecution: async () => [] } as unknown as LibraryService;
const preview = new CalculatedFieldPreviewService(libraries, executor);

const TENANT = 1n;

function draft(overrides: Partial<CreateCalculatedFieldVersionDto> = {}) {
  return {
    implementationKind: 'OPERATION',
    inputs: [
      {
        id: 'deuda',
        name: 'Deuda mensual',
        description: '',
        dataType: 'DECIMAL',
        required: true,
        constraints: { min: 0, max: 10_000 },
      },
      {
        id: 'ingreso',
        name: 'Ingreso mensual',
        description: '',
        dataType: 'DECIMAL',
        required: true,
        constraints: { min: 1, max: 50_000 },
      },
    ],
    returns: {
      dataType: 'DECIMAL',
      nullable: false,
      precision: 3,
      nullConditions: [],
      divisionByZero: 'FAIL',
      missingData: 'FAIL',
      outOfRange: 'FAIL',
      errorCode: 'CALCULATION_FAILED',
    },
    operation: { operation: 'DIVIDE', args: [{ input: 'deuda' }, { input: 'ingreso' }] },
    ...overrides,
  } as CreateCalculatedFieldVersionDto;
}

describe('ensayo de un borrador, sin crear nada', () => {
  it('ejecuta la fórmula y devuelve el resultado marcado como no persistido', async () => {
    const result = await preview.tryRun(TENANT, draft(), { deuda: 450, ingreso: 1200 });
    expect(result.value).toBe(0.375);
    expect(result.outcome).toBe('VALID');
    expect(result.persisted).toBe(false);
  });

  it('etiqueta el ensayo con un código fijo y no con el que escriba el autor', async () => {
    // El código es una ETIQUETA de métrica: dejar entrar texto libre abriría su
    // cardinalidad a quien pulse el botón.
    const result = await preview.tryRun(TENANT, draft(), { deuda: 1, ingreso: 2 });
    expect(result.fieldCode).toBe('__preview__');
  });

  it('rechaza un contrato inválido con la MISMA lista que devolvería al guardar', async () => {
    const invalid = draft({
      returns: { ...draft().returns, nullable: false, missingData: 'RETURN_NULL' },
    });
    await expect(preview.tryRun(TENANT, invalid, {})).rejects.toMatchObject({
      code: 'CALCULATED_FIELD_CONTRACT_INVALID',
      details: { issues: [expect.objectContaining({ code: 'NULL_POLICY_ON_NON_NULLABLE' })] },
    });
  });

  it('aplica la política de error declarada en vez de reventar', async () => {
    const tolerant = await preview.tryRun(
      TENANT,
      draft({
        returns: {
          ...draft().returns,
          nullable: true,
          nullConditions: ['ingreso sin informar'],
          missingData: 'RETURN_NULL',
        },
        inputs: [
          { id: 'deuda', name: 'Deuda', description: '', dataType: 'DECIMAL', required: true },
          { id: 'ingreso', name: 'Ingreso', description: '', dataType: 'DECIMAL', required: true },
        ],
      }),
      { deuda: 450 },
    );
    expect(tolerant.outcome).toBe('NULL_BY_POLICY');
    expect(tolerant.value).toBeNull();
  });

  it('corre los casos de prueba que el borrador declara, sin guardarlos', async () => {
    const report = await preview.runTestCases(
      TENANT,
      draft({
        testCases: [
          { name: 'un tercio', inputs: { deuda: 400, ingreso: 1200 }, expected: 0.333 },
          { name: 'mal esperado', inputs: { deuda: 400, ingreso: 1200 }, expected: 9 },
        ],
      }),
    );
    expect(report.total).toBe(2);
    expect(report.passed).toBe(1);
    expect(report.results[1]).toMatchObject({ passed: false, actual: 0.333 });
  });
});

describe('valores de ejemplo del borrador', () => {
  it('genera tantos casos como se piden y los reproduce con la semilla', () => {
    const first = preview.samplesOf(draft().inputs as never, {
      kind: 'BOUNDARY',
      count: 4,
      seed: 'fija',
    });
    const again = preview.samplesOf(draft().inputs as never, {
      kind: 'BOUNDARY',
      count: 4,
      seed: 'fija',
    });
    expect(first.cases).toHaveLength(4);
    expect(first.kind).toBe('BOUNDARY');
    expect(again.cases).toEqual(first.cases);
  });

  it('dice que no hay nada que generar cuando el borrador no declara entradas', () => {
    expect(() => preview.samplesOf([], { kind: 'VALID' })).toThrow(/no declara entradas/);
  });
});

describe('desenlaces declarados por el contrato', () => {
  const executable = (returns: Record<string, unknown>, defaultValue?: unknown) =>
    ({
      fieldCode: 'dti',
      implementationKind: 'OPERATION',
      contract: { inputs: [], returns },
      libraryPackages: [],
      defaultValue,
    }) as unknown as ExecutableCalculatedField;

  it('siempre declara el valor válido, y el fallo cuando alguna política es FAIL', () => {
    const outcomes = declaredOutcomes(
      executable({
        dataType: 'DECIMAL',
        nullable: false,
        nullConditions: [],
        divisionByZero: 'FAIL',
        missingData: 'FAIL',
        outOfRange: 'FAIL',
        errorCode: 'CALCULATION_FAILED',
      }),
    );
    expect(outcomes.map((outcome) => outcome.code)).toEqual(['VALID', 'ERROR:CALCULATION_FAILED']);
  });

  it('marca como inalcanzable el valor por defecto que nadie declaró', () => {
    const outcomes = declaredOutcomes(
      executable({
        dataType: 'DECIMAL',
        nullable: true,
        nullConditions: ['sin ingreso'],
        divisionByZero: 'RETURN_DEFAULT',
        missingData: 'FAIL',
        outOfRange: 'FAIL',
        errorCode: 'CALCULATION_FAILED',
      }),
    );
    const defaulted = outcomes.find((outcome) => outcome.code === 'DEFAULTED');
    // El validador sólo persigue este caso cuando el retorno NO es nulable, así que un
    // contrato como éste se guarda y en ejecución propaga el error: el desenlace que el
    // autor cree haber configurado no existe.
    expect(defaulted?.unreachable).toMatch(/no hay ningún valor por defecto/);
  });
});

describe('cobertura de desenlaces', () => {
  it('ejecuta las tres clases y dice cuáles de los declarados no alcanzó', async () => {
    const executable = await preview.toExecutable(TENANT, draft());
    const report = await preview.coverageOf(executable, { seed: 'cobertura', count: 2 });

    expect(report.total).toBe(6);
    expect(report.seed).toBe('cobertura');
    expect(report.declared.find((entry) => entry.code === 'VALID')?.covered).toBe(true);
    // Los casos inválidos existen justamente para que el rechazo aparezca, y el rechazo
    // de una ENTRADA no es un desenlace del contrato de retorno: va a `undeclared`.
    expect(report.undeclared).toContain('ERROR:CALCULATED_FIELD_INPUT_INVALID');
    expect(report.cases).toHaveLength(6);
  });

  it('es reproducible: la misma semilla da los mismos casos', async () => {
    const executable = await preview.toExecutable(TENANT, draft());
    const first = await preview.coverageOf(executable, { seed: 'repetible', count: 1 });
    const again = await preview.coverageOf(executable, { seed: 'repetible', count: 1 });
    expect(again.cases.map((entry) => entry.input)).toEqual(
      first.cases.map((entry) => entry.input),
    );
  });
});
