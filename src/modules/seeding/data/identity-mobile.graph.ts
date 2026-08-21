/**
 * El artefacto que el front móvil consume para verificar a una persona.
 *
 * ## Por qué un artefacto y no una llamada directa al worker
 *
 * El worker contesta una pregunta técnica —«¿el carnet y la selfie son de la
 * misma persona, y es un carnet admisible?»— y esa pregunta no es la del
 * negocio. La del negocio es «¿dejo entrar a esta persona?», y su respuesta
 * depende de política: qué parecido basta, qué se hace con un documento a punto
 * de caducar, si una prueba de vida no ejecutada se tolera. Esa política cambia
 * sin que cambie el worker, y tiene que poder cambiarse **sin desplegar código**,
 * con versión, aprobación y traza. Eso es exactamente lo que un artefacto es.
 *
 * Consecuencia práctica para AtlasBackend: llama a `POST /v1/decisions/
 * IDENTIDAD_CARNET_MOVIL` con su `DecisionEngineClient` de siempre y recibe una
 * decisión de negocio con su motivo. No necesita conocer umbrales biométricos ni
 * códigos del worker, y el día que se endurezca el criterio no se toca.
 *
 * ## El nodo NO espera a una persona
 *
 * Un caso dudoso vuelve del worker como `REVIEW_REQUIRED`, y el algoritmo lo
 * traduce a `REVISION_HUMANA`. La decisión se está tomando ahora, con alguien
 * delante del móvil: no puede quedarse colgada hasta que un analista mire una
 * foto. Lo que hace el artefacto es DECIR que hace falta esa mirada, y el front
 * pinta «estamos revisando tu documento» en vez de un error.
 *
 * ## Fail-closed
 *
 * La arista por defecto va a revisión humana, nunca a aprobar. Si el servicio
 * falla, si un código nuevo no está contemplado o si alguien añade una rama y se
 * olvida de conectarla, el caso acaba delante de una persona. La alternativa
 * —que un fallo del motor abra la puerta— no es un riesgo aceptable en un flujo
 * de identidad.
 *
 * Es una función PURA: devuelve el artefacto compilado sin tocar la base.
 */
import type {
  CompiledDecisionArtifact,
  GraphEdgeSnapshot,
  GraphNodeSnapshot,
  IntermediateVariableSnapshot,
  OutputContractFieldSnapshot,
  VariableContractSnapshot,
} from '../../graph/graph.types';

export const IDENTITY_MOBILE_CODE = 'IDENTIDAD_CARNET_MOVIL';
export const IDENTITY_MOBILE_VERSION = '1.0.0';

/** Nodo que hace la llamada. Se nombra aquí porque lo referencian las intermedias. */
const CALL_NODE = 'VERIFICAR_IDENTIDAD';

/**
 * Parecido mínimo para dejar entrar sin que nadie mire.
 *
 * **No es el umbral biométrico.** El worker ya aplicó el suyo, que está
 * calibrado contra una tasa de falsa aceptación y vive en
 * `IDENTITY_MATCH_THRESHOLD`. Esto es un segundo suelo, de negocio, para que la
 * política pueda ser más exigente que la calibración sin tocar la calibración —
 * que es de lo que trata separar el motor del worker—. Puesto en el mismo valor
 * que la calibración por defecto, no estorba; subirlo aquí es una decisión de
 * producto y se versiona como tal.
 */
const MIN_PARECIDO = 0.82;

/**
 * Evidencia mínima de que la imagen era un carnet.
 *
 * La puerta del worker ya rechaza lo que no lo es. Esto recoge el caso de un
 * documento aceptado justo por encima de su umbral: entra, se procesa, y aun así
 * merece una segunda mirada antes de dar por buena una identidad con él.
 */
const MIN_EVIDENCIA = 0.7;

export const IDENTITY_MOBILE_VARIABLES = {
  carnetFrente: 'identidad_carnet_frente_base64',
  carnetReverso: 'identidad_carnet_reverso_base64',
  selfie: 'identidad_selfie_base64',
  pais: 'identidad_pais_documento',
  decision: 'identidad_resultado',
  motivo: 'identidad_motivo',
  parecido: 'identidad_parecido',
  evidencia: 'identidad_evidencia_documento',
} as const;

