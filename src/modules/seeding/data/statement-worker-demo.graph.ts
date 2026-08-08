/**
 * Grafo de demostración de los nodos que LLAMAN a un servicio de worker.
 *
 * Demuestra el ciclo completo: un nodo `WORKER` invoca el servicio de extractos bancarios
 * con el PDF que trae la petición, proyecta su respuesta a variables intermedias, y a
 * partir de ahí esas variables son un dato más del motor —las leen una expresión, unas
 * condiciones y el contrato de salida— exactamente igual que si las hubiera calculado el
 * propio grafo. Ese es el punto: el resultado de un worker no entra al motor por una
 * puerta propia, entra por la de las variables.
 *
 * Es una función PURA: devuelve el artefacto compilado sin tocar la base de datos, para
 * que una prueba pueda ejecutarlo contra el motor real. Los umbrales se justifican abajo.
 */
import type {
  CompiledDecisionArtifact,
  GraphEdgeSnapshot,
  GraphNodeSnapshot,
  IntermediateVariableSnapshot,
  OutputContractFieldSnapshot,
  VariableContractSnapshot,
} from '../../graph/graph.types';

export const STATEMENT_WORKER_DEMO_CODE = 'EXTRACTO_CAPACIDAD_PAGO';
export const STATEMENT_WORKER_DEMO_VERSION = '1.0.0';

/** Nodo que hace la llamada. Se nombra aquí porque lo referencian las intermedias. */
const CALL_NODE = 'ANALIZAR_EXTRACTO';

/**
 * Confianza mínima del análisis para decidir sobre el extracto.
 *
 * El motor de extractos publica su propia confianza compuesta (clasificación del
 * documento, entidad, estructura y reconciliación de saldos). Por debajo de este valor lo
 * que tiene delante no es un extracto mal leído, es un extracto que **no se sabe** si se
 * leyó bien; decidir un crédito con eso es peor que mandarlo a una persona.
 */
const MIN_CONFIDENCE = 0.6;

/**
 * Mínimo de movimientos para considerar el periodo representativo. Un extracto con dos
 * asientos no describe la actividad de una cuenta, describe un recorte de ella.
 */
const MIN_MOVEMENTS = 5;

/** Veces que los abonos del periodo deben cubrir la cuota para aprobar sin condiciones. */
const COVERAGE_APPROVE = 3;
/** Cobertura mínima para aprobar con condiciones. Por debajo, se rechaza. */
const COVERAGE_CONDITIONAL = 1.5;

export const STATEMENT_WORKER_DEMO_VARIABLES = {
  documento: 'extracto_pdf_base64',
  nombreArchivo: 'extracto_nombre_archivo',
  cuota: 'cuota_solicitada_extracto',
  decision: 'decision_extracto',
  motivo: 'motivo_extracto',
  ingreso: 'ingreso_verificado',
  confianza: 'confianza_extracto',
} as const;

const V = STATEMENT_WORKER_DEMO_VARIABLES;
const OUTPUT_CODES = new Set<string>([V.decision, V.motivo, V.ingreso, V.confianza]);
const PRIMARY_OUTPUT = V.decision;

export function isStatementDemoOutput(code: string): boolean {
  return OUTPUT_CODES.has(code);
}

export function isStatementDemoPrimaryOutput(code: string): boolean {
  return code === PRIMARY_OUTPUT;
}

/**
 * Construye el artefacto compilado. `variableIds` mapea cada código al id de su versión de
 * variable en el catálogo; el llamador lo obtiene tras sembrarlas.
 */
