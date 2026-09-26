/**
 * Payloads del smoke: los correctos y los deliberadamente rotos.
 *
 * Cada payload roto lo está por UN motivo concreto y declarado, no por estar mal copiado:
 * así, cuando el motor lo rechaza, el código de error que devuelve se puede exigir. Un
 * payload roto por dos motivos a la vez no prueba nada, porque cualquiera de los dos
 * códigos sería aceptable y el contrato queda sin fijar.
 */
import { config } from './config.mjs';

export const RUN = config.runTag;

/**
 * Sufijo del actor que está corriendo ahora.
 *
 * Los tres usuarios recorren la misma superficie en la misma tanda, y varios llegan a las
 * mismas rutas de creación. Sin distinguirlos, el segundo chocaría con el código que dejó
 * el primero y su camino correcto se leería como un fallo, cuando lo único que ocurrió es
 * que el dato ya existía. Lo que SÍ se comparte —el artefacto del ciclo de vida— viaja por
 * el estado, no por el nombre.
 */
let actor = '';
export const setActor = (key) => {
  actor = key ? `_${key.slice(0, 3)}` : '';
};

/** Identificador único de esta corrida PARA ESTE actor. */
export const uid = () => `${RUN}${actor}`;

export const artifactCode = () => `SMOKE_${uid()}`.toUpperCase();
export const childArtifactCode = () => `SMOKE_CHILD_${uid()}`.toUpperCase();

export function createArtifact(code = artifactCode()) {
  return {
    artifactCode: code,
    artifactType: 'CREDIT_POLICY',
    name: `Smoke ${code}`,
    description: 'Artefacto creado por el smoke integral. Se puede borrar.',
    ownerTeam: 'RISK_DECISIONING',
    businessPurpose: 'Recorre de extremo a extremo el ciclo de vida completo de un algoritmo.',
    riskDomain: 'CREDIT_ORIGINATION',
  };
}

/**
 * Variable de entrada propia del smoke.
 *
 * No se reutiliza `age` del catálogo sembrado a propósito: su versión no declara valor por
 * defecto, y el validador del contrato de entrada trata "sin declarar" como "por defecto
 * nulo", que sobre una entrada no anulable es un error. Depender de eso ataría el smoke a
 * cómo esté sembrado el catálogo hoy. Con su propia variable, coherente y explícita, el
 * recorrido mide el motor y no la siembra.
 */
export const inputVariableCode = () => `smoke_age_${uid()}`;

export const graphInputVariable = () => ({
  variableCode: inputVariableCode(),
  canonicalName: 'Edad del solicitante (smoke)',
  businessDescription: 'Entrada del algoritmo que el smoke integral construye y ejecuta.',
  dataClassification: 'INTERNAL',
  ownerTeam: 'RISK_DECISIONING',
  isSensitive: false,
  initialVersion: {
    dataType: 'INTEGER',
    // Anulable y SIN valor por defecto, a propósito.
    //
    // El validador del contrato de entrada trata "sin defecto declarado" como "defecto
    // nulo", y eso sobre una entrada no anulable es incoherente. Declarar un defecto lo
    // arreglaba, pero a costa de romper lo que de verdad importa: con defecto, una entrada
    // inválida se sustituye en silencio y la decisión sale APROBADA en vez de rechazada.
    // Una errata del integrador no puede convertirse en una aprobación.
    nullable: true,
    displayName: 'Edad',
    description: 'Edad en años cumplidos.',
    constraints: { minimum: 0, maximum: 120 },
    validationMessage: 'La edad debe estar entre 0 y 120.',
    exampleValid: 30,
    exampleInvalid: -1,
    expectedOrigin: 'REQUEST',
    contractVersion: '1',
    sources: [
      {
        sourceSystemCode: 'CORE_BANKING',
        sourcePath: '/customers/{id}',
        sourceField: 'age',
        freshnessSlaSeconds: 86_400,
        precedence: 1,
        isAuthoritative: true,
      },
    ],
    validationRules: [
      { ruleType: 'RANGE', config: { minimum: 0, maximum: 120 }, severity: 'BLOCKING', errorCode: 'AGE_OUT_OF_RANGE' },
    ],
  },
});