const V = IDENTITY_MOBILE_VARIABLES;
const OUTPUT_CODES = new Set<string>([V.decision, V.motivo, V.parecido, V.evidencia]);
const PRIMARY_OUTPUT = V.decision;

export function isIdentityMobileOutput(code: string): boolean {
  return OUTPUT_CODES.has(code);
}

export function isIdentityMobilePrimaryOutput(code: string): boolean {
  return code === PRIMARY_OUTPUT;
}

export function buildIdentityMobileCompiled(
  artifact: { id: string; tenantId: string },
  version: { id: string },
  variableIds: Record<string, string>,
): CompiledDecisionArtifact {
  const nodes: GraphNodeSnapshot[] = [
    node('START', 'START', {
      label: 'Inicio',
      config: {
        description:
          'Recibe las fotos del carnet (anverso y, si la hay, reverso) y la selfie, en base64.',
      },
    }),
    node(CALL_NODE, 'WORKER', {
      label: 'Verificar el carnet contra la selfie',
      config: {
        description:
          'Llama al worker de identidad: lee el carnet, comprueba que lo sea, y compara su retrato con la selfie.',
        service: 'identity-verification',
        operation: 'verify',
        arguments: {
          documentBase64: { source: 'VARIABLE', path: V.carnetFrente },
          documentBackBase64: { source: 'VARIABLE', path: V.carnetReverso },
          selfieBase64: { source: 'VARIABLE', path: V.selfie },
          documentCountry: { source: 'VARIABLE', path: V.pais },
        },
        /*
         * `CONTINUE` y no `FAIL`: que la foto no sea un carnet es INFORMACIÓN
         * sobre la solicitud, no una avería del motor. Con `FAIL` la petición
         * terminaría en un error HTTP y el front móvil no tendría ni decisión ni
         * motivo que enseñar; así el algoritmo se queda con los valores por
         * defecto y decide con ellos, que es exactamente lo que haría una
         * persona con una foto equivocada en la mano.
         */
        onError: 'CONTINUE',
        // Holgado a propósito: el worker lee el documento, detecta dos rostros y
        // los compara, todo en el mismo proceso. Un tope corto convertiría un
        // teléfono lento en un rechazo.
        timeoutMs: 90_000,
        outputs: [
          { intermediateCode: 'id_estado_llamada', path: 'call.status', defaultValue: 'FAILED' },
          { intermediateCode: 'id_codigo_error', path: 'call.errorCode', defaultValue: '' },
          // `INCONCLUSIVE` por defecto y no `NOT_VERIFIED`: si la llamada no
          // llegó a producir veredicto, afirmar que la persona NO es quien dice
          // ser es afirmar algo que nadie comprobó.
          { intermediateCode: 'id_decision', path: 'result.decision', defaultValue: 'INCONCLUSIVE' },
          { intermediateCode: 'id_parecido', path: 'result.faceSimilarity', defaultValue: 0 },
          { intermediateCode: 'id_evidencia', path: 'result.documentEvidence', defaultValue: 0 },
          {
            intermediateCode: 'id_tipo_documento',
            path: 'result.documentType',
            defaultValue: 'UNKNOWN',
          },
          { intermediateCode: 'id_liveness', path: 'result.liveness', defaultValue: 'NOT_RUN' },
        ],
      },
    }),
    node('EVALUAR', 'CONDITION', {
      label: 'Decidir sobre la identidad',
      config: {
        description:
          'Traduce el veredicto técnico del worker a la decisión de negocio, con la política de este artefacto.',
      },
    }),
    resultNode('RECHAZAR_DOCUMENTO', 'Rechazar: no es un carnet', 'RECHAZADO', 'DOCUMENTO_NO_VALIDO'),
    resultNode('RECHAZAR_IDENTIDAD', 'Rechazar: no es la misma persona', 'RECHAZADO', 'IDENTIDAD_NO_COINCIDE'),
    resultNode('APROBAR', 'Verificado', 'VERIFICADO', 'IDENTIDAD_CONFIRMADA'),
    resultNode('REVISAR', 'A revisión humana', 'REVISION_HUMANA', 'REQUIERE_REVISION'),
  ];

  const edges: GraphEdgeSnapshot[] = [
    edge('E_START', 'START', CALL_NODE, [], true),
    edge('E_LLAMADA', CALL_NODE, 'EVALUAR', [], true),
    /*
     * El orden es la política, y no es intercambiable.
     *
     * 1. Que no sea un carnet se decide ANTES que nada: no hay identidad que
     *    comparar contra un documento que no existe, y la instrucción para quien
     *    está delante del móvil es distinta de todas las demás.
     * 2. Un no-parecido claro es un rechazo, aunque el documento fuera perfecto.
     * 3. Sólo lo que pasa las dos puertas Y supera los dos suelos de esta
     *    política se aprueba.
     * 4. Todo lo demás —incluida cualquier situación no contemplada— va a una
     *    persona. La arista por defecto NUNCA aprueba.
     */
    edge('E_DOC_INVALIDO', 'EVALUAR', 'RECHAZAR_DOCUMENTO', [{ code: 'DOCUMENTO_NO_VALIDO', order: 1 }], false, 1),
    edge('E_NO_COINCIDE', 'EVALUAR', 'RECHAZAR_IDENTIDAD', [{ code: 'IDENTIDAD_NO_COINCIDE', order: 1 }], false, 2),
    edge('E_APROBAR', 'EVALUAR', 'APROBAR', [{ code: 'IDENTIDAD_CONFIRMADA', order: 1 }], false, 3),
    edge('E_REVISAR', 'EVALUAR', 'REVISAR', [], true, 4),
  ];

  const ref = (code: string): { code: string; variableVersionId: string } => ({
    code,
    variableVersionId: variableIds[code] ?? code,
  });

  return {
    runtimeSchemaVersion: '1.2',
    compilerVersion: 'atlas-seed-identity-mobile-1.0.0',
    artifact: {
      id: artifact.id,
      tenantId: artifact.tenantId,
      code: IDENTITY_MOBILE_CODE,
      type: 'IDENTITY_POLICY',
      name: 'Verificación de identidad con carnet para el front móvil',
      riskDomain: 'IDENTITY_VERIFICATION',
    },
    version: {
      id: version.id,
      number: 1,
      semanticVersion: IDENTITY_MOBILE_VERSION,
      status: 'COMPILED',
    },
    variables: [
      /*
       * Las tres imágenes van marcadas como sensibles, y no es una etiqueta
       * decorativa: el motor deja de persistir su valor —guarda sólo su HMAC— y
       * de publicarlo en la traza de cada nodo. Sin ella, cada verificación
       * guardaría el carnet y la cara de una persona, en base64, dentro de
       * `decision_execution_variable`, y los repetiría en el estado de variables
       * de cada paso. Una traza se conserva años.
       */
      input(ref(V.carnetFrente), 'STRING', {}, { sensitive: true, sensitivityClass: 'RESTRICTED' }),
      input(
        ref(V.carnetReverso),
        'STRING',
        {},
        {
          sensitive: true,
          sensitivityClass: 'RESTRICTED',
          // El reverso es opcional de verdad: el carnet boliviano lleva la MRZ
          // detrás, pero un anverso legible basta para leer y comparar. Exigirlo
          // dejaría fuera capturas perfectamente válidas.
          required: false,
          nullable: true,
          fallbackPolicy: 'DEFAULT_VALUE',
        },
      ),
      input(ref(V.selfie), 'STRING', {}, { sensitive: true, sensitivityClass: 'RESTRICTED' }),
      input(ref(V.pais), 'STRING', { maxLength: 2 }),
      output(ref(V.decision), 'STRING', 'OUTPUT_PRIMARY'),
      output(ref(V.motivo), 'STRING', 'OUTPUT'),
      output(ref(V.parecido), 'DECIMAL', 'OUTPUT'),
      output(ref(V.evidencia), 'DECIMAL', 'OUTPUT'),
    ],
    intermediates: [
      intermediate('id_estado_llamada', 'Estado de la llamada al worker', 'STRING', CALL_NODE),
      intermediate('id_codigo_error', 'Código de error del worker', 'STRING', CALL_NODE),
      intermediate('id_decision', 'Veredicto técnico del worker', 'STRING', CALL_NODE),
      intermediate('id_parecido', 'Parecido entre el retrato y la selfie', 'DECIMAL', CALL_NODE),
      intermediate('id_evidencia', 'Evidencia de que la imagen es un carnet', 'DECIMAL', CALL_NODE),
      intermediate('id_tipo_documento', 'Tipo de documento reconocido', 'STRING', CALL_NODE),
      intermediate('id_liveness', 'Desenlace de la prueba de vida', 'STRING', CALL_NODE),
    ],
    outputContract: [
      contractField(V.decision, 'Decisión de identidad', 'NODE', 'EVALUAR'),
      contractField(V.motivo, 'Motivo de la decisión', 'NODE', 'EVALUAR'),
      contractField(V.parecido, 'Parecido biométrico', 'INTERMEDIATE', 'id_parecido'),
      contractField(V.evidencia, 'Evidencia de documento', 'INTERMEDIATE', 'id_evidencia'),
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
      DOCUMENTO_NO_VALIDO: {
        code: 'DOCUMENTO_NO_VALIDO',
        name: 'La imagen no es un carnet admisible',
        expressionType: 'JSON_AST',
        /*
         * Se enruta por el CÓDIGO del worker y no por su mensaje: el mensaje está
         * escrito para una persona y cambia cuando alguien lo mejora; el código es
         * el contrato. Los dos que se listan son los únicos rechazos de la puerta
         * de documentos, y son terminales por definición —el worker no los
         * reintenta—.
         */
        expression: {
          op: 'or',
          args: [
            {
              op: 'eq',
              left: { var: 'intermediate.id_codigo_error' },
              right: { value: 'IDENTITY_DOCUMENT_NOT_IDENTITY' },
            },
            {
              op: 'eq',
              left: { var: 'intermediate.id_codigo_error' },
              right: { value: 'IDENTITY_DOCUMENT_TYPE_NOT_ACCEPTED' },
            },
            {
              op: 'eq',
              left: { var: 'intermediate.id_codigo_error' },
              right: { value: 'IDENTITY_DOCUMENT_UNSUPPORTED' },
            },
          ],
        },
        severity: 'BLOCKING',
        reusable: false,
      },
      IDENTIDAD_NO_COINCIDE: {
        code: 'IDENTIDAD_NO_COINCIDE',
        name: 'El worker afirma que no es la misma persona',
        expressionType: 'JSON_AST',
        // `NOT_VERIFIED` es una afirmación, no una duda: el worker lo produce con
        // una prueba de vida fallida, un documento caducado o un no-parecido
        // claro. Mandarlo a revisión humana sería pedirle a alguien que revise una
        // conclusión que ya está tomada con evidencia.
        expression: {
          op: 'eq',
          left: { var: 'intermediate.id_decision' },
          right: { value: 'NOT_VERIFIED' },
        },
        severity: 'BLOCKING',
        reusable: false,
      },
      IDENTIDAD_CONFIRMADA: {
        code: 'IDENTIDAD_CONFIRMADA',
        name: 'Verificado por el worker y por encima de los suelos de esta política',
        expressionType: 'JSON_AST',
        expression: {
          op: 'and',
          args: [
            {
              op: 'eq',
              left: { var: 'intermediate.id_estado_llamada' },
              right: { value: 'SUCCEEDED' },
            },
            {
              op: 'eq',
              left: { var: 'intermediate.id_decision' },
              right: { value: 'VERIFIED' },
            },
            {
              op: 'gte',
              left: { var: 'intermediate.id_parecido' },
              right: { value: MIN_PARECIDO },
            },
            {
              op: 'gte',
              left: { var: 'intermediate.id_evidencia' },
              right: { value: MIN_EVIDENCIA },
            },
          ],
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
          outputCode: V.parecido,
          source: 'EXPRESSION',
          expression: { var: 'intermediate.id_parecido' },
        },
        {
          outputCode: V.evidencia,
          source: 'EXPRESSION',
          expression: { var: 'intermediate.id_evidencia' },
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
