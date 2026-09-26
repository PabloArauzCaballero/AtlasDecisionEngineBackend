import { ConfigService } from '@nestjs/config';
import { ExecutionEngineService } from '../src/modules/graph/execution-engine.service';
import { ExpressionEvaluator } from '../src/modules/graph/expression-evaluator';
import { ScriptNodeRunnerService } from '../src/modules/graph/script-node-runner.service';
import { MetricsService } from '../src/common/observability/metrics.service';
import { DomainException } from '../src/common/errors/domain-exception';
import type {
  CompiledDecisionArtifact,
  GraphNodeSnapshot,
  IntermediateVariableSnapshot,
  WorkerServiceInvoker,
  WorkerServiceOutcome,
} from '../src/modules/graph/graph.types';

/**
 * Nodo `WORKER`: llamada a un servicio durante la decisión.
 *
 * El invocador es un doble, y tiene que serlo: lo que se prueba aquí es el contrato entre
 * el motor y quien ejecuta la llamada —cómo se resuelven los argumentos, cómo se proyecta
 * la respuesta y qué pasa cuando falla—, no si un PDF concreto se lee bien. Eso último es
 * trabajo del worker y ya tiene sus propias pruebas.
 */
const config = new ConfigService({ MAX_EXECUTION_STEPS: 32, SCRIPT_NODES_ENABLED: false });
const engine = new ExecutionEngineService(
  new ExpressionEvaluator(),
  config,
  new ScriptNodeRunnerService(config),
  new MetricsService(),
);

const SERVICE_RESULT = {
  totals: { credit: 25_665.64, debit: 4_639.33 },
  balances: { closing: 29_452.01 },
  quality: { overallConfidence: 0.82 },
  transactions: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
  account: { currency: 'BOB' },
};

function invoker(
  behaviour: (() => Promise<WorkerServiceOutcome>) | WorkerServiceOutcome,
): { invoke: jest.Mock } & WorkerServiceInvoker {
  const invoke = jest.fn(() =>
    typeof behaviour === 'function' ? behaviour() : Promise.resolve(behaviour),
  );
  return { invoke } as { invoke: jest.Mock } & WorkerServiceInvoker;
}

const succeeded: WorkerServiceOutcome = {
  status: 'SUCCEEDED',
  result: SERVICE_RESULT,
  warnings: [],
  durationMs: 120,
};

/** Grafo mínimo: START → llamada al servicio → RESULT que publica lo proyectado. */
function buildCompiled(options: {
  onError: 'FAIL' | 'CONTINUE';
  outputs?: Array<Record<string, unknown>>;
}): CompiledDecisionArtifact {
  const outputs = options.outputs ?? [
    { intermediateCode: 'abonos', path: 'result.totals.credit', defaultValue: 0 },
    { intermediateCode: 'movimientos', path: 'result.transactions.length', defaultValue: 0 },
    { intermediateCode: 'estado', path: 'call.status', defaultValue: 'FAILED' },
  ];
  const nodes: GraphNodeSnapshot[] = [
    node('START', 'START'),
    node('LLAMAR', 'WORKER', {
      config: {
        service: 'bank-statement',
        operation: 'normalize',
        arguments: {
          documentBase64: { source: 'VARIABLE', path: 'documento' },
          fileName: { source: 'LITERAL', value: 'extracto.pdf' },
        },
        onError: options.onError,
        outputs,
      },
    }),
    node('PUBLICAR', 'RESULT', {
      terminal: true,
      config: {
        mode: 'MAPPING',
        assignments: [
          { outputCode: 'resultado', source: 'LITERAL', value: 'OK' },
          {
            outputCode: 'abonos_publicados',
            source: 'EXPRESSION',
            expression: { var: 'intermediate.abonos' },
          },
        ],
      },
    }),
  ];
  const intermediates: IntermediateVariableSnapshot[] = outputs.map((output) =>
    declareIntermediate(String(output.intermediateCode), 'LLAMAR'),
  );

  return {
    runtimeSchemaVersion: '1.2',
    compilerVersion: 'test',
    artifact: {
      id: '1',
      tenantId: '1',
      code: 'TEST',
      type: 'CREDIT_POLICY',
      name: 'T',
      riskDomain: 'R',
    },
    version: { id: '1', number: 1, semanticVersion: '1.0.0', status: 'COMPILED' },
    variables: [
      variable('documento', 'STRING', 'INPUT'),
      variable('resultado', 'STRING', 'OUTPUT_PRIMARY'),
      variable('abonos_publicados', 'DECIMAL', 'OUTPUT'),
    ],
    intermediates,
    outputContract: [],
    startNodeKey: 'START',
    nodes: Object.fromEntries(nodes.map((entry) => [entry.key, entry])),
    edgesByNode: {
      START: [edge('E1', 'START', 'LLAMAR')],
      LLAMAR: [edge('E2', 'LLAMAR', 'PUBLICAR')],
      PUBLICAR: [],
    },
    conditions: {},
    actions: {},
    totals: { nodes: nodes.length, edges: 2, terminalPaths: 1 },
  };
}

