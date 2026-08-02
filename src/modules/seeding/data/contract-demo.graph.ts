/**
 * Grafo de demostración de las capacidades de contrato (§11): entradas con
 * restricciones, variables intermedias, contrato de salida explícito y casos esperados.
 *
 * Es una función PURA: devuelve el artefacto compilado y los casos esperados sin tocar
 * la base de datos. Así una prueba puede ejecutarlo con el motor real y comprobar que
 * las salidas sembradas coinciden con lo que el motor produce de verdad — que es
 * exactamente lo que §11 exige y lo que un seeder escrito a mano nunca garantiza.
 */
import type {
  CalculatedFieldCallSnapshot,
  CompiledDecisionArtifact,
  GraphEdgeSnapshot,
  GraphNodeSnapshot,
  VariableContractSnapshot,
} from '../../graph/graph.types';

export const CONTRACT_DEMO_CODE = 'AFFORDABILITY_CONTRACT_DEMO';
/**
 * 1.1.0 — el nodo CALCULAR_DTI pasa a INVOCAR el campo calculado `debt_to_income` en vez
 * de repetir la fórmula, que es lo que demuestra la reutilización de §5.1.
 */
export const CONTRACT_DEMO_VERSION = '1.1.0';

/** Umbral de DTI a partir del cual la solicitud va a revisión manual. */
const DTI_LIMIT = 0.45;
/** Carga máxima admitida de la nueva cuota sobre el ingreso disponible, en porcentaje. */
const BURDEN_LIMIT = 35;

export interface ContractDemoCase {
  name: string;
  input: Record<string, unknown>;
  expectedOutput: Record<string, unknown>;
}

interface VariableRef {
  code: string;
  variableVersionId: string;
}

const input = (
  ref: VariableRef,
  dataType: string,
  constraints: Record<string, unknown>,
  extra: Partial<VariableContractSnapshot> = {},
): VariableContractSnapshot => ({
  variableVersionId: ref.variableVersionId,
  usageType: 'INPUT',
  dependencyPath: `input.${ref.code}`,
  code: ref.code,
  version: 1,
  dataType,
  nullable: false,
  constraints,
  expectedOrigin: 'REQUEST',
  contractVersion: '1',
  sensitivityClass: 'INTERNAL',
  validationRules: [],
  sources: [],
  required: true,
  fallbackPolicy: 'FAIL_CLOSED',
  sensitive: false,
  ...extra,
});

const output = (
  ref: VariableRef,
  dataType: string,
  usageType: 'OUTPUT' | 'OUTPUT_PRIMARY',
  required = true,
): VariableContractSnapshot => ({
  ...input(ref, dataType, {}),
  usageType,
  dependencyPath: `output.${ref.code}`,
  required,
  fallbackPolicy: 'NOT_APPLICABLE',
});

/**
 * Construye el artefacto compilado del demo. `variableIds` mapea cada código al id de
 * su versión de variable en el catálogo; el llamador lo obtiene tras sembrarlas.
 */
