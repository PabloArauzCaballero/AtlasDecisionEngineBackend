/**
 * Verificación del expediente de un comercio (KYB), como artefacto de decisión.
 *
 * ## Por qué existe
 *
 * El expediente del comercio ya sabía decir qué le faltaba —matrícula, representante con su
 * poder, sucursal, los dos QR—, pero esa lista vivía dentro del backend de altas y no se
 * ejecutaba en ninguna parte: no había artefacto, así que no había versión, ni traza, ni
 * ejecución que enseñar, ni forma de cambiar un umbral sin tocar código. Decidir si un comercio
 * puede operar es exactamente la clase de decisión que este motor existe para gobernar.
 *
 * ## Qué decide y qué NO decide
 *
 * Decide entre tres desenlaces: aprobar, mandar a revisión manual o rechazar por incompleto. Lo
 * que **no** hace es aprobar por su cuenta lo que exige criterio humano: cuando el expediente
 * está completo pero trae señales operativas —el correo sin verificar, ninguna sucursal
 * habilitada, o un expediente abierto hace demasiado— sale `REVISION_MANUAL`. La aprobación de
 * un comercio la firma una persona; esto le dice a esa persona qué mirar y por qué.
 *
 * ## Función pura
 *
 * Devuelve el artefacto compilado y los casos esperados sin tocar la base. Así
 * `partner-kyb-seed.spec.ts` lo ejecuta con el motor real y comprueba que lo sembrado coincide
 * con lo que el motor produce de verdad — que es lo que un seeder escrito a mano nunca garantiza.
 */
import type {
  CompiledDecisionArtifact,
  GraphEdgeSnapshot,
  GraphNodeSnapshot,
  VariableContractSnapshot,
} from '../../graph/graph.types';

export const PARTNER_KYB_CODE = 'PARTNER_KYB_REVIEW';
export const PARTNER_KYB_VERSION = '1.0.0';

/**
 * Días desde la apertura a partir de los cuales el expediente deja de considerarse fresco.
 *
 * No es un rechazo: es una señal. Un expediente que lleva medio año abierto suele traer datos
 * que ya no describen al negocio —cambió de local, de cuenta, de dueño—, y eso lo tiene que
 * mirar alguien antes de habilitarlo para cobrar.
 */
const DIAS_PARA_CONSIDERAR_ANTIGUO = 120;

export interface PartnerKybCase {
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
): VariableContractSnapshot => ({
  ...input(ref, dataType, {}),
  usageType,
  dependencyPath: `output.${ref.code}`,
  fallbackPolicy: 'NOT_APPLICABLE',
});

/** Cuenta 1 cuando el requisito NO está cubierto. Es la forma de sumar booleanos en el AST. */
const faltante = (code: string) => ({
  op: 'if',
  condition: { op: 'not', arg: { var: code } },
  then: { value: 1 },
  else: { value: 0 },
});

