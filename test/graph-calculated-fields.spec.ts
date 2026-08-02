import { ConfigService } from '@nestjs/config';
import { ExecutionEngineService } from '../src/modules/graph/execution-engine.service';
import { ExpressionEvaluator } from '../src/modules/graph/expression-evaluator';
import { ScriptNodeRunnerService } from '../src/modules/graph/script-node-runner.service';
import { MetricsService } from '../src/common/observability/metrics.service';
import { buildGraphLookups } from '../src/modules/graph/validators/graph-lookups';
import { validateGraphCalculatedFields } from '../src/modules/graph/validators/graph-calculated-field.validator';
import type {
  ArtifactGraphSnapshot,
  CalculatedFieldCallSnapshot,
  CompiledDecisionArtifact,
  GraphNodeSnapshot,
} from '../src/modules/graph/graph.types';

/**
 * Un campo calculado solo cumple su propósito —«ser utilizado por más de un artefacto sin
 * duplicar la lógica», §5.1— si un grafo puede invocarlo de verdad. Estas pruebas cubren
 * ese camino completo: validación del enlace, ejecución dentro del motor y traza.
 */
const config = new ConfigService({ MAX_EXECUTION_STEPS: 32, SCRIPT_NODES_ENABLED: false });
const engine = new ExecutionEngineService(
  new ExpressionEvaluator(),
  config,
  new ScriptNodeRunnerService(config),
  new MetricsService(),
);

/** Campo calculado visual: deuda / ingreso, redondeado a 4 decimales. */
function dtiCall(
  overrides: Partial<CalculatedFieldCallSnapshot> = {},
): CalculatedFieldCallSnapshot {
  return {
    callKey: 'calcularDti',
    fieldCode: 'debt_to_income',
    calculatedFieldVersionId: '900',
    versionNumber: 1,
    inputMapping: {
      deuda_mensual: { source: 'VARIABLE', path: 'deuda_mensual' },
      ingreso_mensual: { source: 'VARIABLE', path: 'ingreso_mensual' },
    },
    target: { kind: 'INTERMEDIATE', code: 'dti' },
    definition: {
      implementationKind: 'OPERATION',
      contract: {
        inputs: [
          {
            id: 'deuda_mensual',
            name: 'Deuda',
            description: '',
            dataType: 'DECIMAL',
            required: true,
            constraints: { min: 0 },
          },
          {
            id: 'ingreso_mensual',
            name: 'Ingreso',
            description: '',
            dataType: 'DECIMAL',
            required: true,
            constraints: { exclusiveMin: 0 },
          },
        ],
        returns: {
          dataType: 'DECIMAL',
          nullable: false,
          precision: 4,
          nullConditions: [],
          divisionByZero: 'FAIL',
          missingData: 'FAIL',
          outOfRange: 'FAIL',
          errorCode: 'DTI_NOT_COMPUTABLE',
        },
      },
      operation: {
        operation: 'DIVIDE',
        args: [{ input: 'deuda_mensual' }, { input: 'ingreso_mensual' }],
      },
      libraryPackages: [],
    },
    ...overrides,
  };
}

function node(key: string, overrides: Partial<GraphNodeSnapshot> = {}): GraphNodeSnapshot {
  return {
    key,
    type: 'EXPRESSION',
    label: key,
    config: {},
    x: 0,
    y: 0,
    order: 0,
    terminal: false,
    conditions: [],
    actions: [],
    ...overrides,
  };
}

const variable = (code: string, usageType: string, dataType = 'DECIMAL') => ({
  variableVersionId: code,
  code,
  usageType,
  dependencyPath: `${usageType === 'INPUT' ? 'input' : 'output'}.${code}`,
  version: 1,
  dataType,
  nullable: false,
  validationRules: [],
  sources: [],
  required: true,
  fallbackPolicy: usageType === 'INPUT' ? 'FAIL_CLOSED' : 'NOT_APPLICABLE',
  sensitive: false,
});

const intermediate = (code: string, producerNodeKey: string, dataType = 'DECIMAL') => ({
  code,
  name: code,
  description: 'x',
  dataType,
  producerNodeKey,
  consumerNodeKeys: [] as string[],
  nullable: false,
  updatePolicy: 'SINGLE_WRITE' as const,
  sensitivityClass: 'INTERNAL',
  tracePolicy: 'FULL' as const,
});