describe('nodo WORKER: llamada a un servicio desde el grafo', () => {
  it('resuelve los argumentos desde el contexto y proyecta la respuesta a intermedias', async () => {
    const service = invoker(succeeded);
    const result = await engine.execute(
      buildCompiled({ onError: 'FAIL' }),
      { documento: 'JVBERi0x' },
      undefined,
      undefined,
      undefined,
      service,
    );

    expect(service.invoke).toHaveBeenCalledWith({
      service: 'bank-statement',
      operation: 'normalize',
      nodeKey: 'LLAMAR',
      arguments: { documentBase64: 'JVBERi0x', fileName: 'extracto.pdf' },
      timeoutMs: undefined,
    });
    expect(result.status).toBe('SUCCEEDED');
    // El valor del servicio llegó al contrato de salida pasando por una intermedia.
    expect(result.output.abonos_publicados).toBe(25_665.64);
  });

  it('cuenta los elementos de una lista de la respuesta con `.length`', async () => {
    const result = await engine.execute(
      buildCompiled({ onError: 'FAIL' }),
      { documento: 'x' },
      undefined,
      undefined,
      undefined,
      invoker(succeeded),
    );
    const written = result.trace.find((step) => step.nodeKey === 'LLAMAR');
    const movimientos = written?.variableState?.intermediatesAfter.find(
      (entry) => entry.code === 'movimientos',
    );
    expect(movimientos?.value).toBe(3);
  });

  it('deja la llamada en la traza con su duración y las intermedias que escribió', async () => {
    const result = await engine.execute(
      buildCompiled({ onError: 'FAIL' }),
      { documento: 'x' },
      undefined,
      undefined,
      undefined,
      invoker(succeeded),
    );
    expect(result.workerCalls).toEqual([
      {
        nodeKey: 'LLAMAR',
        service: 'bank-statement',
        operation: 'normalize',
        status: 'SUCCEEDED',
        durationMs: 120,
        outputs: ['abonos', 'estado', 'movimientos'],
        warnings: [],
      },
    ]);
  });

  it('con onError FAIL, un fallo del servicio aborta la decisión', async () => {
    const failing = invoker(() =>
      Promise.reject(new DomainException('NOT_A_FINANCIAL_STATEMENT', 'No es un extracto')),
    );
    await expect(
      engine.execute(
        buildCompiled({ onError: 'FAIL' }),
        { documento: 'x' },
        undefined,
        undefined,
        undefined,
        failing,
      ),
    ).rejects.toThrow('No es un extracto');
  });

  it('con onError CONTINUE, un fallo escribe los valores por defecto y sigue', async () => {
    const failing = invoker(() =>
      Promise.reject(new DomainException('NOT_A_FINANCIAL_STATEMENT', 'No es un extracto')),
    );
    const result = await engine.execute(
      buildCompiled({ onError: 'CONTINUE' }),
      { documento: 'x' },
      undefined,
      undefined,
      undefined,
      failing,
    );

    expect(result.status).toBe('SUCCEEDED');
    expect(result.output.abonos_publicados).toBe(0);
    expect(result.workerCalls[0]).toMatchObject({
      status: 'FAILED',
      errorCode: 'NOT_A_FINANCIAL_STATEMENT',
    });
    // `call.status` sigue resolviendo aunque no haya respuesta: es lo que permite que una
    // rama del grafo se desvíe explícitamente por el fallo en vez de adivinarlo.
    const estado = result.trace
      .find((step) => step.nodeKey === 'LLAMAR')
      ?.variableState?.intermediatesAfter.find((entry) => entry.code === 'estado');
    expect(estado?.value).toBe('FAILED');
  });

  it('falla cerrado si la ejecución no recibió invocador de servicios', async () => {
    await expect(
      engine.execute(buildCompiled({ onError: 'CONTINUE' }), { documento: 'x' }),
    ).rejects.toThrow(/WORKER_SERVICE_NOT_CONFIGURED|no recibió un invocador/);
  });

  it('una ruta que no resuelve cae al valor por defecto declarado', async () => {
    const result = await engine.execute(
      buildCompiled({
        onError: 'FAIL',
        outputs: [
          { intermediateCode: 'abonos', path: 'result.totals.inexistente', defaultValue: -1 },
        ],
      }),
      { documento: 'x' },
      undefined,
      undefined,
      undefined,
      invoker(succeeded),
    );
    expect(result.output.abonos_publicados).toBe(-1);
  });

  it('rechaza una configuración sin servicio antes de llamar a nadie', async () => {
    const compiled = buildCompiled({ onError: 'FAIL' });
    compiled.nodes.LLAMAR.config = { operation: 'normalize', outputs: [] };
    const service = invoker(succeeded);
    await expect(
      engine.execute(compiled, { documento: 'x' }, undefined, undefined, undefined, service),
    ).rejects.toThrow(/no declara qué servicio llama/);
    expect(service.invoke).not.toHaveBeenCalled();
  });
});