export function buildPartnerKybCompiled(
  artifact: { id: string; tenantId: string },
  version: { id: string },
  variableIds: Record<string, string>,
): CompiledDecisionArtifact {
  const ref = (code: string): VariableRef => ({
    code,
    variableVersionId: variableIds[code] ?? code,
  });

  const nodes: GraphNodeSnapshot[] = [
    node('START', 'START'),
    node('CONTAR_REQUISITOS', 'EXPRESSION', {
      label: 'Contar requisitos duros pendientes',
      config: {
        intermediateAssignments: [
          {
            code: 'requisitos_faltantes',
            source: 'EXPRESSION',
            /*
             * Los cuatro que impiden operar, no los que dan pereza.
             *
             * Sin matrícula el negocio no está inscrito; sin representante acreditado nadie puede
             * firmar por él; sin QR del negocio no hay cartel que enseñar; sin QR bancario el
             * dinero del cliente no tiene a dónde ir. Cualquiera de los cuatro que falte hace que
             * el expediente no pueda aprobarse, así que se cuentan juntos.
             */
            expression: {
              op: 'add',
              args: [
                faltante('kyb_tiene_matricula'),
                faltante('kyb_representante_acreditado'),
                faltante('kyb_qr_negocio'),
                faltante('kyb_qr_bancario'),
              ],
            },
          },
        ],
      },
    }),
    node('MEDIR_SENALES', 'EXPRESSION', {
      label: 'Medir señales operativas',
      config: {
        intermediateAssignments: [
          {
            code: 'senales_operativas',
            source: 'EXPRESSION',
            /*
             * Lo que no bloquea pero sí exige que mire una persona: el correo de contacto sin
             * verificar (no hay por dónde avisarle de nada), ninguna sucursal registrada (no se
             * sabe dónde opera) y un expediente demasiado viejo (sus datos ya pueden no describir
             * al negocio).
             */
            expression: {
              op: 'add',
              args: [
                faltante('kyb_correo_verificado'),
                {
                  op: 'if',
                  condition: { op: 'lt', left: { var: 'kyb_sucursales' }, right: { value: 1 } },
                  then: { value: 1 },
                  else: { value: 0 },
                },
                {
                  op: 'if',
                  condition: {
                    op: 'gt',
                    left: { var: 'kyb_antiguedad_dias' },
                    right: { value: DIAS_PARA_CONSIDERAR_ANTIGUO },
                  },
                  then: { value: 1 },
                  else: { value: 0 },
                },
              ],
            },
          },
        ],
      },
    }),
    node('EVALUAR', 'CONDITION', { label: 'Evaluar el expediente' }),
    resultNode('RECHAZAR', 'Incompleto', 'RECHAZADO', 'KYB_REQUISITOS_INCOMPLETOS'),
    resultNode('REVISAR', 'Revisión manual', 'REVISION_MANUAL', 'KYB_SENALES_OPERATIVAS'),
    resultNode('APROBAR', 'Apto para operar', 'APROBADO', 'KYB_COMPLETO'),
  ];

  const edges: GraphEdgeSnapshot[] = [
    edge('E_START', 'START', 'CONTAR_REQUISITOS', [], true),
    edge('E_REQUISITOS', 'CONTAR_REQUISITOS', 'MEDIR_SENALES', [], true),
    edge('E_SENALES', 'MEDIR_SENALES', 'EVALUAR', [], true),
    // El orden importa: faltar un requisito duro gana sobre cualquier señal blanda.
    edge('E_INCOMPLETO', 'EVALUAR', 'RECHAZAR', [{ code: 'FALTAN_REQUISITOS', order: 1 }], false, 1),
    edge('E_REVISION', 'EVALUAR', 'REVISAR', [{ code: 'HAY_SENALES', order: 1 }], false, 2),
    edge('E_APROBACION', 'EVALUAR', 'APROBAR', [], true, 3),
  ];

  return {
    runtimeSchemaVersion: '1.2',
    compilerVersion: 'atlas-seed-partner-kyb-1.0.0',
    artifact: {
      id: artifact.id,
      tenantId: artifact.tenantId,
      code: PARTNER_KYB_CODE,
      type: 'RISK_POLICY',
      name: 'Verificación del expediente del comercio (KYB)',
      riskDomain: 'MERCHANT_ONBOARDING',
    },
    version: {
      id: version.id,
      number: 1,
      semanticVersion: PARTNER_KYB_VERSION,
      status: 'COMPILED',
    },
    variables: [
      input(ref('kyb_tiene_matricula'), 'BOOLEAN', {}),
      input(ref('kyb_representante_acreditado'), 'BOOLEAN', {}),
      input(ref('kyb_qr_negocio'), 'BOOLEAN', {}),
      input(ref('kyb_qr_bancario'), 'BOOLEAN', {}),
      input(ref('kyb_correo_verificado'), 'BOOLEAN', {}),
      input(ref('kyb_sucursales'), 'INTEGER', { min: 0, max: 5_000 }),
      input(ref('kyb_antiguedad_dias'), 'INTEGER', { min: 0, max: 10_000 }),
      output(ref('kyb_decision'), 'STRING', 'OUTPUT_PRIMARY'),
      output(ref('kyb_motivo'), 'STRING', 'OUTPUT'),
      output(ref('kyb_requisitos_faltantes'), 'INTEGER', 'OUTPUT'),
      output(ref('kyb_senales_operativas'), 'INTEGER', 'OUTPUT'),
    ],
    intermediates: [
      {
        code: 'requisitos_faltantes',
        name: 'Requisitos duros pendientes',
        description: 'Cuántos de los cuatro requisitos que impiden operar siguen sin cubrirse.',
        dataType: 'INTEGER',
        producerNodeKey: 'CONTAR_REQUISITOS',
        consumerNodeKeys: ['EVALUAR', 'APROBAR', 'REVISAR', 'RECHAZAR'],
        nullable: false,
        updatePolicy: 'SINGLE_WRITE',
        sensitivityClass: 'INTERNAL',
        tracePolicy: 'FULL',
      },
      {
        code: 'senales_operativas',
        name: 'Señales operativas',
        description: 'Avisos que no bloquean pero exigen que una persona mire el expediente.',
        dataType: 'INTEGER',
        producerNodeKey: 'MEDIR_SENALES',
        consumerNodeKeys: ['EVALUAR', 'APROBAR', 'REVISAR', 'RECHAZAR'],
        nullable: false,
        updatePolicy: 'SINGLE_WRITE',
        sensitivityClass: 'INTERNAL',
        tracePolicy: 'FULL',
      },
    ],
    outputContract: [
      contractField('kyb_decision', 'Decisión sobre el expediente', 'NODE', 'EVALUAR'),
      contractField('kyb_motivo', 'Motivo', 'NODE', 'EVALUAR'),
      contractField(
        'kyb_requisitos_faltantes',
        'Requisitos pendientes',
        'INTERMEDIATE',
        'requisitos_faltantes',
      ),
      contractField(
        'kyb_senales_operativas',
        'Señales operativas',
        'INTERMEDIATE',
        'senales_operativas',
      ),
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
      FALTAN_REQUISITOS: {
        code: 'FALTAN_REQUISITOS',
        name: 'Faltan requisitos para operar',
        expressionType: 'JSON_AST',
        expression: {
          op: 'gt',
          left: { var: 'intermediate.requisitos_faltantes' },
          right: { value: 0 },
        },
        severity: 'BLOCKING',
        reusable: false,
      },
      HAY_SENALES: {
        code: 'HAY_SENALES',
        name: 'El expediente trae señales operativas',
        expressionType: 'JSON_AST',
        expression: {
          op: 'gt',
          left: { var: 'intermediate.senales_operativas' },
          right: { value: 0 },
        },
        severity: 'WARNING',
        reusable: false,
      },
    },
    actions: {},
    totals: { nodes: nodes.length, edges: edges.length, terminalPaths: 3 },
  };
}