function snapshot(call: CalculatedFieldCallSnapshot): ArtifactGraphSnapshot {
  return {
    artifact: {
      id: '1',
      tenantId: '1',
      code: 'CF_TEST',
      type: 'CREDIT_POLICY',
      name: 'CF',
      riskDomain: 'CREDIT',
    },
    version: { id: '1', number: 1, semanticVersion: '1.0.0', status: 'DRAFT' },
    variables: [
      variable('deuda_mensual', 'INPUT'),
      variable('ingreso_mensual', 'INPUT'),
      variable('dti_publicado', 'OUTPUT_PRIMARY'),
    ],
    intermediates: [intermediate('dti', 'CALCULAR')],
    outputContract: [],
    conditions: [],
    actions: [],
    nodes: [
      node('START', { type: 'START' }),
      node('CALCULAR', { calculatedFieldCalls: [call] }),
      node('FIN', {
        type: 'RESULT',
        terminal: true,
        config: {
          mode: 'MAPPING',
          assignments: [
            {
              outputCode: 'dti_publicado',
              source: 'EXPRESSION',
              expression: { var: 'intermediate.dti' },
            },
          ],
        },
      }),
    ],
    edges: [
      {
        key: 'E1',
        from: 'START',
        to: 'CALCULAR',
        type: 'SEQUENCE',
        priority: 1,
        default: true,
        conditions: [],
      },
      {
        key: 'E2',
        from: 'CALCULAR',
        to: 'FIN',
        type: 'SEQUENCE',
        priority: 1,
        default: true,
        conditions: [],
      },
    ],
  };
}

function compile(graph: ArtifactGraphSnapshot): CompiledDecisionArtifact {
  return {
    runtimeSchemaVersion: '1.2',
    compilerVersion: 'test',
    artifact: graph.artifact,
    version: graph.version,
    variables: graph.variables,
    intermediates: graph.intermediates,
    outputContract: graph.outputContract,
    startNodeKey: 'START',
    nodes: Object.fromEntries(graph.nodes.map((entry) => [entry.key, entry])),
    edgesByNode: Object.fromEntries(
      graph.nodes.map((entry) => [
        entry.key,
        graph.edges.filter((edge) => edge.from === entry.key),
      ]),
    ),
    conditions: {},
    actions: {},
    totals: { nodes: graph.nodes.length, edges: graph.edges.length, terminalPaths: 1 },
  };
}

const validate = (graph: ArtifactGraphSnapshot) =>
  validateGraphCalculatedFields(graph, buildGraphLookups(graph)).errors.map((entry) => entry.code);

describe('validación del enlace grafo → campo calculado', () => {
  it('acepta una llamada bien formada', () => {
    expect(validate(snapshot(dtiCall()))).toEqual([]);
  });

  it('rechaza no fijar la versión del campo calculado', () => {
    expect(validate(snapshot(dtiCall({ calculatedFieldVersionId: '' })))).toContain(
      'CALCULATED_FIELD_VERSION_UNPINNED',
    );
  });

  it('rechaza dejar sin alimentar una entrada obligatoria', () => {
    const call = dtiCall({
      inputMapping: { deuda_mensual: { source: 'VARIABLE', path: 'deuda_mensual' } },
    });
    expect(validate(snapshot(call))).toContain('CALCULATED_FIELD_INPUT_UNMAPPED');
  });

  it('rechaza alimentar desde una variable que el grafo no declara', () => {
    const call = dtiCall({
      inputMapping: {
        deuda_mensual: { source: 'VARIABLE', path: 'fantasma' },
        ingreso_mensual: { source: 'VARIABLE', path: 'ingreso_mensual' },
      },
    });
    expect(validate(snapshot(call))).toContain('CALCULATED_FIELD_INPUT_SOURCE_MISSING');
  });

  it('rechaza mapear una entrada que el campo no declara', () => {
    const call = dtiCall({
      inputMapping: {
        ...dtiCall().inputMapping,
        inventada: { source: 'LITERAL', value: 1 },
      },
    });
    expect(validate(snapshot(call))).toContain('CALCULATED_FIELD_INPUT_UNKNOWN');
  });

  it('rechaza guardar en una intermedia no declarada', () => {
    const call = dtiCall({ target: { kind: 'INTERMEDIATE', code: 'inexistente' } });
    expect(validate(snapshot(call))).toContain('CALCULATED_FIELD_TARGET_MISSING');
  });

  it('rechaza que un nodo escriba una intermedia de la que no es productor', () => {
    const graph = snapshot(dtiCall());
    graph.intermediates = [intermediate('dti', 'OTRO_NODO')];
    expect(validate(graph)).toContain('INTERMEDIATE_WRITE_UNAUTHORIZED');
  });

  it('rechaza un tipo de retorno que no cabe en el destino', () => {
    const graph = snapshot(dtiCall());
    graph.intermediates = [intermediate('dti', 'CALCULAR', 'BOOLEAN')];
    expect(validate(graph)).toContain('CALCULATED_FIELD_RETURN_TYPE_MISMATCH');
  });

  it('rechaza dos llamadas con la misma clave en el mismo nodo', () => {
    const graph = snapshot(dtiCall());
    graph.nodes[1].calculatedFieldCalls = [dtiCall(), dtiCall()];
    expect(validate(graph)).toContain('CALCULATED_FIELD_CALL_DUPLICATE');
  });

  it('rechaza una llamada sin definición embebida', () => {
    const call = dtiCall();
    // @ts-expect-error se prueba el caso degradado a propósito
    call.definition = {};
    expect(validate(snapshot(call))).toContain('CALCULATED_FIELD_DEFINITION_MISSING');
  });
});

