/**
 * Política de originación BNPL de Atlas: el artefacto que AtlasBackend invoca de verdad.
 *
 * ## Por qué existe, y por qué no basta con el demo
 *
 * El demo `BNPL_CREDIT_DECISION` exige **56 variables** de un contrato que AtlasBackend no emite.
 * Con el payload real responde `422`, y el cliente HTTP del backend lee ese 422 como «la política
 * dice que no»: un desajuste de contrato se le presenta a una persona como un **rechazo de
 * crédito**. Es el peor modo de fallo posible en este dominio, porque es indistinguible de una
 * decisión legítima.
 *
 * Este artefacto declara exactamente las cinco entradas que el backend proyecta —importe
 * financiado, plazo, moneda, producto y propósito— y una única salida principal.
 *
 * ## Por qué las entradas son anulables y no obligatorias
 *
 * Con `requested_amount` obligatorio, una solicitud sin importe muere en la validación del
 * contrato con `VARIABLE_MISSING_OR_INVALID` **antes** de que el grafo llegue a opinar. Eso
 * devuelve un error técnico donde debería haber una decisión explicable. Declarándola anulable, la
 * falta de importe la resuelve la primera arista —`COND_AMOUNT_MISSING`— y sale como `DECLINE`,
 * que es una respuesta que se le puede leer a un cliente.
 *
 * ## Forma de las expresiones
 *
 * Literales crudos (`right: 4000`) y `is_null`. El motor no acepta `{lit: …}` ni `isNull`, y una
 * expresión mal formada no falla al sembrar: falla la primera vez que alguien pide un crédito.
 *
 * Es una función PURA: no toca la base. `test/atlas-underwriting-seed.spec.ts` la ejecuta con el
 * motor real y compara contra los casos de aquí abajo, así que los resultados sembrados no son una
 * afirmación escrita a mano.
 */
import type {
  CompiledDecisionArtifact,
  GraphEdgeSnapshot,
  GraphNodeSnapshot,
  VariableContractSnapshot,
} from '../../graph/graph.types';

export const ATLAS_UNDERWRITING_CODE = 'ATLAS_BNPL_UNDERWRITING';

/**
 * 1.0.2 — la versión que se validó contra el stack completo (app → AtlasBackend → motor) y que
 * devolvió una decisión real. Subirla vuelve a sembrar: el seeder se salta la siembra cuando la
 * versión ya existe, así que una corrección del grafo no llega sin cambiar este número.
 */
export const ATLAS_UNDERWRITING_VERSION = '1.0.2';

/** Techo del importe FINANCIADO (el 40 % del BNPL), en la moneda del producto. */
const AMOUNT_CAP = 4000;

/** Plazo máximo del producto BNPL, en meses. */
const TERM_CAP_MONTHS = 6;

/** Códigos del contrato que emite AtlasBackend. El orden es el de la proyección del backend. */
export const ATLAS_UNDERWRITING_INPUTS = [
  { code: 'requested_amount', dataType: 'DECIMAL' },
  { code: 'requested_term_months', dataType: 'INTEGER' },
  { code: 'currency_code', dataType: 'STRING' },
  { code: 'product_code', dataType: 'STRING' },
  { code: 'purpose_code', dataType: 'STRING' },
] as const;

export const ATLAS_UNDERWRITING_PRIMARY_OUTPUT = 'decision_outcome';

export interface AtlasUnderwritingCase {
  caseCode: string;
  name: string;
  input: Record<string, unknown>;
  expectedOutcome: 'APPROVE' | 'DECLINE';
}

/**
 * Casos de la suite bloqueante. Cubren los cuatro caminos terminales del grafo: las tres aristas
 * de rechazo y la de aprobación por defecto.
 *
 * `APPROVE_AT_LIMIT` y `DECLINE_OVER_LIMIT` son la frontera exacta del techo. Un límite probado
 * sólo por dentro no distingue `>` de `>=`, y esa diferencia es un crédito concedido o negado.
 */
