import { buildGraphLookups } from '../src/modules/graph/validators/graph-lookups';
import { validateGraphIntermediates } from '../src/modules/graph/validators/graph-intermediate.validator';
import { validateOutputContract } from '../src/modules/graph/validators/graph-output-contract.validator';
import type {
  ArtifactGraphSnapshot,
  GraphEdgeSnapshot,
  GraphNodeSnapshot,
  IntermediateVariableSnapshot,
  OutputContractFieldSnapshot,
} from '../src/modules/graph/graph.types';

/**
 * Validación estática de §2.3 y §4. La regla más delicada es la de disponibilidad:
 * tiene que exigir que el nodo productor DOMINE al lector (esté en todos los caminos),
 * no que exista algún camino que pase por él.
 */
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

function edge(from: string, to: string): GraphEdgeSnapshot {
  return {
    key: `${from}_${to}`,
    from,
    to,
    type: 'SEQUENCE',
    priority: 1,
    default: true,
    conditions: [],
  };
}

function intermediate(
  overrides: Partial<IntermediateVariableSnapshot> = {},
): IntermediateVariableSnapshot {
  return {
    code: 'dti',
    name: 'DTI',
    description: 'Relación deuda/ingreso',
    dataType: 'DECIMAL',
    producerNodeKey: 'CALC',
    consumerNodeKeys: [],
    nullable: false,
    updatePolicy: 'SINGLE_WRITE',
    sensitivityClass: 'INTERNAL',
    tracePolicy: 'FULL',
    ...overrides,
  };
}

function snapshot(overrides: Partial<ArtifactGraphSnapshot> = {}): ArtifactGraphSnapshot {
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
    variables: [],
    intermediates: [],
    outputContract: [],
    conditions: [],
    actions: [],
    nodes: [],
    edges: [],
    ...overrides,
  };
}

const validate = (input: ArtifactGraphSnapshot) =>
  validateGraphIntermediates(input, buildGraphLookups(input));
const codes = (issues: Array<{ code: string }>) => issues.map((entry) => entry.code);