export function buildStatementWorkerDemoCompiled(
  artifact: { id: string; tenantId: string },
  version: { id: string },
  variableIds: Record<string, string>,
): CompiledDecisionArtifact {
  const nodes: GraphNodeSnapshot[] = [
    node('START', 'START', {
      label: 'Inicio',
      config: {
        description: 'Recibe el extracto bancario en PDF (base64) y la cuota mensual solicitada.',
      },
    }),
    node(CALL_NODE, 'WORKER', {
      label: 'Analizar el extracto bancario',
      config: {
        description:
          'Llama al servicio de extractos con el PDF de la solicitud y guarda lo que devuelve en variables intermedias.',
        service: 'bank-statement',
        operation: 'normalize',
        arguments: {
          documentBase64: { source: 'VARIABLE', path: V.documento },
          fileName: { source: 'VARIABLE', path: V.nombreArchivo },
        },
        /*
         * `CONTINUE` y no `FAIL`: que el documento no se pueda leer es información sobre
         * la solicitud, no una avería del motor. Con `FAIL` la petición terminaría en un
         * error HTTP y el analista no tendría ni decisión ni motivo; así el algoritmo se
         * queda con los valores por defecto y desvía el caso a revisión manual, que es
         * exactamente lo que haría una persona con un PDF ilegible en la mano.
         */
        onError: 'CONTINUE',
        timeoutMs: 30_000,
        outputs: [
          {
            intermediateCode: 'ext_estado_llamada',
            path: 'call.status',
            defaultValue: 'FAILED',
          },
          { intermediateCode: 'ext_codigo_error', path: 'call.errorCode', defaultValue: '' },
          {
            intermediateCode: 'ext_confianza',
            path: 'result.quality.overallConfidence',
            defaultValue: 0,
          },
          { intermediateCode: 'ext_total_creditos', path: 'result.totals.credit', defaultValue: 0 },
          { intermediateCode: 'ext_total_debitos', path: 'result.totals.debit', defaultValue: 0 },
          { intermediateCode: 'ext_saldo_final', path: 'result.balances.closing', defaultValue: 0 },
          // `.length` sobre el array de movimientos: la ruta se resuelve como cualquier
          // otra propiedad, así que no hace falta una operación especial para contarlos.
          {
            intermediateCode: 'ext_movimientos',
            path: 'result.transactions.length',
            defaultValue: 0,
          },
          {
            intermediateCode: 'ext_moneda',
            path: 'result.account.currency',
            defaultValue: 'DESCONOCIDA',
          },
        ],
      },
    }),
    node('DERIVAR_CAPACIDAD', 'EXPRESSION', {
      label: 'Derivar capacidad de pago',
      config: {
        description:
          'Toma los abonos del periodo como ingreso verificado y calcula cuántas veces cubren la cuota.',
        intermediateAssignments: [
          {
            code: 'ext_ingreso_mensual',
            source: 'EXPRESSION',
            // El extracto cubre un periodo mensual, así que los abonos del periodo son el
            // ingreso del mes. Es una simplificación deliberada del demo: separar nómina
            // de transferencias exigiría clasificar cada glosa, que es trabajo del OTRO
            // worker y merece su propio nodo.
            expression: { var: 'intermediate.ext_total_creditos' },
          },
          {
            code: 'ext_cobertura_cuota',
            source: 'EXPRESSION',
            expression: {
              op: 'div',
              left: { var: 'intermediate.ext_ingreso_mensual' },
              right: { var: V.cuota },
            },
          },
        ],
      },
    }),
    node('EVALUAR', 'CONDITION', {
      label: 'Evaluar capacidad de pago',
      config: {
        description: 'Decide según la fiabilidad del extracto y la cobertura de la cuota.',
      },
    }),
    resultNode('APROBAR', 'Aprobar', 'APROBADO', 'COBERTURA_HOLGADA'),
    resultNode(
      'APROBAR_CONDICIONADO',
      'Aprobar con condiciones',
      'APROBADO_CON_CONDICIONES',
      'COBERTURA_AJUSTADA',
    ),
    resultNode('REVISAR', 'Revisión manual', 'REVISION_MANUAL', 'EXTRACTO_NO_CONFIABLE'),
    resultNode('RECHAZAR', 'Rechazar', 'RECHAZADO', 'COBERTURA_INSUFICIENTE'),
  ];

  const edges: GraphEdgeSnapshot[] = [
    edge('E_START', 'START', CALL_NODE, [], true),
    edge('E_ANALISIS', CALL_NODE, 'DERIVAR_CAPACIDAD', [], true),
    edge('E_DERIVACION', 'DERIVAR_CAPACIDAD', 'EVALUAR', [], true),
    // La fiabilidad del extracto se comprueba ANTES que la cobertura: una cobertura
    // calculada sobre un documento que no se leyó bien no significa nada.
    edge(
      'E_REVISION',
      'EVALUAR',
      'REVISAR',
      [{ code: 'EXTRACTO_NO_CONFIABLE', order: 1 }],
      false,
      1,
    ),
    edge('E_APROBACION', 'EVALUAR', 'APROBAR', [{ code: 'COBERTURA_HOLGADA', order: 1 }], false, 2),
    edge(
      'E_CONDICIONADA',
      'EVALUAR',
      'APROBAR_CONDICIONADO',
      [{ code: 'COBERTURA_SUFICIENTE', order: 1 }],
      false,
      3,
    ),
    edge('E_RECHAZO', 'EVALUAR', 'RECHAZAR', [], true, 4),
  ];

  const ref = (code: string): { code: string; variableVersionId: string } => ({
    code,
    variableVersionId: variableIds[code] ?? code,
  });

  return {
    runtimeSchemaVersion: '1.2',
    compilerVersion: 'atlas-seed-statement-worker-demo-1.0.0',
    artifact: {
      id: artifact.id,
      tenantId: artifact.tenantId,
      code: STATEMENT_WORKER_DEMO_CODE,
      type: 'CREDIT_POLICY',
      name: 'Capacidad de pago verificada por extracto bancario',
      riskDomain: 'CREDIT_ORIGINATION',
    },
    version: {
      id: version.id,
      number: 1,
      semanticVersion: STATEMENT_WORKER_DEMO_VERSION,
      status: 'COMPILED',
    },
    variables: [
      /*
       * El documento va marcado como sensible, y eso NO es una etiqueta decorativa: el
       * motor deja de persistir su valor (guarda sólo su HMAC) y de publicarlo en la traza
       * de cada nodo. Sin ella, cada ejecución guardaría el PDF entero en base64 dentro de
       * `decision_execution_variable` y lo repetiría en el estado de variables de cada
       * paso.
       */
      input(ref(V.documento), 'STRING', {}, { sensitive: true, sensitivityClass: 'CONFIDENTIAL' }),
      input(ref(V.nombreArchivo), 'STRING', { maxLength: 255 }),
      input(ref(V.cuota), 'DECIMAL', { exclusiveMin: 0, max: 1_000_000, scale: 2 }),
      output(ref(V.decision), 'STRING', 'OUTPUT_PRIMARY'),
      output(ref(V.motivo), 'STRING', 'OUTPUT'),
      output(ref(V.ingreso), 'DECIMAL', 'OUTPUT'),
      output(ref(V.confianza), 'DECIMAL', 'OUTPUT'),
    ],
    intermediates: [
      // Las ocho primeras las escribe la LLAMADA al servicio; las dos últimas, la
      // expresión que deriva de ellas. Todas declaran su productor, y el validador
      // comprueba que ese productor domina a cualquier nodo que las lea.
      intermediate('ext_estado_llamada', 'Estado de la llamada al servicio', 'STRING', CALL_NODE),
      intermediate('ext_codigo_error', 'Código de error del servicio', 'STRING', CALL_NODE),
      intermediate('ext_confianza', 'Confianza del análisis del extracto', 'DECIMAL', CALL_NODE),
      intermediate('ext_total_creditos', 'Abonos del periodo', 'DECIMAL', CALL_NODE),
      intermediate('ext_total_debitos', 'Cargos del periodo', 'DECIMAL', CALL_NODE),
      intermediate('ext_saldo_final', 'Saldo final del periodo', 'DECIMAL', CALL_NODE),
      intermediate('ext_movimientos', 'Movimientos leídos', 'INTEGER', CALL_NODE),
      intermediate('ext_moneda', 'Moneda de la cuenta', 'STRING', CALL_NODE),
      intermediate(
        'ext_ingreso_mensual',
        'Ingreso mensual verificado',
        'DECIMAL',
        'DERIVAR_CAPACIDAD',
      ),
      intermediate(
        'ext_cobertura_cuota',
        'Veces que el ingreso cubre la cuota',
        'DECIMAL',
        'DERIVAR_CAPACIDAD',
      ),
    ],
    outputContract: [
      contractField(V.decision, 'Decisión sobre el extracto', 'NODE', 'EVALUAR'),
      contractField(V.motivo, 'Motivo de la decisión', 'NODE', 'EVALUAR'),
      contractField(V.ingreso, 'Ingreso verificado', 'INTERMEDIATE', 'ext_ingreso_mensual'),
      contractField(V.confianza, 'Confianza del extracto', 'INTERMEDIATE', 'ext_confianza'),
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
      EXTRACTO_NO_CONFIABLE: {
        code: 'EXTRACTO_NO_CONFIABLE',
        name: 'El extracto no es fiable',
        expressionType: 'JSON_AST',
        expression: {
          op: 'or',
          args: [
            {
              op: 'eq',
              left: { var: 'intermediate.ext_estado_llamada' },
              right: { value: 'FAILED' },
            },
            {
              op: 'lt',
              left: { var: 'intermediate.ext_confianza' },
              right: { value: MIN_CONFIDENCE },
            },
            {
              op: 'lt',
              left: { var: 'intermediate.ext_movimientos' },
              right: { value: MIN_MOVEMENTS },
            },
          ],
        },
        severity: 'BLOCKING',
        reusable: false,
      },
      COBERTURA_HOLGADA: {
        code: 'COBERTURA_HOLGADA',
        name: 'Los abonos cubren la cuota con holgura',
        expressionType: 'JSON_AST',
        expression: {
          op: 'gte',
          left: { var: 'intermediate.ext_cobertura_cuota' },
          right: { value: COVERAGE_APPROVE },
        },
        severity: 'BLOCKING',
        reusable: false,
      },
      COBERTURA_SUFICIENTE: {
        code: 'COBERTURA_SUFICIENTE',
        name: 'Los abonos cubren la cuota de forma ajustada',
        expressionType: 'JSON_AST',
        expression: {
          op: 'gte',
          left: { var: 'intermediate.ext_cobertura_cuota' },
          right: { value: COVERAGE_CONDITIONAL },
        },
        severity: 'BLOCKING',
        reusable: false,
      },
    },
    actions: {},
    totals: { nodes: nodes.length, edges: edges.length, terminalPaths: 4 },
  };
}