export function buildContractDemoCompiled(
  artifact: { id: string; tenantId: string },
  version: { id: string },
  variableIds: Record<string, string>,
  /**
   * Campo calculado `debt_to_income` ya aprobado. Cuando se pasa, el nodo CALCULAR_DTI
   * lo INVOCA en vez de repetir la fórmula: es la demostración de que un campo calculado
   * se reutiliza de verdad desde un grafo (§5.1). Sin él, el demo sigue funcionando con
   * la expresión en línea, para que la siembra no dependa del orden de los catálogos.
   */
  calculatedField?: {
    versionId: string;
    versionNumber: number;
    definition: CalculatedFieldCallSnapshot['definition'];
  },
): CompiledDecisionArtifact {
  const ref = (code: string): VariableRef => ({
    code,
    variableVersionId: variableIds[code] ?? code,
  });

  const nodes: GraphNodeSnapshot[] = [
    node('START', 'START'),
    node('CALCULAR_DTI', 'EXPRESSION', {
      label: 'Calcular DTI',
      config: calculatedField
        ? {}
        : {
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
      calculatedFieldCalls: calculatedField
        ? [
            {
              callKey: 'debt_to_income',
              fieldCode: 'debt_to_income',
              calculatedFieldVersionId: calculatedField.versionId,
              versionNumber: calculatedField.versionNumber,
              inputMapping: {
                deuda_mensual: { source: 'VARIABLE', path: 'deuda_mensual' },
                ingreso_mensual: { source: 'VARIABLE', path: 'ingreso_mensual' },
              },
              target: { kind: 'INTERMEDIATE', code: 'dti' },
              definition: calculatedField.definition,
            },
          ]
        : undefined,
    }),
    node('CALCULAR_CARGA', 'EXPRESSION', {
      label: 'Calcular carga de la cuota',
      config: {
        intermediateAssignments: [
          {
            code: 'carga_cuota',
            source: 'EXPRESSION',
            expression: {
              op: 'min',
              args: [
                {
                  op: 'mul',
                  args: [
                    {
                      op: 'div',
                      left: { var: 'cuota_solicitada' },
                      right: { var: 'ingreso_mensual' },
                    },
                    { value: 100 },
                  ],
                },
                { value: 100 },
              ],
            },
          },
        ],
      },
    }),
    node('EVALUAR', 'CONDITION', { label: 'Evaluar capacidad de pago' }),
    resultNode('APROBAR', 'Aprobar', 'APROBADO', 'AFFORDABILITY_OK'),
    resultNode('REVISAR', 'Revisión manual', 'REVISION_MANUAL', 'DTI_ABOVE_LIMIT'),
    resultNode('RECHAZAR', 'Rechazar', 'RECHAZADO', 'BURDEN_TOO_HIGH'),
  ];

  const edges: GraphEdgeSnapshot[] = [
    edge('E_START', 'START', 'CALCULAR_DTI', [], true),
    edge('E_DTI', 'CALCULAR_DTI', 'CALCULAR_CARGA', [], true),
    edge('E_CARGA', 'CALCULAR_CARGA', 'EVALUAR', [], true),
    edge('E_RECHAZO', 'EVALUAR', 'RECHAZAR', [{ code: 'CARGA_EXCESIVA', order: 1 }], false, 1),
    edge('E_REVISION', 'EVALUAR', 'REVISAR', [{ code: 'DTI_ALTO', order: 1 }], false, 2),
    edge('E_APROBACION', 'EVALUAR', 'APROBAR', [], true, 3),
  ];

  return {
    runtimeSchemaVersion: '1.2',
    compilerVersion: 'atlas-seed-contract-demo-1.0.0',
    artifact: {
      id: artifact.id,
      tenantId: artifact.tenantId,
      code: CONTRACT_DEMO_CODE,
      type: 'CREDIT_POLICY',
      name: 'Demostración de contratos y variables intermedias',
      riskDomain: 'CREDIT_ORIGINATION',
    },
    version: {
      id: version.id,
      number: 1,
      semanticVersion: CONTRACT_DEMO_VERSION,
      status: 'COMPILED',
    },
    variables: [
      input(ref('ingreso_mensual'), 'DECIMAL', { exclusiveMin: 0, max: 1_000_000, scale: 2 }),
      input(ref('deuda_mensual'), 'DECIMAL', { min: 0, max: 1_000_000, scale: 2 }),
      input(ref('cuota_solicitada'), 'DECIMAL', { min: 0, max: 1_000_000, scale: 2 }),
      output(ref('decision_afordabilidad'), 'STRING', 'OUTPUT_PRIMARY'),
      output(ref('motivo_afordabilidad'), 'STRING', 'OUTPUT'),
      output(ref('dti_publicado'), 'DECIMAL', 'OUTPUT'),
    ],
    intermediates: [
      {
        code: 'dti',
        name: 'Relación deuda/ingreso',
        description: 'Deuda mensual sobre ingreso mensual. Vive solo durante la ejecución.',
        dataType: 'DECIMAL',
        producerNodeKey: 'CALCULAR_DTI',
        // Se limitan los consumidores a propósito: demuestra que un nodo no autorizado
        // ni siquiera ve la variable.
        consumerNodeKeys: ['EVALUAR', 'APROBAR', 'REVISAR', 'RECHAZAR'],
        nullable: false,
        updatePolicy: 'SINGLE_WRITE',
        sensitivityClass: 'INTERNAL',
        tracePolicy: 'FULL',
      },
      {
        code: 'carga_cuota',
        name: 'Carga de la cuota',
        description: 'Porcentaje del ingreso que consumiría la nueva cuota.',
        dataType: 'PERCENTAGE',
        producerNodeKey: 'CALCULAR_CARGA',
        consumerNodeKeys: [],
        nullable: false,
        updatePolicy: 'SINGLE_WRITE',
        sensitivityClass: 'INTERNAL',
        tracePolicy: 'FULL',
      },
    ],
    outputContract: [
      contractField('decision_afordabilidad', 'Decisión de afordabilidad', 'NODE', 'EVALUAR'),
      contractField('motivo_afordabilidad', 'Motivo', 'NODE', 'EVALUAR'),
      contractField('dti_publicado', 'DTI publicado', 'INTERMEDIATE', 'dti'),
    ],
    startNodeKey: 'START',
    nodes: Object.fromEntries(nodes.map((entry) => [entry.key, entry])),
    edgesByNode: Object.fromEntries(
      nodes.map((entry) => [
        entry.key,
        edges
          .filter((candidate) => candidate.from === entry.key)
          .sort((a, b) => a.priority - b.priority || a.key.localeCompare(b.key)),
      ]),
    ),
    conditions: {
      DTI_ALTO: {
        code: 'DTI_ALTO',
        name: 'DTI por encima del límite',
        expressionType: 'JSON_AST',
        expression: { op: 'gt', left: { var: 'intermediate.dti' }, right: { value: DTI_LIMIT } },
        severity: 'BLOCKING',
        reusable: false,
      },
      CARGA_EXCESIVA: {
        code: 'CARGA_EXCESIVA',
        name: 'Carga de cuota excesiva',
        expressionType: 'JSON_AST',
        expression: {
          op: 'gt',
          left: { var: 'intermediate.carga_cuota' },
          right: { value: BURDEN_LIMIT },
        },
        severity: 'BLOCKING',
        reusable: false,
      },
    },
    actions: {},
    totals: { nodes: nodes.length, edges: edges.length, terminalPaths: 3 },
  };
}

/**
 * Casos esperados del demo. Los valores NO están escritos "a ojo": la prueba
 * `contract-demo-seed.spec.ts` los ejecuta contra el motor real y falla si difieren.
 */
export const CONTRACT_DEMO_CASES: ContractDemoCase[] = [
  {
    name: 'Aprobado: DTI y carga dentro de límites',
    input: { ingreso_mensual: 2000, deuda_mensual: 400, cuota_solicitada: 300 },
    expectedOutput: {
      decision_afordabilidad: 'APROBADO',
      motivo_afordabilidad: 'AFFORDABILITY_OK',
      dti_publicado: 0.2,
    },
  },
  {
    name: 'Revisión manual: DTI por encima del límite',
    input: { ingreso_mensual: 1000, deuda_mensual: 500, cuota_solicitada: 300 },
    expectedOutput: {
      decision_afordabilidad: 'REVISION_MANUAL',
      motivo_afordabilidad: 'DTI_ABOVE_LIMIT',
      dti_publicado: 0.5,
    },
  },
  {
    name: 'Rechazado: la cuota consume demasiado ingreso',
    input: { ingreso_mensual: 1000, deuda_mensual: 100, cuota_solicitada: 600 },
    expectedOutput: {
      decision_afordabilidad: 'RECHAZADO',
      motivo_afordabilidad: 'BURDEN_TOO_HIGH',
      dti_publicado: 0.1,
    },
  },
  {
    name: 'Límite exacto de DTI: 0.45 todavía aprueba',
    input: { ingreso_mensual: 1000, deuda_mensual: 450, cuota_solicitada: 300 },
    expectedOutput: {
      decision_afordabilidad: 'APROBADO',
      motivo_afordabilidad: 'AFFORDABILITY_OK',
      dti_publicado: 0.45,
    },
  },
];

/** Entradas que el contrato DEBE rechazar; alimentan los casos negativos sembrados. */
export const CONTRACT_DEMO_INVALID_CASES = [
  {
    name: 'Ingreso cero incumple exclusiveMin',
    input: { ingreso_mensual: 0, deuda_mensual: 100, cuota_solicitada: 100 },
    expectedError: 'VARIABLE_MISSING_OR_INVALID',
  },
  {
    name: 'Deuda negativa incumple el mínimo',
    input: { ingreso_mensual: 1000, deuda_mensual: -1, cuota_solicitada: 100 },
    expectedError: 'VARIABLE_MISSING_OR_INVALID',
  },
  {
    name: 'Falta la cuota solicitada',
    input: { ingreso_mensual: 1000, deuda_mensual: 100 },
    expectedError: 'VARIABLE_MISSING_OR_INVALID',
  },
  {
    name: 'Tipo incorrecto en el ingreso',
    input: { ingreso_mensual: 'mucho', deuda_mensual: 100, cuota_solicitada: 100 },
    expectedError: 'VARIABLE_MISSING_OR_INVALID',
  },
];

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

function resultNode(
  key: string,
  label: string,
  decision: string,
  motivo: string,
): GraphNodeSnapshot {
  return node(key, 'RESULT', {
    label,
    terminal: true,
    config: {
      mode: 'MAPPING',
      assignments: [
        { outputCode: 'decision_afordabilidad', source: 'LITERAL', value: decision },
        { outputCode: 'motivo_afordabilidad', source: 'LITERAL', value: motivo },
        {
          outputCode: 'dti_publicado',
          source: 'EXPRESSION',
          expression: { var: 'intermediate.dti' },
        },
      ],
    },
  });
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

function contractField(
  code: string,
  name: string,
  sourceKind: 'NODE' | 'INTERMEDIATE',
  sourceRef: string,
) {
  return {
    code,
    name,
    description: `Origen declarado: ${sourceKind.toLowerCase()} ${sourceRef}`,
    sourceKind,
    sourceRef,
    absenceReasons: [] as string[],
    contractVersion: '1',
    sensitivityClass: 'INTERNAL',
    tracePolicy: 'FULL' as const,
  };
}