/**
 * Grafo mínimo pero completo: dos caminos terminales y una condición real.
 *
 * Dos terminales no es un capricho: una suite con un solo camino alcanza el 100% de
 * cobertura sin ejercitar ninguna bifurcación, y la puerta de revisión —que exige ≥80% de
 * cobertura de nodos— pasaría sin haber probado la decisión.
 */
export function graph(variableVersionId, variableCode = inputVariableCode()) {
  return {
    dependencies: [
      {
        variableVersionId,
        usageType: 'INPUT',
        isRequired: true,
        fallbackPolicy: 'FAIL_CLOSED',
        dependencyPath: `input.${variableCode}`,
      },
    ],
    conditions: [
      {
        code: 'AGE_OK',
        name: 'La edad alcanza el mínimo',
        expressionType: 'JSON_AST',
        expression: { op: 'gte', left: { var: variableCode }, right: { value: 21 } },
        severity: 'BLOCKING',
        reusable: true,
      },
      {
        code: 'AGE_ADULT',
        name: 'Es mayor de edad pero no alcanza el mínimo',
        expressionType: 'JSON_AST',
        expression: { op: 'gte', left: { var: variableCode }, right: { value: 18 } },
        severity: 'BLOCKING',
        reusable: true,
      },
    ],
    actions: [
      {
        code: 'SET_APPROVED',
        type: 'SET_OUTCOME',
        payload: { outcome: 'APPROVED' },
        terminal: true,
        reasonCodes: [],
      },
      {
        code: 'SET_DECLINED',
        type: 'SET_OUTCOME',
        payload: { outcome: 'DECLINED' },
        terminal: true,
        reasonCodes: [],
      },
      {
        // Abre un caso en la cola de revisión. Es la única forma de que exista uno: los
        // casos no se crean por API, los produce el motor al recorrer este camino.
        code: 'OPEN_REVIEW',
        type: 'CREATE_MANUAL_REVIEW',
        payload: { queueCode: 'SMOKE_REVIEW', priority: 50, slaMinutes: 240 },
        terminal: true,
        reasonCodes: [],
      },
    ],
    nodes: [
      { key: 'START', type: 'START', label: 'Inicio', config: {}, x: 0, y: 0, order: 1, terminal: false, conditions: [], actions: [] },
      { key: 'CHECK', type: 'CONDITION', label: 'Comprobar edad', config: {}, x: 120, y: 0, order: 2, terminal: false, conditions: [], actions: [] },
      { key: 'APPROVE', type: 'ACTION', label: 'Aprobar', config: {}, x: 240, y: -80, order: 3, terminal: true, conditions: [], actions: [{ actionCode: 'SET_APPROVED', order: 1 }] },
      { key: 'REVIEW', type: 'ACTION', label: 'Derivar a revisión manual', config: {}, x: 240, y: 0, order: 4, terminal: true, conditions: [], actions: [{ actionCode: 'OPEN_REVIEW', order: 1 }] },
      { key: 'DECLINE', type: 'ACTION', label: 'Rechazar', config: {}, x: 240, y: 80, order: 5, terminal: true, conditions: [], actions: [{ actionCode: 'SET_DECLINED', order: 1 }] },
    ],
    // Las prioridades ordenan la evaluación, así que cada franja de edad cae en un camino
    // distinto sin necesidad de condiciones compuestas: ≥21 aprueba, 18–20 va a revisión y
    // el resto se rechaza por el eje por defecto.
    edges: [
      { key: 'START_CHECK', from: 'START', to: 'CHECK', type: 'DEFAULT', priority: 1, default: true, conditions: [] },
      { key: 'CHECK_APPROVE', from: 'CHECK', to: 'APPROVE', type: 'CONDITIONAL', priority: 1, default: false, conditions: [{ conditionCode: 'AGE_OK', order: 1 }] },
      { key: 'CHECK_REVIEW', from: 'CHECK', to: 'REVIEW', type: 'CONDITIONAL', priority: 2, default: false, conditions: [{ conditionCode: 'AGE_ADULT', order: 1 }] },
      { key: 'CHECK_DECLINE', from: 'CHECK', to: 'DECLINE', type: 'DEFAULT', priority: 999, default: true, conditions: [] },
    ],
  };
}