export const ATLAS_UNDERWRITING_CASES: AtlasUnderwritingCase[] = [
  {
    caseCode: 'APPROVE_TYPICAL',
    name: 'Compra tipica dentro de la linea',
    input: baseInput({ requested_amount: 400, requested_term_months: 2 }),
    expectedOutcome: 'APPROVE',
  },
  {
    caseCode: 'APPROVE_AT_LIMIT',
    name: 'Importe exactamente en el techo',
    input: baseInput({ requested_amount: AMOUNT_CAP, requested_term_months: 2 }),
    expectedOutcome: 'APPROVE',
  },
  {
    caseCode: 'DECLINE_OVER_LIMIT',
    name: 'Importe por encima del techo',
    input: baseInput({ requested_amount: AMOUNT_CAP + 0.01, requested_term_months: 2 }),
    expectedOutcome: 'DECLINE',
  },
  {
    caseCode: 'DECLINE_TERM_TOO_LONG',
    name: 'Plazo por encima del maximo del producto',
    input: baseInput({ requested_amount: 400, requested_term_months: TERM_CAP_MONTHS + 1 }),
    expectedOutcome: 'DECLINE',
  },
  {
    caseCode: 'DECLINE_NO_AMOUNT',
    name: 'Sin importe no hay aprobacion',
    input: baseInput({ requested_amount: null, requested_term_months: 2 }),
    expectedOutcome: 'DECLINE',
  },
];

function baseInput(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    product_code: 'bnpl_atlas_estandar',
    purpose_code: 'bnpl_purchase',
    currency_code: 'BOB',
    ...overrides,
  };
}

/**
 * Construye el artefacto compilado. `variableIds` mapea cada código al id de su versión de
 * variable; el llamador lo obtiene tras sembrarlas.
 */
export function buildAtlasUnderwritingCompiled(
  artifact: { id: string; tenantId: string },
  version: { id: string },
  variableIds: Record<string, string>,
): CompiledDecisionArtifact {
  const variables: VariableContractSnapshot[] = [
    ...ATLAS_UNDERWRITING_INPUTS.map(({ code, dataType }) =>
      inputContract(code, dataType, variableIds[code] ?? code),
    ),
    outputContract(
      ATLAS_UNDERWRITING_PRIMARY_OUTPUT,
      variableIds[ATLAS_UNDERWRITING_PRIMARY_OUTPUT] ?? ATLAS_UNDERWRITING_PRIMARY_OUTPUT,
    ),
  ];

  const nodes: GraphNodeSnapshot[] = [
    node('START', 'START', { label: 'Inicio', order: 1 }),
    resultNode('APPROVE', 'Resultado: aprobado', 'APPROVE', 2, -10),
    resultNode('DECLINE', 'Resultado: rechazado', 'DECLINE', 3, 10),
  ];

  /*
    El orden de prioridad importa y no es cosmético: la ausencia de importe se comprueba ANTES que
    el techo, porque `null > 4000` no es verdadero y una solicitud sin importe se colaría por la
    arista por defecto hasta APPROVE. Aprobar por un dato que no llegó es exactamente el fallo que
    ninguna auditoría perdona.
  */
  const edges: GraphEdgeSnapshot[] = [
    edge('E_START_DECLINE_NO_AMOUNT', 'DECLINE', 1, 'COND_AMOUNT_MISSING'),
    edge('E_START_DECLINE_AMOUNT', 'DECLINE', 2, 'COND_AMOUNT_OVER_LIMIT'),
    edge('E_START_DECLINE_TERM', 'DECLINE', 3, 'COND_TERM_OVER_LIMIT'),
    edge('E_START_APPROVE', 'APPROVE', 999, undefined),
  ];

  return {
    artifact: {
      id: artifact.id,
      tenantId: artifact.tenantId,
      code: ATLAS_UNDERWRITING_CODE,
      name: 'Originacion BNPL de Atlas',
      type: 'CREDIT_POLICY',
      riskDomain: 'CREDIT_ORIGINATION',
    },
    version: {
      id: version.id,
      number: 1,
      semanticVersion: ATLAS_UNDERWRITING_VERSION,
      status: 'STRUCTURAL',
      checksum: null,
      authoringNotes: null,
    },
    variables,
    nodes: Object.fromEntries(nodes.map((entry) => [entry.key, entry])),
    edgesByNode: Object.fromEntries(
      nodes.map((entry) => [
        entry.key,
        edges
          .filter((candidate) => candidate.from === entry.key)
          .sort((a, b) => a.priority - b.priority || a.key.localeCompare(b.key)),
      ]),
    ),
    startNodeKey: 'START',
    conditions: {
      COND_AMOUNT_MISSING: {
        code: 'COND_AMOUNT_MISSING',
        name: 'No llego importe financiado',
        expressionType: 'JSON_AST',
        expression: { op: 'is_null', arg: { var: 'requested_amount' } },
        severity: 'BLOCKING',
        reusable: true,
      },
      COND_AMOUNT_OVER_LIMIT: {
        code: 'COND_AMOUNT_OVER_LIMIT',
        name: 'Importe financiado por encima del techo de la politica',
        expressionType: 'JSON_AST',
        expression: { op: 'gt', left: { var: 'requested_amount' }, right: AMOUNT_CAP },
        severity: 'BLOCKING',
        reusable: true,
      },
      COND_TERM_OVER_LIMIT: {
        code: 'COND_TERM_OVER_LIMIT',
        name: 'Plazo por encima del maximo del producto BNPL',
        expressionType: 'JSON_AST',
        expression: { op: 'gt', left: { var: 'requested_term_months' }, right: TERM_CAP_MONTHS },
        severity: 'BLOCKING',
        reusable: true,
      },
    },
    actions: {},
    intermediates: [],
    outputContract: [],
    totals: { nodes: nodes.length, edges: edges.length, terminalPaths: edges.length },
    compilerVersion: 'atlas-compiler-1.2.0',
    runtimeSchemaVersion: '1.1',
  };
}

