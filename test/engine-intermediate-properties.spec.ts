import { MetricsService } from '../src/common/observability/metrics.service';
import fc from 'fast-check';
import { ConfigService } from '@nestjs/config';
import { ExecutionEngineService } from '../src/modules/graph/execution-engine.service';
import { ExpressionEvaluator } from '../src/modules/graph/expression-evaluator';
import { ScriptNodeRunnerService } from '../src/modules/graph/script-node-runner.service';
import { checkProperties } from '../src/modules/qa-lab/qa-properties';
import type {
  CompiledDecisionArtifact,
  GraphEdgeSnapshot,
  GraphNodeSnapshot,
} from '../src/modules/graph/graph.types';

/**
 * Propiedades del motor sobre un grafo real con variables intermedias (§2, §3, §10.2).
 *
 * Estas son las invariantes que no pueden romperse nunca, para ninguna entrada: una
 * intermedia no sale en la respuesta pública, la salida obligatoria siempre se produce,
 * y la misma entrada da siempre el mismo resultado. Se comprueban con entradas
 * generadas, no con tres ejemplos escogidos a mano.
 */
const config = new ConfigService({ MAX_EXECUTION_STEPS: 64, SCRIPT_NODES_ENABLED: false });
const engine = new ExecutionEngineService(
  new ExpressionEvaluator(),
  config,
  new ScriptNodeRunnerService(config),
  new MetricsService(),
);