/** Grafo cuyo eje apunta a un nodo que no existe: el validador debe cazarlo, no el motor. */
export function graphWithDanglingEdge(variableVersionId, variableCode = inputVariableCode()) {
  const base = graph(variableVersionId, variableCode);
  return {
    ...base,
    edges: [
      ...base.edges,
      { key: 'CHECK_GHOST', from: 'CHECK', to: 'NODO_INEXISTENTE', type: 'DEFAULT', priority: 500, default: false, conditions: [] },
    ],
  };
}

/** Entrada de una decisión, con el nombre real de la variable que el grafo declara. */
export const decisionVariables = (age, variableCode = inputVariableCode()) => ({ [variableCode]: age });

export function testSuite(code = `SMOKE_${uid()}_REGRESSION`.toUpperCase(), variableCode = inputVariableCode()) {
  return {
    suiteCode: code,
    name: 'Regresión de elegibilidad por edad',
    suiteType: 'REGRESSION',
    isBlocking: true,
    cases: [
      {
        caseCode: 'APPROVE_ADULT',
        testName: 'Aprueba a un adulto',
        input: decisionVariables(30, variableCode),
        expectedResult: { outcome: 'APPROVED' },
      },
      {
        caseCode: 'REVIEW_BORDERLINE',
        testName: 'Deriva a revisión manual la franja intermedia',
        input: decisionVariables(19, variableCode),
        expectedResult: { outcome: 'MANUAL_REVIEW' },
      },
      {
        caseCode: 'DECLINE_MINOR',
        testName: 'Rechaza por debajo de la mayoría de edad',
        input: decisionVariables(15, variableCode),
        expectedResult: { outcome: 'DECLINED' },
      },
    ],
  };
}

export const testCase = (variableCode = inputVariableCode()) => ({
  caseCode: `SMOKE_EXTRA_${uid()}`.toUpperCase().slice(0, 100),
  testName: 'Caso añadido de uno en uno',
  input: decisionVariables(45, variableCode),
  expectedResult: { outcome: 'APPROVED' },
});

export const importedTestCases = (variableCode = inputVariableCode()) => ({
  cases: [
    {
      caseCode: `SMOKE_BATCH_${uid()}`.toUpperCase().slice(0, 100),
      testName: 'Caso importado en lote',
      input: decisionVariables(22, variableCode),
      expectedResult: { outcome: 'APPROVED' },
    },
  ],
});

export const variableDefinition = () => ({
  variableCode: `smoke_income_${uid()}`,
  canonicalName: 'Ingreso mensual declarado por el smoke',
  businessDescription: 'Variable creada por el smoke integral para ejercitar el catálogo.',
  dataClassification: 'INTERNAL',
  ownerTeam: 'RISK_DECISIONING',
  isSensitive: false,
  initialVersion: {
    dataType: 'DECIMAL',
    nullable: false,
    displayName: 'Ingreso mensual',
    description: 'Ingreso bruto mensual en la moneda del tenant.',
    constraints: { minimum: 0, maximum: 1_000_000 },
    validationMessage: 'El ingreso debe estar entre 0 y 1.000.000.',
    exampleValid: 2500,
    exampleInvalid: -1,
    expectedOrigin: 'REQUEST',
    contractVersion: '1',
    sources: [
      {
        sourceSystemCode: 'CORE_BANKING',
        sourcePath: '/customers/{id}/income',
        sourceField: 'monthlyIncome',
        freshnessSlaSeconds: 86_400,
        precedence: 1,
        isAuthoritative: true,
      },
    ],
    validationRules: [
      { ruleType: 'RANGE', config: { minimum: 0, maximum: 1_000_000 }, severity: 'BLOCKING', errorCode: 'INCOME_OUT_OF_RANGE' },
    ],
  },
});