function inputContract(
  code: string,
  dataType: string,
  variableVersionId: string,
): VariableContractSnapshot {
  return {
    variableVersionId,
    usageType: 'INPUT',
    dependencyPath: `input.${code}`,
    code,
    version: 1,
    dataType,
    // Anulable y no obligatoria a propósito: ver la cabecera del fichero. La falta de un dato la
    // decide el grafo con un motivo, no el validador con un error técnico.
    nullable: true,
    required: false,
    fallbackPolicy: 'NULL',
    constraints: null,
    expectedOrigin: 'REQUEST',
    contractVersion: '1',
    sensitivityClass: 'INTERNAL',
    validationRules: [],
    sources: [],
    sensitive: false,
  };
}

function outputContract(code: string, variableVersionId: string): VariableContractSnapshot {
  return {
    ...inputContract(code, 'STRING', variableVersionId),
    usageType: 'OUTPUT_PRIMARY',
    dependencyPath: `output.${code}`,
    nullable: false,
    required: true,
    fallbackPolicy: 'FAIL_CLOSED',
  };
}

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
  outcome: string,
  order: number,
  y: number,
): GraphNodeSnapshot {
  return node(key, 'RESULT', {
    label,
    order,
    x: 60,
    y,
    terminal: true,
    config: {
      mode: 'MAPPING',
      assignments: [
        { outputCode: ATLAS_UNDERWRITING_PRIMARY_OUTPUT, source: 'LITERAL', value: outcome },
      ],
    },
  });
}

function edge(
  key: string,
  to: string,
  priority: number,
  condition: string | undefined,
): GraphEdgeSnapshot {
  return {
    key,
    from: 'START',
    to,
    type: condition ? 'CONDITIONAL' : 'DEFAULT',
    priority,
    default: condition === undefined,
    conditions: condition ? [{ code: condition, order: 1 }] : [],
  };
}