describe('validación de variables intermedias', () => {
  it('acepta un grafo lineal en el que el productor precede al lector', () => {
    const graph = snapshot({
      intermediates: [intermediate()],
      nodes: [
        node('START', { type: 'START' }),
        node('CALC', {
          config: { intermediateAssignments: [{ code: 'dti', source: 'LITERAL', value: 1 }] },
        }),
        node('USA', { config: { note: 'intermediate.dti' } }),
        node('FIN', { type: 'END', terminal: true }),
      ],
      edges: [edge('START', 'CALC'), edge('CALC', 'USA'), edge('USA', 'FIN')],
    });
    expect(validate(graph).errors).toEqual([]);
  });

  it('rechaza la lectura por una rama en la que el productor no se ejecutó', () => {
    // START se bifurca: solo una rama pasa por CALC, pero ambas confluyen en USA.
    const graph = snapshot({
      intermediates: [intermediate()],
      nodes: [
        node('START', { type: 'START' }),
        node('CALC', {
          config: { intermediateAssignments: [{ code: 'dti', source: 'LITERAL', value: 1 }] },
        }),
        node('OTRA', {}),
        node('USA', { config: { note: 'intermediate.dti' } }),
      ],
      edges: [
        edge('START', 'CALC'),
        edge('START', 'OTRA'),
        edge('CALC', 'USA'),
        edge('OTRA', 'USA'),
      ],
    });
    expect(codes(validate(graph).errors)).toContain('INTERMEDIATE_READ_BEFORE_WRITE');
  });

  it('acepta esa misma bifurcación si la variable tiene valor inicial', () => {
    const graph = snapshot({
      intermediates: [intermediate({ initialValue: 0 })],
      nodes: [
        node('START', { type: 'START' }),
        node('CALC', {
          config: { intermediateAssignments: [{ code: 'dti', source: 'LITERAL', value: 1 }] },
        }),
        node('OTRA', {}),
        node('USA', { config: { note: 'intermediate.dti' } }),
      ],
      edges: [
        edge('START', 'CALC'),
        edge('START', 'OTRA'),
        edge('CALC', 'USA'),
        edge('OTRA', 'USA'),
      ],
    });
    expect(codes(validate(graph).errors)).not.toContain('INTERMEDIATE_READ_BEFORE_WRITE');
  });

  it('rechaza escrituras de un nodo que no es el productor', () => {
    const graph = snapshot({
      intermediates: [intermediate()],
      nodes: [
        node('START', { type: 'START' }),
        node('CALC', {
          config: { intermediateAssignments: [{ code: 'dti', source: 'LITERAL', value: 1 }] },
        }),
        node('INTRUSO', {
          config: { intermediateAssignments: [{ code: 'dti', source: 'LITERAL', value: 2 }] },
        }),
      ],
      edges: [edge('START', 'CALC'), edge('CALC', 'INTRUSO')],
    });
    expect(codes(validate(graph).errors)).toContain('INTERMEDIATE_WRITE_UNAUTHORIZED');
  });

  it('rechaza una intermedia que colisiona con una variable del contrato público', () => {
    const graph = snapshot({
      intermediates: [intermediate({ code: 'score' })],
      variables: [
        {
          variableVersionId: '1',
          code: 'score',
          usageType: 'INPUT',
          version: 1,
          dataType: 'INTEGER',
          nullable: false,
          validationRules: [],
          sources: [],
          required: true,
          fallbackPolicy: 'FAIL_CLOSED',
          sensitive: false,
        },
      ],
      nodes: [node('START', { type: 'START' }), node('CALC', {})],
      edges: [edge('START', 'CALC')],
    });
    expect(codes(validate(graph).errors)).toContain('INTERMEDIATE_NAME_COLLISION');
  });

  it('rechaza una intermedia que nadie escribe y no tiene valor inicial', () => {
    const graph = snapshot({
      intermediates: [intermediate()],
      nodes: [node('START', { type: 'START' }), node('CALC', {})],
      edges: [edge('START', 'CALC')],
    });
    expect(codes(validate(graph).errors)).toContain('INTERMEDIATE_NEVER_WRITTEN');
  });

  it('avisa de una intermedia creada pero jamás consumida', () => {
    const graph = snapshot({
      intermediates: [intermediate()],
      nodes: [
        node('START', { type: 'START' }),
        node('CALC', {
          config: { intermediateAssignments: [{ code: 'dti', source: 'LITERAL', value: 1 }] },
        }),
      ],
      edges: [edge('START', 'CALC')],
    });
    expect(codes(validate(graph).warnings)).toContain('INTERMEDIATE_UNUSED');
  });

  it('rechaza la lectura por un nodo no autorizado', () => {
    const graph = snapshot({
      intermediates: [intermediate({ consumerNodeKeys: ['AUTORIZADO'] })],
      nodes: [
        node('START', { type: 'START' }),
        node('CALC', {
          config: { intermediateAssignments: [{ code: 'dti', source: 'LITERAL', value: 1 }] },
        }),
        node('AJENO', { config: { note: 'intermediate.dti' } }),
        node('AUTORIZADO', {}),
      ],
      edges: [edge('START', 'CALC'), edge('CALC', 'AJENO'), edge('AJENO', 'AUTORIZADO')],
    });
    expect(codes(validate(graph).errors)).toContain('INTERMEDIATE_READ_UNAUTHORIZED');
  });
});