export const variableContract = () => variableDefinition().initialVersion;

export const reasonCode = () => ({
  reasonCode: `SMOKE_REASON_${uid()}`.toUpperCase().slice(0, 120),
  category: 'CREDIT',
  publicMessage: 'La solicitud no cumple el criterio de elegibilidad.',
  internalMessage: 'Generado por el smoke integral para ejercitar el catálogo de motivos.',
  severity: 'INFO',
  isAdverseAction: false,
});

export const calculatedField = () => ({
  fieldCode: `smoke_ratio_${uid()}`.toLowerCase().slice(0, 120),
  name: 'Relación deuda/ingreso del smoke',
  description: 'Divide la deuda mensual entre el ingreso mensual.',
  rationale: 'Existe para ejercitar el catálogo cerrado de campos calculados sin tocar producción.',
  category: 'RATIOS',
  ownerTeam: 'RISK_DECISIONING',
});

/** Tres líneas ejecutables como máximo: el guardián de código rechaza la cuarta. */
export const calculatedFieldVersion = () => ({
  implementationKind: 'JAVASCRIPT',
  inputs: [
    { id: 'debt', name: 'Deuda mensual', description: 'Cuota mensual comprometida.', dataType: 'DECIMAL', required: true },
    { id: 'income', name: 'Ingreso mensual', description: 'Ingreso bruto mensual.', dataType: 'DECIMAL', required: true },
  ],
  returns: {
    dataType: 'DECIMAL',
    nullable: false,
    precision: 4,
    nullConditions: [],
    divisionByZero: 'RETURN_DEFAULT',
    missingData: 'FAIL',
    outOfRange: 'FAIL',
    errorCode: 'SMOKE_RATIO_ERROR',
    description: 'Proporción entre deuda e ingreso.',
  },
  comments: {
    overview: 'Relación deuda/ingreso.',
    functional: 'Divide la deuda entre el ingreso y acota el resultado a cuatro decimales.',
  },
  // El sandbox expone las entradas bajo `variables`, igual que los nodos de script del grafo.
  sourceCode: 'return variables.income > 0 ? variables.debt / variables.income : 0;',
  defaultValue: 0,
  testCases: [{ name: 'Caso base', inputs: { debt: 500, income: 2000 }, expected: 0.25 }],
});

/** Cuatro líneas ejecutables: excede el máximo declarado en §5 y debe ser rechazado. */
export const calculatedFieldVersionTooLong = () => ({
  ...calculatedFieldVersion(),
  sourceCode:
    'const a = variables.debt;\nconst b = variables.income;\nconst c = b > 0 ? a / b : 0;\nconst d = c * 1;\nreturn d;',
});

/** Variable de salida que la importación de código declara en su contrato. */
export const outputVariableCode = () => `smoke_risk_level_${uid()}`;

export const codeImportOutputVariable = () => ({
  variableCode: outputVariableCode(),
  canonicalName: 'Nivel de riesgo (smoke)',
  businessDescription: 'Salida declarada por el código que el smoke importa.',
  dataClassification: 'INTERNAL',
  ownerTeam: 'RISK_DECISIONING',
  isSensitive: false,
  initialVersion: {
    dataType: 'STRING',
    nullable: false,
    defaultValue: 'LOW',
    displayName: 'Nivel de riesgo',
    description: 'LOW o HIGH.',
    exampleValid: 'LOW',
    expectedOrigin: 'DERIVED',
    contractVersion: '1',
    sources: [],
    validationRules: [],
  },
});

/**
 * Fuente con su contrato declarado en el marcador.
 *
 * Las variables del marcador deben existir YA en el catálogo: el analizador rechaza
 * importar código que declara entradas o salidas que nadie definió, porque el grafo
 * resultante no podría resolverlas. Por eso el smoke crea antes las dos.
 */
