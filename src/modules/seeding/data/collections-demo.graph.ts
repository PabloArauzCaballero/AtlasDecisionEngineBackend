/**
 * Segundo algoritmo de demostración: priorización de gestión de cobranza.
 *
 * Existe porque el demo BNPL, siendo grande, está construido ENTERO con nodos de
 * acción: sus bifurcaciones viven en las aristas y no hay un solo nodo de tipo
 * condición ni switch. Quien abre el editor para entender el producto no ve
 * nunca esas dos piezas funcionando, que son justo las que distinguen un árbol
 * de decisión de una lista de pasos.
 *
 * Aquí las dos aparecen y hacen trabajo real:
 *   - CONDITION `TIENE_DEUDA`: pregunta binaria, con su rama verdadera y su
 *     rama por defecto.
 *   - SWITCH `TRAMO_MORA`: una salida por cada valor del enum
 *     `current_delinquency_bucket`, que es el caso de libro para un switch —
 *     cinco tramos excluyentes, ninguno de los cuales es «lo demás».
 *
 * El dominio no es un pretexto: la priorización de cobranza es la decisión que
 * sigue naturalmente a la originación que ya modela el BNPL, con el mismo
 * vocabulario de variables que ya está en el catálogo.
 *
 * Función PURA: devuelve el compilado sin tocar la base de datos, para que una
 * prueba pueda ejecutarlo con el motor real y comparar contra lo esperado.
 */
import type {
  CompiledDecisionArtifact,
  GraphEdgeSnapshot,
  GraphNodeSnapshot,
} from '../../graph/graph.types';

export const COLLECTIONS_DEMO_CODE = 'COLLECTIONS_PRIORITIZATION';
export const COLLECTIONS_DEMO_VERSION = '1.0.0';

/** Saldo por debajo del cual no se abre gestión: cuesta más gestionarlo que cobrarlo. */
const MIN_BALANCE = 50;

export interface CollectionsDemoCase {
  name: string;
  input: Record<string, unknown>;
  expectedOutput: Record<string, unknown>;
}

interface VariableRef {
  code: string;
  variableVersionId: string;
}

/** Los cinco tramos del enum, con su estrategia y prioridad. Uno por rama del switch. */
export const BUCKETS = [
  { bucket: 'CURRENT', strategy: 'SIN_GESTION', priority: 0, label: 'Al día' },
  { bucket: 'DPD_1_30', strategy: 'RECORDATORIO', priority: 25, label: '1 a 30 días' },
  { bucket: 'DPD_31_60', strategy: 'LLAMADA', priority: 50, label: '31 a 60 días' },
  { bucket: 'DPD_61_90', strategy: 'NEGOCIACION', priority: 75, label: '61 a 90 días' },
  { bucket: 'DPD_90_PLUS', strategy: 'AGENCIA_EXTERNA', priority: 100, label: 'más de 90 días' },
] as const;

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

function edge(
  key: string,
  from: string,
  to: string,
  conditions: GraphEdgeSnapshot['conditions'],
  isDefault: boolean,
  priority = 1,
): GraphEdgeSnapshot {
  return { key, from, to, type: 'SEQUENCE', priority, default: isDefault, conditions };
}

/** Nodo final: publica estrategia y prioridad, que es lo que consume el operador. */
function resultNode(key: string, label: string, strategy: string, priority: number) {
  return node(key, 'RESULT', {
    label,
    terminal: true,
    config: {
      mode: 'MAPPING',
      assignments: [
        { outputCode: 'collections_strategy', source: 'LITERAL', value: strategy },
        { outputCode: 'collections_priority_score', source: 'LITERAL', value: priority },
      ],
    },
  });
}