describe('ejecución de un campo calculado dentro del grafo', () => {
  it('calcula, guarda en la intermedia y la publica por el contrato de salida', async () => {
    const result = await engine.execute(compile(snapshot(dtiCall())), {
      deuda_mensual: 450,
      ingreso_mensual: 1200,
    });
    expect(result.output.dti_publicado).toBeCloseTo(0.375, 6);
    // La intermedia no se filtra a la respuesta pública.
    expect(result.output.dti).toBeUndefined();
  });

  it('deja la invocación en la traza con versión, destino y duración (§12)', async () => {
    const result = await engine.execute(compile(snapshot(dtiCall())), {
      deuda_mensual: 450,
      ingreso_mensual: 1200,
    });
    expect(result.calculatedFieldCalls).toHaveLength(1);
    expect(result.calculatedFieldCalls[0]).toMatchObject({
      nodeKey: 'CALCULAR',
      callKey: 'calcularDti',
      fieldCode: 'debt_to_income',
      versionNumber: 1,
      target: 'intermediate.dti',
      outcome: 'VALID',
    });
    expect(result.calculatedFieldCalls[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it('el estado por nodo muestra la intermedia creada por el campo calculado', async () => {
    const result = await engine.execute(compile(snapshot(dtiCall())), {
      deuda_mensual: 450,
      ingreso_mensual: 1200,
    });
    const step = result.trace.find((entry) => entry.nodeKey === 'CALCULAR');
    expect(step?.variableState?.intermediatesCreated).toEqual(['dti']);
    expect(step?.evaluation.calculatedFields).toEqual(['debt_to_income']);
  });

  it('una entrada que incumple el contrato del campo aborta la decisión', async () => {
    await expect(
      engine.execute(compile(snapshot(dtiCall())), {
        deuda_mensual: -5,
        ingreso_mensual: 1200,
      }),
    ).rejects.toThrow(/is below minimum/);
  });

  it('la división por cero se propaga como fallo controlado del campo', async () => {
    await expect(
      engine.execute(compile(snapshot(dtiCall())), {
        deuda_mensual: 450,
        ingreso_mensual: 0,
      }),
    ).rejects.toThrow(/is below minimum|greater than|División entre cero/);
  });

  it('puede escribir directamente una salida del artefacto', async () => {
    const graph = snapshot(dtiCall({ target: { kind: 'OUTPUT', code: 'dti_publicado' } }));
    // Sin intermedia de por medio: el nodo terminal ya no la necesita.
    graph.intermediates = [];
    graph.nodes[2].config = { mode: 'MAPPING', assignments: [] };
    const result = await engine.execute(compile(graph), {
      deuda_mensual: 300,
      ingreso_mensual: 1200,
    });
    expect(result.output.dti_publicado).toBeCloseTo(0.25, 6);
  });

  it('el mismo campo alimentado desde una intermedia previa también funciona', async () => {
    const graph = snapshot(
      dtiCall({
        inputMapping: {
          deuda_mensual: { source: 'INTERMEDIATE', path: 'deuda_normalizada' },
          ingreso_mensual: { source: 'VARIABLE', path: 'ingreso_mensual' },
        },
      }),
    );
    graph.intermediates = [
      intermediate('deuda_normalizada', 'START'),
      intermediate('dti', 'CALCULAR'),
    ];
    graph.nodes[0].config = {
      intermediateAssignments: [
        { code: 'deuda_normalizada', source: 'EXPRESSION', expression: { var: 'deuda_mensual' } },
      ],
    };
    expect(validate(graph)).toEqual([]);

    const result = await engine.execute(compile(graph), {
      deuda_mensual: 600,
      ingreso_mensual: 1200,
    });
    expect(result.output.dti_publicado).toBeCloseTo(0.5, 6);
  });
});