export const codeImport = (inputCode = inputVariableCode(), outputCode = outputVariableCode()) => ({
  language: 'JAVASCRIPT',
  sourceCode:
    '// @atlas-contract\n' +
    '// { "contractVersion": "1",\n' +
    `//   "inputs": [{ "id": "${inputCode}", "name": "Edad", "type": "INTEGER", "required": true }],\n` +
    `//   "outputs": [{ "id": "${outputCode}", "name": "Nivel de riesgo", "type": "STRING", "required": true }] }\n` +
    `return { ${outputCode}: variables.${inputCode} >= 21 ? 'LOW' : 'HIGH' };\n`,
});

/** Fuente con error de sintaxis y sin marcador de contrato: el análisis debe reportar problemas. */
export const codeImportWithIssues = () => ({
  language: 'JAVASCRIPT',
  sourceCode: "const fs = require('fs');\nconst x = ;\n",
});

export const businessObjective = () => ({
  objectiveCode: `SMOKE_OBJ_${uid()}`.toUpperCase().slice(0, 100),
  name: 'Objetivo de negocio del smoke',
  metric: 'Tasa de aprobación',
  target: { operator: 'gte', value: 0.6 },
  ownerTeam: 'RISK_DECISIONING',
  policies: [
    {
      policyCode: `SMOKE_POL_${uid()}`.toUpperCase().slice(0, 100),
      rationale: 'Toda decisión de crédito debe poder trazarse hasta una política declarada.',
      owner: 'Equipo de riesgo',
      severity: 'HIGH',
    },
  ],
});

export const decisionRequest = (idempotencyKey, variables = decisionVariables(30)) => ({
  requestId: idempotencyKey,
  idempotencyKey,
  subjectReference: 'smoke-subject',
  environmentCode: config.environmentCode,
  variables,
});

export const simulation = (variables = decisionVariables(30)) => ({
  requestId: `smoke-sim-${RUN}`,
  environmentCode: config.environmentCode,
  variables,
});

export const sampleInputs = () => ({
  environmentCode: config.environmentCode,
  kind: 'VALID',
  count: 3,
  seed: `smoke-${RUN}`,
});

export const qaRun = () => ({
  environmentCode: config.environmentCode,
  caseCount: 5,
  seed: `smoke-${RUN}`,
  concurrency: 2,
  timeoutMs: 60_000,
  checkDeterminism: false,
});

export const tutorialProgress = () => ({ status: 'STARTED', lastStep: 1, version: 1, autoShow: false });

/**
 * Una fila del registro sólo puede HABILITAR un prelude ya presente en el repositorio,
 * nunca aportar código. Por eso `packageName` y `allowedFunctions` se toman del catálogo
 * real que sirve `GET /v1/libraries/preludes` en vez de inventarse aquí.
 */
export const library = (prelude) => ({
  logicalName: `smoke_lib_${uid()}`.toLowerCase().slice(0, 80),
  packageName: prelude.packageName,
  version: '1.0.0',
  language: prelude.language ?? 'JAVASCRIPT',
  category: 'MATH',
  description: 'Librería habilitada por el smoke para ejercitar el registro.',
  allowedFunctions: prelude.functions.slice(0, 20),
  allowedEnvironments: [config.environmentCode],
  status: 'APPROVED',
});

/** Prelude inexistente: el registro debe rechazarlo en cerrado, no habilitar nada. */
export const libraryWithoutPrelude = () => ({
  logicalName: `smoke_ghost_${uid()}`.toLowerCase().slice(0, 80),
  packageName: 'paquete-que-no-existe',
  version: '1.0.0',
  language: 'JAVASCRIPT',
  category: 'MATH',
  description: 'Intenta habilitar un prelude que nadie implementó.',
  allowedFunctions: ['nada'],
  allowedEnvironments: [config.environmentCode],
  status: 'APPROVED',
});
