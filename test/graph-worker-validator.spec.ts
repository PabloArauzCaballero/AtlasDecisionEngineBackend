import { ConfigService } from '@nestjs/config';
import { HashService } from '../src/common/crypto/hash.service';
import { ExpressionEvaluator } from '../src/modules/graph/expression-evaluator';
import { GraphValidatorService } from '../src/modules/graph/graph-validator.service';
import { buildGraphLookups } from '../src/modules/graph/validators/graph-lookups';
import { validateGraphWorkerCalls } from '../src/modules/graph/validators/graph-worker.validator';
import type {
  ArtifactGraphSnapshot,
  GraphNodeSnapshot,
  IntermediateVariableSnapshot,
} from '../src/modules/graph/graph.types';

/**
 * Reglas estáticas del nodo que llama a un servicio.
 *
 * Todo lo que se comprueba aquí es lo que NO puede descubrirse en ejecución sin haber
 * abortado antes una decisión: un servicio que no existe, una proyección a una variable no
 * declarada, o un nodo que promete continuar ante un fallo sin decir con qué valores.
 */
const config = new ConfigService({ AUDIT_HASH_SECRET: 'test-secret-with-at-least-24-characters' });
const validator = new GraphValidatorService(new ExpressionEvaluator(), new HashService(config));

function snapshot(overrides: {
  nodeConfig: Record<string, unknown>;
  intermediates?: IntermediateVariableSnapshot[];
  terminal?: boolean;
  withExit?: boolean;
}): ArtifactGraphSnapshot {
  const nodes: GraphNodeSnapshot[] = [
    node('START', 'START'),
    node('LLAMAR', 'WORKER', {
      config: overrides.nodeConfig,
      terminal: overrides.terminal ?? false,
    }),
    node('FIN', 'END', { terminal: true, config: { outcome: 'OK' } }),
  ];
  return {
    artifact: {
      id: '1',
      tenantId: '1',
      code: 'T',
      type: 'CREDIT_POLICY',
      name: 'T',
      riskDomain: 'R',
    },
    version: { id: '1', number: 1, semanticVersion: '1.0.0', status: 'DRAFT' },
    variables: [
      {
        variableVersionId: 'documento',
        usageType: 'INPUT',
        code: 'documento',
        version: 1,
        dataType: 'STRING',
        nullable: false,
        validationRules: [],
        sources: [],
        required: true,
        fallbackPolicy: 'FAIL_CLOSED',
        sensitive: false,
      },
    ],
    intermediates: overrides.intermediates ?? [declared('abonos', 'LLAMAR')],
    outputContract: [],
    conditions: [],
    actions: [],
    nodes,
    edges: [
      {
        key: 'E1',
        from: 'START',
        to: 'LLAMAR',
        type: 'DEFAULT',
        priority: 1,
        default: true,
        conditions: [],
      },
      ...(overrides.withExit === false
        ? []
        : [
            {
              key: 'E2',
              from: 'LLAMAR',
              to: 'FIN',
              type: 'DEFAULT',
              priority: 1,
              default: true,
              conditions: [],
            },
          ]),
    ],
  };
}

const VALID_CONFIG = {
  service: 'bank-statement',
  operation: 'normalize',
  arguments: { documentBase64: { source: 'VARIABLE', path: 'documento' } },
  onError: 'FAIL',
  outputs: [{ intermediateCode: 'abonos', path: 'result.totals.credit' }],
};

function codes(graph: ArtifactGraphSnapshot): string[] {
  const result = validateGraphWorkerCalls(graph, buildGraphLookups(graph));
  return [...result.errors, ...result.warnings].map((issue) => issue.code);
}