function node(key: string, overrides: Partial<GraphNodeSnapshot> = {}): GraphNodeSnapshot {
  return {
    key,
    type: 'CONDITION',
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

function edge(
  key: string,
  from: string,
  to: string,
  conditions: GraphEdgeSnapshot['conditions'] = [],
  isDefault = false,
): GraphEdgeSnapshot {
  return {
    key,
    from,
    to,
    type: 'SEQUENCE',
    priority: conditions.length ? 1 : 9,
    default: isDefault,
    conditions,
  };
}

/** Grafo: START -> CALC_DTI (crea `dti`) -> DECIDIR -> RESULT aprobado/rechazado. */
function compiled(): CompiledDecisionArtifact {
  const nodes = [
    node('START', { type: 'START' }),
    node('CALC_DTI', {
      config: {
        intermediateAssignments: [
          {
            code: 'dti',
            source: 'EXPRESSION',
            expression: {
              op: 'div',
              left: { var: 'deuda_mensual' },
              right: { var: 'ingreso_mensual' },
            },
          },
        ],
      },
    }),
    node('DECIDIR'),
    node('APROBAR', {
      type: 'RESULT',
      terminal: true,
      config: {
        mode: 'MAPPING',
        assignments: [
          { outputCode: 'decision', source: 'LITERAL', value: 'APROBADO' },
          {
            outputCode: 'dti_publicado',
            source: 'EXPRESSION',
            expression: { var: 'intermediate.dti' },
          },
        ],
      },
    }),
    node('RECHAZAR', {
      type: 'RESULT',
      terminal: true,
      config: {
        mode: 'MAPPING',
        assignments: [
          { outputCode: 'decision', source: 'LITERAL', value: 'RECHAZADO' },
          {
            outputCode: 'dti_publicado',
            source: 'EXPRESSION',
            expression: { var: 'intermediate.dti' },
          },
        ],
      },
    }),
  ];
  const edges = [
    edge('E1', 'START', 'CALC_DTI', [], true),
    edge('E2', 'CALC_DTI', 'DECIDIR', [], true),
    edge('E3', 'DECIDIR', 'APROBAR', [{ code: 'DTI_OK', order: 1 }]),
    edge('E4', 'DECIDIR', 'RECHAZAR', [], true),
  ];
  return {
    runtimeSchemaVersion: '1.2',
    compilerVersion: 'test',
    artifact: {
      id: '1',
      tenantId: '1',
      code: 'DTI_TEST',
      type: 'CREDIT_POLICY',
      name: 'DTI',
      riskDomain: 'CREDIT',
    },
    version: { id: '1', number: 1, semanticVersion: '1.0.0', status: 'COMPILED' },
    variables: [
      inputVariable('ingreso_mensual', 'DECIMAL'),
      inputVariable('deuda_mensual', 'DECIMAL'),
      outputVariable('decision', 'STRING', 'OUTPUT_PRIMARY'),
      outputVariable('dti_publicado', 'DECIMAL', 'OUTPUT'),
    ],
    intermediates: [
      {
        code: 'dti',
        name: 'DTI',
        description: 'Relación deuda/ingreso',
        dataType: 'DECIMAL',
        producerNodeKey: 'CALC_DTI',
        consumerNodeKeys: [],
        nullable: false,
        updatePolicy: 'SINGLE_WRITE',
        sensitivityClass: 'INTERNAL',
        tracePolicy: 'FULL',
      },
    ],
    outputContract: [
      {
        code: 'decision',
        name: 'Decisión',
        sourceKind: 'NODE',
        sourceRef: 'APROBAR',
        absenceReasons: [],
        contractVersion: '1',
        sensitivityClass: 'INTERNAL',
        tracePolicy: 'FULL',
      },
      {
        code: 'dti_publicado',
        name: 'DTI publicado',
        sourceKind: 'INTERMEDIATE',
        sourceRef: 'dti',
        absenceReasons: [],
        contractVersion: '1',
        sensitivityClass: 'INTERNAL',
        tracePolicy: 'FULL',
      },
    ],
    startNodeKey: 'START',
    nodes: Object.fromEntries(nodes.map((entry) => [entry.key, entry])),
    edgesByNode: Object.fromEntries(
      nodes.map((entry) => [entry.key, edges.filter((candidate) => candidate.from === entry.key)]),
    ),
    conditions: {
      DTI_OK: {
        code: 'DTI_OK',
        name: 'DTI aceptable',
        expressionType: 'JSON_AST',
        expression: { op: 'lte', left: { var: 'intermediate.dti' }, right: { value: 0.45 } },
        severity: 'BLOCKING',
        reusable: false,
      },
    },
    actions: {},
    totals: { nodes: nodes.length, edges: edges.length, terminalPaths: 2 },
  };
}

function inputVariable(code: string, dataType: string) {
  return {
    variableVersionId: code,
    code,
    usageType: 'INPUT',
    dependencyPath: `input.${code}`,
    version: 1,
    dataType,
    nullable: false,
    validationRules: [],
    sources: [],
    required: true,
    fallbackPolicy: 'FAIL_CLOSED',
    sensitive: false,
  };
}

function outputVariable(code: string, dataType: string, usageType: string) {
  return { ...inputVariable(code, dataType), usageType, dependencyPath: `output.${code}` };
}

const artifact = compiled();

describe('propiedades del motor con variables intermedias', () => {
  it('una intermedia nunca aparece en la salida pública con su propio nombre', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.double({ min: 1, max: 50_000, noNaN: true }),
        fc.double({ min: 0, max: 40_000, noNaN: true }),
        async (ingreso, deuda) => {
          const result = await engine.execute(artifact, {
            ingreso_mensual: ingreso,
            deuda_mensual: deuda,
          });
          return !Object.prototype.hasOwnProperty.call(result.output, 'dti');
        },
      ),
      { numRuns: 150 },
    );
  });

  it('siempre produce todas las salidas obligatorias del contrato', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.double({ min: 1, max: 50_000, noNaN: true }),
        fc.double({ min: 0, max: 40_000, noNaN: true }),
        async (ingreso, deuda) => {
          const result = await engine.execute(artifact, {
            ingreso_mensual: ingreso,
            deuda_mensual: deuda,
          });
          const violations = checkProperties(
            {
              compiled: artifact,
              kind: 'VALID',
              input: { ingreso_mensual: ingreso, deuda_mensual: deuda },
            },
            {
              inputAccepted: true,
              output: result.output,
              status: result.status,
              signature: JSON.stringify(result.output),
            },
          );
          return violations.length === 0;
        },
      ),
      { numRuns: 150 },
    );
  });

  it('la misma entrada produce siempre el mismo resultado', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.double({ min: 1, max: 50_000, noNaN: true }),
        fc.double({ min: 0, max: 40_000, noNaN: true }),
        async (ingreso, deuda) => {
          const input = { ingreso_mensual: ingreso, deuda_mensual: deuda };
          const [first, second] = await Promise.all([
            engine.execute(artifact, { ...input }),
            engine.execute(artifact, { ...input }),
          ]);
          return JSON.stringify(first.output) === JSON.stringify(second.output);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('la rama tomada es coherente con el valor de la intermedia', async () => {
    const aprobado = await engine.execute(artifact, { ingreso_mensual: 1000, deuda_mensual: 400 });
    expect(aprobado.output.decision).toBe('APROBADO');
    expect(aprobado.output.dti_publicado).toBeCloseTo(0.4, 5);

    const rechazado = await engine.execute(artifact, { ingreso_mensual: 1000, deuda_mensual: 900 });
    expect(rechazado.output.decision).toBe('RECHAZADO');
  });

  it('la traza expone el estado de la intermedia nodo a nodo', async () => {
    const result = await engine.execute(artifact, { ingreso_mensual: 1000, deuda_mensual: 400 });
    const calc = result.trace.find((step) => step.nodeKey === 'CALC_DTI');
    const decidir = result.trace.find((step) => step.nodeKey === 'DECIDIR');

    expect(calc?.variableState?.intermediatesBefore[0].state).toBe('NOT_AVAILABLE');
    expect(calc?.variableState?.intermediatesCreated).toEqual(['dti']);
    expect(decidir?.variableState?.intermediatesBefore[0].state).not.toBe('NOT_AVAILABLE');
    // El nodo que evalúa la condición de arista queda registrado como consumidor.
    expect(decidir?.variableState?.intermediatesAfter[0].consumedByNodeKeys).toContain('DECIDIR');
  });

  it('la traza dice en qué paso se creó la intermedia (§3.1)', async () => {
    const result = await engine.execute(artifact, { ingreso_mensual: 1000, deuda_mensual: 400 });
    const calcIndex = result.trace.findIndex((step) => step.nodeKey === 'CALC_DTI');
    const terminal = result.trace[result.trace.length - 1];
    const dti = terminal.variableState?.intermediatesAfter.find((entry) => entry.code === 'dti');

    // El índice tiene que ser el del paso de la MISMA traza, no un contador interno del
    // ámbito: es lo que permite saltar del valor al nodo que lo produjo.
    expect(calcIndex).toBeGreaterThanOrEqual(0);
    expect(dti?.createdAtStepIndex).toBe(calcIndex);
    expect(result.trace[calcIndex].nodeKey).toBe('CALC_DTI');
  });

  it('el estado por nodo separa entradas recibidas de salidas publicadas', async () => {
    const result = await engine.execute(artifact, { ingreso_mensual: 1000, deuda_mensual: 400 });
    const terminal = result.trace[result.trace.length - 1];
    expect(terminal.variableState?.inputs.map((entry) => entry.code).sort()).toEqual([
      'deuda_mensual',
      'ingreso_mensual',
    ]);
    expect(terminal.variableState?.outputs.map((entry) => entry.code).sort()).toEqual([
      'decision',
      'dti_publicado',
    ]);
    expect(terminal.variableState?.outputs.every((entry) => entry.state === 'COMPUTED')).toBe(true);
  });

  it('el ámbito de intermedias no sobrevive entre ejecuciones', async () => {
    const first = await engine.execute(artifact, { ingreso_mensual: 1000, deuda_mensual: 400 });
    const second = await engine.execute(artifact, { ingreso_mensual: 2000, deuda_mensual: 200 });
    const firstStart = first.trace[0].variableState?.intermediatesBefore[0];
    const secondStart = second.trace[0].variableState?.intermediatesBefore[0];
    // Si el ámbito se compartiera, la segunda ejecución arrancaría con el valor de la
    // primera y `SINGLE_WRITE` habría reventado al escribir de nuevo.
    expect(firstStart?.state).toBe('NOT_AVAILABLE');
    expect(secondStart?.state).toBe('NOT_AVAILABLE');
    expect(second.output.dti_publicado).toBeCloseTo(0.1, 5);
  });
});