export function buildCollectionsDemoCompiled(
  artifact: { id: string; tenantId: string },
  version: { id: string },
  variableIds: Record<string, string>,
): CompiledDecisionArtifact {
  const ref = (code: string): VariableRef => ({
    code,
    variableVersionId: variableIds[code] ?? code,
  });

  const nodes: GraphNodeSnapshot[] = [
    node('START', 'START', { label: 'Inicio', order: 1, x: 4, y: 40 }),

    // CONDICIÓN — pregunta binaria. Un saldo insignificante no justifica gestión:
    // se cierra aquí y no llega siquiera a clasificarse por tramo.
    node('TIENE_DEUDA', 'CONDITION', {
      label: '¿Hay saldo que gestionar?',
      order: 2,
      x: 22,
      y: 40,
    }),

    // SWITCH — una salida por tramo. Es el caso de libro: valores excluyentes de
    // un enum, sin un «resto» que tenga sentido tratar aparte.
    node('TRAMO_MORA', 'SWITCH', {
      label: 'Tramo de mora',
      order: 3,
      x: 44,
      y: 40,
      config: { selector: { var: 'current_delinquency_bucket' } },
    }),

    node('SIN_GESTION', 'RESULT', {
      label: 'Sin gestión: saldo irrelevante',
      terminal: true,
      order: 4,
      x: 66,
      y: 8,
      config: {
        mode: 'MAPPING',
        assignments: [
          { outputCode: 'collections_strategy', source: 'LITERAL', value: 'SIN_GESTION' },
          { outputCode: 'collections_priority_score', source: 'LITERAL', value: 0 },
        ],
      },
    }),

    ...BUCKETS.map((entry, index) =>
      Object.assign(
        resultNode(`RESULTADO_${entry.bucket}`, entry.label, entry.strategy, entry.priority),
        { order: 5 + index, x: 66, y: 20 + index * 14 },
      ),
    ),
  ];

  const edges: GraphEdgeSnapshot[] = [
    edge('E_START', 'START', 'TIENE_DEUDA', [], true, 1),
    // Rama verdadera de la condición, y su rama por defecto: las dos salidas que
    // hacen de esto una decisión y no un paso más.
    edge(
      'E_HAY_DEUDA',
      'TIENE_DEUDA',
      'TRAMO_MORA',
      [{ code: 'COND_SALDO_GESTIONABLE', order: 1 }],
      false,
      1,
    ),
    edge('E_SIN_DEUDA', 'TIENE_DEUDA', 'SIN_GESTION', [], true, 999),
    // Una arista por valor del enum. La última va marcada por defecto para que
    // ningún caso quede sin salida si el enum creciera.
    ...BUCKETS.map((entry, index) =>
      edge(
        `E_TRAMO_${entry.bucket}`,
        'TRAMO_MORA',
        `RESULTADO_${entry.bucket}`,
        index === BUCKETS.length - 1 ? [] : [{ code: `COND_${entry.bucket}`, order: 1 }],
        index === BUCKETS.length - 1,
        index === BUCKETS.length - 1 ? 999 : index + 1,
      ),
    ),
  ];

  const conditions: CompiledDecisionArtifact['conditions'] = {
    COND_SALDO_GESTIONABLE: {
      id: 'c-saldo',
      code: 'COND_SALDO_GESTIONABLE',
      name: 'El saldo vencido justifica abrir gestión',
      reusable: true,
      severity: 'BLOCKING',
      expressionType: 'JSON_AST',
      expression: {
        op: 'gte',
        left: { var: 'collections_balance' },
        right: { value: MIN_BALANCE },
      },
    },
  };
  for (const entry of BUCKETS.slice(0, -1)) {
    conditions[`COND_${entry.bucket}`] = {
      id: `c-${entry.bucket}`,
      code: `COND_${entry.bucket}`,
      name: `Tramo de mora: ${entry.label}`,
      reusable: true,
      severity: 'BLOCKING',
      expressionType: 'JSON_AST',
      expression: {
        op: 'eq',
        left: { var: 'current_delinquency_bucket' },
        right: { value: entry.bucket },
      },
    };
  }

  const edgesByNode: CompiledDecisionArtifact['edgesByNode'] = {};
  for (const item of edges) {
    edgesByNode[item.from] = [...(edgesByNode[item.from] ?? []), item];
  }
  for (const key of nodes.map((entry) => entry.key)) {
    edgesByNode[key] = edgesByNode[key] ?? [];
  }

  const input = (variable: VariableRef, dataType: string, validationSchema: unknown) => ({
    ...variable,
    version: 1,
    dataType,
    nullable: false,
    required: true,
    unitCode: null,
    sensitive: false,
    usageType: 'INPUT' as const,
    dependencyPath: `input.${variable.code}`,
    fallbackPolicy: 'FAIL_CLOSED',
    validationRules: [],
    validationSchema,
    sources: [
      {
        system: 'REQUEST_PAYLOAD',
        path: '$.variables',
        field: variable.code,
        precedence: 1,
        authoritative: true,
        freshnessSlaSeconds: 60,
      },
    ],
  });

  const output = (variable: VariableRef, dataType: string, usageType: string) => ({
    ...variable,
    version: 1,
    dataType,
    nullable: false,
    required: true,
    unitCode: null,
    sensitive: false,
    usageType,
    dependencyPath: `output.${variable.code}`,
    fallbackPolicy: 'NOT_APPLICABLE',
    validationRules: [],
    validationSchema: null,
    sources: [
      {
        system: 'DECISION_ENGINE',
        path: '$.output',
        field: variable.code,
        precedence: 1,
        authoritative: true,
        freshnessSlaSeconds: 0,
      },
    ],
  });

  return {
    runtimeSchemaVersion: '1.2',
    compilerVersion: 'atlas-seed-collections-demo-1.0.0',
    artifact: {
      id: artifact.id,
      tenantId: artifact.tenantId,
      code: COLLECTIONS_DEMO_CODE,
      type: 'COLLECTIONS_POLICY',
      name: 'Priorización de gestión de cobranza',
      riskDomain: 'COLLECTIONS',
    },
    version: {
      id: version.id,
      number: 1,
      semanticVersion: COLLECTIONS_DEMO_VERSION,
      status: 'COMPILED',
    },
    variables: [
      input(ref('collections_balance'), 'NUMBER', { minimum: 0 }),
      input(ref('current_delinquency_bucket'), 'STRING', {
        enum: BUCKETS.map((entry) => entry.bucket),
      }),
      output(ref('collections_strategy'), 'STRING', 'OUTPUT_PRIMARY'),
      output(ref('collections_priority_score'), 'NUMBER', 'OUTPUT'),
    ],
    intermediates: [],
    outputContract: [
      {
        code: 'collections_strategy',
        name: 'Estrategia de cobranza',
        description: 'Qué gestión abrir para esta cuenta.',
        sourceKind: 'NODE',
        sourceRef: 'RESULTADO_*',
        absenceReasons: [],
        contractVersion: '1',
      },
      {
        code: 'collections_priority_score',
        name: 'Prioridad de gestión',
        description: 'De 0 a 100; ordena la cola del equipo de cobranza.',
        sourceKind: 'NODE',
        sourceRef: 'RESULTADO_*',
        absenceReasons: [],
        contractVersion: '1',
      },
    ],
    actions: {},
    conditions,
    nodes: Object.fromEntries(nodes.map((entry) => [entry.key, entry])),
    edgesByNode,
    startNodeKey: 'START',
    totals: { nodes: nodes.length, edges: edges.length, terminalPaths: BUCKETS.length + 1 },
  } as unknown as CompiledDecisionArtifact;
}

/** Un caso por rama: las cinco del switch más la salida de la condición. */
export const COLLECTIONS_DEMO_CASES: CollectionsDemoCase[] = [
  {
    name: 'Saldo insignificante: no se abre gestión',
    input: { collections_balance: 10, current_delinquency_bucket: 'DPD_31_60' },
    expectedOutput: { collections_strategy: 'SIN_GESTION', collections_priority_score: 0 },
  },
  ...BUCKETS.map((entry) => ({
    name: `Tramo ${entry.label} → ${entry.strategy}`,
    input: { collections_balance: 1200, current_delinquency_bucket: entry.bucket },
    expectedOutput: {
      collections_strategy: entry.strategy,
      collections_priority_score: entry.priority,
    },
  })),
];