describe('validación del contrato de salida', () => {
  const outputVariable = (code: string, required: boolean, dataType = 'STRING') => ({
    variableVersionId: '9',
    code,
    usageType: code === 'decision' ? 'OUTPUT_PRIMARY' : 'OUTPUT',
    dependencyPath: `output.${code}`,
    version: 1,
    dataType,
    nullable: false,
    validationRules: [],
    sources: [],
    required,
    fallbackPolicy: 'NOT_APPLICABLE',
    sensitive: false,
  });

  const field = (
    overrides: Partial<OutputContractFieldSnapshot> = {},
  ): OutputContractFieldSnapshot => ({
    code: 'decision',
    name: 'Decisión',
    sourceKind: 'NODE',
    sourceRef: 'RESULTADO',
    absenceReasons: [],
    contractVersion: '1',
    sensitivityClass: 'INTERNAL',
    tracePolicy: 'FULL',
    ...overrides,
  });

  const run = (input: ArtifactGraphSnapshot) =>
    validateOutputContract(input, buildGraphLookups(input));

  it('avisa cuando hay salidas pero ningún contrato explícito', () => {
    const graph = snapshot({ variables: [outputVariable('decision', true)] });
    expect(codes(run(graph).warnings)).toContain('OUTPUT_CONTRACT_NOT_DECLARED');
  });

  it('rechaza una salida obligatoria sin origen declarado', () => {
    const graph = snapshot({
      variables: [outputVariable('decision', true), outputVariable('motivo', true)],
      outputContract: [field()],
      nodes: [node('RESULTADO', { type: 'RESULT', terminal: true })],
    });
    expect(codes(run(graph).errors)).toContain('REQUIRED_OUTPUT_WITHOUT_SOURCE');
  });

  it('rechaza un origen que apunta a un nodo inexistente', () => {
    const graph = snapshot({
      variables: [outputVariable('decision', true)],
      outputContract: [field({ sourceRef: 'NO_EXISTE' })],
      nodes: [node('RESULTADO', { type: 'RESULT', terminal: true })],
    });
    expect(codes(run(graph).errors)).toContain('OUTPUT_SOURCE_NODE_MISSING');
  });

  it('rechaza un tipo incompatible entre la intermedia origen y el campo', () => {
    const graph = snapshot({
      variables: [outputVariable('decision', true, 'INTEGER')],
      intermediates: [intermediate({ code: 'texto', dataType: 'STRING' })],
      outputContract: [field({ sourceKind: 'INTERMEDIATE', sourceRef: 'texto' })],
      nodes: [node('RESULTADO', { type: 'RESULT', terminal: true })],
    });
    expect(codes(run(graph).errors)).toContain('OUTPUT_SOURCE_TYPE_MISMATCH');
  });

  it('rechaza un nodo terminal que no produce todas las salidas obligatorias', () => {
    const graph = snapshot({
      variables: [outputVariable('decision', true), outputVariable('motivo', true)],
      outputContract: [field(), field({ code: 'motivo', name: 'Motivo' })],
      nodes: [
        node('RESULTADO', {
          type: 'RESULT',
          terminal: true,
          config: {
            mode: 'MAPPING',
            assignments: [{ outputCode: 'decision', source: 'LITERAL', value: 'OK' }],
          },
        }),
      ],
    });
    expect(codes(run(graph).errors)).toContain('TERMINAL_PATH_MISSING_REQUIRED_OUTPUT');
  });

  it('no exige cobertura estática a un RESULT en modo SCRIPT', () => {
    const graph = snapshot({
      variables: [outputVariable('decision', true), outputVariable('motivo', true)],
      outputContract: [field(), field({ code: 'motivo', name: 'Motivo' })],
      nodes: [
        node('RESULTADO', {
          type: 'RESULT',
          terminal: true,
          config: { mode: 'SCRIPT', script: { language: 'PYTHON', source: 'result = {}' } },
        }),
      ],
    });
    expect(codes(run(graph).errors)).not.toContain('TERMINAL_PATH_MISSING_REQUIRED_OUTPUT');
  });

  it('rechaza motivos de ausencia en un campo obligatorio', () => {
    const graph = snapshot({
      variables: [outputVariable('decision', true)],
      outputContract: [field({ absenceReasons: ['SIN_DATOS'] })],
      nodes: [node('RESULTADO', { type: 'RESULT', terminal: true })],
    });
    expect(codes(run(graph).errors)).toContain('OUTPUT_ABSENCE_ON_REQUIRED');
  });

  it('detecta campos duplicados en el contrato', () => {
    const graph = snapshot({
      variables: [outputVariable('decision', true)],
      outputContract: [field(), field()],
      nodes: [node('RESULTADO', { type: 'RESULT', terminal: true })],
    });
    expect(codes(run(graph).errors)).toContain('OUTPUT_CONTRACT_DUPLICATE');
  });
});