describe('validación estática del nodo WORKER', () => {
  it('acepta una llamada bien declarada', () => {
    expect(codes(snapshot({ nodeConfig: VALID_CONFIG }))).toEqual([]);
  });

  it('rechaza un servicio que no existe en el catálogo', () => {
    expect(codes(snapshot({ nodeConfig: { ...VALID_CONFIG, service: 'no-existe' } }))).toContain(
      'WORKER_SERVICE_UNKNOWN',
    );
  });

  it('rechaza una operación que el servicio no ofrece', () => {
    expect(codes(snapshot({ nodeConfig: { ...VALID_CONFIG, operation: 'inventada' } }))).toContain(
      'WORKER_OPERATION_UNKNOWN',
    );
  });

  it('rechaza una llamada que no guarda nada de la respuesta', () => {
    expect(codes(snapshot({ nodeConfig: { ...VALID_CONFIG, outputs: [] } }))).toContain(
      'WORKER_OUTPUTS_EMPTY',
    );
  });

  it('rechaza una proyección sobre una intermedia no declarada', () => {
    expect(
      codes(
        snapshot({
          nodeConfig: {
            ...VALID_CONFIG,
            outputs: [{ intermediateCode: 'inexistente', path: 'result.totals.credit' }],
          },
        }),
      ),
    ).toContain('WORKER_OUTPUT_INTERMEDIATE_UNKNOWN');
  });

  it('rechaza una proyección sobre una intermedia de otro productor', () => {
    expect(
      codes(
        snapshot({
          nodeConfig: VALID_CONFIG,
          intermediates: [declared('abonos', 'OTRO_NODO')],
        }),
      ),
    ).toContain('WORKER_OUTPUT_PRODUCER_MISMATCH');
  });

  it('rechaza una ruta que no cuelga de result. ni de call.', () => {
    expect(
      codes(
        snapshot({
          nodeConfig: {
            ...VALID_CONFIG,
            outputs: [{ intermediateCode: 'abonos', path: 'totals.credit' }],
          },
        }),
      ),
    ).toContain('WORKER_OUTPUT_PATH_ROOT_INVALID');
  });

  it('exige valor por defecto en cada proyección cuando el nodo continúa ante un fallo', () => {
    expect(codes(snapshot({ nodeConfig: { ...VALID_CONFIG, onError: 'CONTINUE' } }))).toContain(
      'WORKER_OUTPUT_DEFAULT_REQUIRED',
    );
  });

  it('avisa —sin bloquear— cuando el nodo continúa ante un fallo del servicio', () => {
    const graph = snapshot({
      nodeConfig: {
        ...VALID_CONFIG,
        onError: 'CONTINUE',
        outputs: [{ intermediateCode: 'abonos', path: 'result.totals.credit', defaultValue: 0 }],
      },
    });
    const result = validateGraphWorkerCalls(graph, buildGraphLookups(graph));
    expect(result.errors).toEqual([]);
    expect(result.warnings.map((issue) => issue.code)).toEqual(['WORKER_CALL_CONTINUES_ON_ERROR']);
  });

  it('rechaza un argumento alimentado por una variable que el artefacto no declara', () => {
    expect(
      codes(
        snapshot({
          nodeConfig: {
            ...VALID_CONFIG,
            arguments: { documentBase64: { source: 'VARIABLE', path: 'no_declarada' } },
          },
        }),
      ),
    ).toContain('WORKER_ARGUMENT_VARIABLE_UNKNOWN');
  });

  it('rechaza un nodo de servicio terminal o sin salida', () => {
    expect(codes(snapshot({ nodeConfig: VALID_CONFIG, terminal: true }))).toContain(
      'WORKER_NODE_TERMINAL',
    );
    expect(codes(snapshot({ nodeConfig: VALID_CONFIG, withExit: false }))).toContain(
      'WORKER_NODE_WITHOUT_EXIT',
    );
  });

  it('el validador completo cuenta la proyección como escritura de la intermedia', () => {
    // Sin esto, la intermedia parecería no escrita por nadie y saltaría
    // INTERMEDIATE_NEVER_WRITTEN aunque la llame un servicio.
    const report = validator.validate(snapshot({ nodeConfig: VALID_CONFIG }));
    expect(report.errors.map((issue) => issue.code)).not.toContain('INTERMEDIATE_NEVER_WRITTEN');
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

function declared(code: string, producerNodeKey: string): IntermediateVariableSnapshot {
  return {
    code,
    name: code,
    description: code,
    dataType: 'DECIMAL',
    producerNodeKey,
    consumerNodeKeys: [],
    nullable: false,
    updatePolicy: 'SINGLE_WRITE',
    sensitivityClass: 'INTERNAL',
    tracePolicy: 'FULL',
  };
}