function node(
  key: string,
  type: GraphNodeSnapshot['type'],
  overrides: Partial<GraphNodeSnapshot> = {},
): GraphNodeSnapshot {
  return {
    key,
    type,
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

function edge(key: string, from: string, to: string) {
  return { key, from, to, type: 'DEFAULT', priority: 1, default: true, conditions: [] };
}

/**
 * Tipo declarado de cada intermedia del fixture. Se declaran de verdad y no todas como
 * JSON: el ámbito de intermedias valida el tipo al escribir, así que un fixture laxo no
 * probaría que la proyección entrega valores del tipo que el contrato promete.
 */
const INTERMEDIATE_TYPES: Record<string, string> = {
  abonos: 'DECIMAL',
  movimientos: 'INTEGER',
  estado: 'STRING',
};

function declareIntermediate(code: string, producerNodeKey: string): IntermediateVariableSnapshot {
  return {
    code,
    name: code,
    description: code,
    dataType: INTERMEDIATE_TYPES[code] ?? 'DECIMAL',
    producerNodeKey,
    consumerNodeKeys: [],
    nullable: true,
    updatePolicy: 'SINGLE_WRITE',
    sensitivityClass: 'INTERNAL',
    tracePolicy: 'FULL',
  };
}

function variable(code: string, dataType: string, usageType: string) {
  return {
    variableVersionId: code,
    usageType,
    code,
    version: 1,
    dataType,
    nullable: false,
    validationRules: [],
    sources: [],
    required: true,
    fallbackPolicy: usageType.startsWith('OUTPUT') ? 'NOT_APPLICABLE' : 'FAIL_CLOSED',
    sensitive: false,
  };
}