function input(
  ref: { code: string; variableVersionId: string },
  dataType: string,
  constraints: Record<string, unknown>,
  extra: Partial<VariableContractSnapshot> = {},
): VariableContractSnapshot {
  return {
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
  };
}

function output(
  ref: { code: string; variableVersionId: string },
  dataType: string,
  usageType: 'OUTPUT' | 'OUTPUT_PRIMARY',
): VariableContractSnapshot {
  return {
    ...input(ref, dataType, {}),
    usageType,
    dependencyPath: `output.${ref.code}`,
    fallbackPolicy: 'NOT_APPLICABLE',
  };
}

function intermediate(
  code: string,
  name: string,
  dataType: string,
  producerNodeKey: string,
): IntermediateVariableSnapshot {
  return {
    code,
    name,
    description: `${name}. Sólo existe durante la ejecución que la crea.`,
    dataType,
    producerNodeKey,
    // Sin consumidores declarados: cualquier nodo posterior al productor puede leerla.
    // Restringirlos aquí no aportaría nada al demo y sí ruido al grafo.
    consumerNodeKeys: [],
    nullable: false,
    updatePolicy: 'SINGLE_WRITE',
    sensitivityClass: 'INTERNAL',
    tracePolicy: 'FULL',
  };
}

function contractField(
  code: string,
  name: string,
  sourceKind: OutputContractFieldSnapshot['sourceKind'],
  sourceRef: string,
): OutputContractFieldSnapshot {
  return {
    code,
    name,
    sourceKind,
    sourceRef,
    absenceReasons: [],
    contractVersion: '1',
    sensitivityClass: 'INTERNAL',
    tracePolicy: 'FULL',
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
  decision: string,
  motivo: string,
): GraphNodeSnapshot {
  return node(key, 'RESULT', {
    label,
    terminal: true,
    config: {
      mode: 'MAPPING',
      assignments: [
        { outputCode: V.decision, source: 'LITERAL', value: decision },
        { outputCode: V.motivo, source: 'LITERAL', value: motivo },
        {
          outputCode: V.ingreso,
          source: 'EXPRESSION',
          expression: { var: 'intermediate.ext_ingreso_mensual' },
        },
        {
          outputCode: V.confianza,
          source: 'EXPRESSION',
          expression: { var: 'intermediate.ext_confianza' },
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
  return {
    key,
    from,
    to,
    type: isDefault ? 'DEFAULT' : 'CONDITIONAL',
    priority,
    default: isDefault,
    conditions,
  };
}