/**
 * Casos esperados. Los valores NO están escritos «a ojo»: `partner-kyb-seed.spec.ts` los ejecuta
 * contra el motor real y falla si difieren.
 */
export const PARTNER_KYB_CASES: PartnerKybCase[] = [
  {
    name: 'Aprobado: expediente completo y sin señales',
    input: {
      kyb_tiene_matricula: true,
      kyb_representante_acreditado: true,
      kyb_qr_negocio: true,
      kyb_qr_bancario: true,
      kyb_correo_verificado: true,
      kyb_sucursales: 2,
      kyb_antiguedad_dias: 15,
    },
    expectedOutput: {
      kyb_decision: 'APROBADO',
      kyb_motivo: 'KYB_COMPLETO',
      kyb_requisitos_faltantes: 0,
      kyb_senales_operativas: 0,
    },
  },
  {
    name: 'Rechazado: el caso de la captura, faltan matrícula, representante y QR del negocio',
    input: {
      kyb_tiene_matricula: false,
      kyb_representante_acreditado: false,
      kyb_qr_negocio: false,
      kyb_qr_bancario: true,
      kyb_correo_verificado: true,
      kyb_sucursales: 1,
      kyb_antiguedad_dias: 20,
    },
    expectedOutput: {
      kyb_decision: 'RECHAZADO',
      kyb_motivo: 'KYB_REQUISITOS_INCOMPLETOS',
      kyb_requisitos_faltantes: 3,
      kyb_senales_operativas: 0,
    },
  },
  {
    name: 'Revisión manual: completo, pero sin sucursal y con el correo sin verificar',
    input: {
      kyb_tiene_matricula: true,
      kyb_representante_acreditado: true,
      kyb_qr_negocio: true,
      kyb_qr_bancario: true,
      kyb_correo_verificado: false,
      kyb_sucursales: 0,
      kyb_antiguedad_dias: 30,
    },
    expectedOutput: {
      kyb_decision: 'REVISION_MANUAL',
      kyb_motivo: 'KYB_SENALES_OPERATIVAS',
      kyb_requisitos_faltantes: 0,
      kyb_senales_operativas: 2,
    },
  },
  {
    name: 'Revisión manual: completo pero abierto hace demasiado tiempo',
    input: {
      kyb_tiene_matricula: true,
      kyb_representante_acreditado: true,
      kyb_qr_negocio: true,
      kyb_qr_bancario: true,
      kyb_correo_verificado: true,
      kyb_sucursales: 3,
      kyb_antiguedad_dias: 121,
    },
    expectedOutput: {
      kyb_decision: 'REVISION_MANUAL',
      kyb_motivo: 'KYB_SENALES_OPERATIVAS',
      kyb_requisitos_faltantes: 0,
      kyb_senales_operativas: 1,
    },
  },
  {
    name: 'Frontera: 120 días todavía no es señal',
    input: {
      kyb_tiene_matricula: true,
      kyb_representante_acreditado: true,
      kyb_qr_negocio: true,
      kyb_qr_bancario: true,
      kyb_correo_verificado: true,
      kyb_sucursales: 1,
      kyb_antiguedad_dias: 120,
    },
    expectedOutput: {
      kyb_decision: 'APROBADO',
      kyb_motivo: 'KYB_COMPLETO',
      kyb_requisitos_faltantes: 0,
      kyb_senales_operativas: 0,
    },
  },
  {
    name: 'Un requisito duro pesa más que estar impecable en todo lo demás',
    input: {
      kyb_tiene_matricula: true,
      kyb_representante_acreditado: true,
      kyb_qr_negocio: true,
      kyb_qr_bancario: false,
      kyb_correo_verificado: true,
      kyb_sucursales: 5,
      kyb_antiguedad_dias: 3,
    },
    expectedOutput: {
      kyb_decision: 'RECHAZADO',
      kyb_motivo: 'KYB_REQUISITOS_INCOMPLETOS',
      kyb_requisitos_faltantes: 1,
      kyb_senales_operativas: 0,
    },
  },
];

/** Entradas que el contrato DEBE rechazar antes de llegar al grafo. */
export const PARTNER_KYB_INVALID_CASES = [
  {
    name: 'Falta declarar si hay QR bancario',
    input: {
      kyb_tiene_matricula: true,
      kyb_representante_acreditado: true,
      kyb_qr_negocio: true,
      kyb_correo_verificado: true,
      kyb_sucursales: 1,
      kyb_antiguedad_dias: 10,
    },
    expectedError: 'VARIABLE_MISSING_OR_INVALID',
  },
  {
    name: 'Número de sucursales negativo',
    input: {
      kyb_tiene_matricula: true,
      kyb_representante_acreditado: true,
      kyb_qr_negocio: true,
      kyb_qr_bancario: true,
      kyb_correo_verificado: true,
      kyb_sucursales: -1,
      kyb_antiguedad_dias: 10,
    },
    expectedError: 'VARIABLE_MISSING_OR_INVALID',
  },
  {
    name: 'Antigüedad con un texto en vez de un número',
    input: {
      kyb_tiene_matricula: true,
      kyb_representante_acreditado: true,
      kyb_qr_negocio: true,
      kyb_qr_bancario: true,
      kyb_correo_verificado: true,
      kyb_sucursales: 1,
      kyb_antiguedad_dias: 'hace mucho',
    },
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
        { outputCode: 'kyb_decision', source: 'LITERAL', value: decision },
        { outputCode: 'kyb_motivo', source: 'LITERAL', value: motivo },
        {
          outputCode: 'kyb_requisitos_faltantes',
          source: 'EXPRESSION',
          expression: { var: 'intermediate.requisitos_faltantes' },
        },
        {
          outputCode: 'kyb_senales_operativas',
          source: 'EXPRESSION',
          expression: { var: 'intermediate.senales_operativas' },
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
