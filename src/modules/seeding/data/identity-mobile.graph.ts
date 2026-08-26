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
/*
 * 1.1.0: el nodo REVISAR pasa de resultado terminal a `MANUAL_REVIEW`.
 *
 * Hasta 1.0.0 el artefacto decía «revisión humana» y no creaba la revisión: el caso
 * no entraba en ninguna cola y el expediente esperaba a un analista al que nadie
 * avisó. Cambiar el grafo cambia la decisión, así que va con versión propia —el
 * sembrado sólo publica cuando la versión semántica es nueva, y así queda registrado
 * contra qué versión se decidió cada expediente.
 */
/*
 * 1.2.0: el artefacto deja de decidir sólo con el carnet.
 *
 * Tres piezas nuevas, y las tres responden al mismo agujero: el veredicto salía
 * de UNA fuente —lo que el worker leyó en la foto— y una foto es exactamente lo
 * que un suplantador puede conseguir. Ahora entran además:
 *
 * - la AUTENTICIDAD del documento medida por el worker (`fraudVerdict`), que es
 *   otra pregunta que la lectura no contesta;
 * - el REGISTRO ESTATAL (SEGIP), que es la única fuente que puede afirmar que el
 *   número existe y corresponde a quien dice;
 * - la AGENDA del teléfono, en agregados sin datos personales, que es lo que
 *   distingue un teléfono de una persona de un terminal recién comprado para
 *   abrir una cuenta.
 *
 * Ninguna de las tres puede aprobar por su cuenta y todas pueden escalar. Es
 * deliberado: sumar fuentes tiene que endurecer la puerta, nunca abrirla.
 */
export const IDENTITY_MOBILE_VERSION = '1.2.0';

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

/**
 * Riesgo de la agenda por encima del cual el alta no se aprueba sola.
 *
 * El puntaje lo calcula el nodo `ANALIZAR_AGENDA` sobre cien, y 60 es donde se
 * juntan al menos dos señales fuertes —una agenda diminuta y ninguna referencia
 * dentro de ella, por ejemplo—. Una sola señal NUNCA llega: tener pocos
 * contactos no es un delito, y con un umbral más bajo el producto empezaría a
 * mandar a revisión a quien acaba de estrenar teléfono.
 */
const MAX_RIESGO_AGENDA = 60;

/**
 * Los estados del registro estatal que se consideran confirmación.
 *
 * `FOUND` es el único que afirma algo. `DATA_NOT_AVAILABLE` y
 * `PROVIDER_UNAVAILABLE` NO son un rechazo —el registro no contestó, que no es
 * lo mismo que contestar que no— y por eso van a revisión y no a la rama de
 * rechazo. `NOT_FOUND` y `PARTIAL_MATCH` tampoco se rechazan solos: un
 * homónimo, una tilde y un apellido compuesto producen coincidencias parciales
 * sobre personas perfectamente reales, y cerrarle el producto a alguien por la
 * ortografía de un registro ajeno es el falso positivo más caro de este flujo.
 */
const SEGIP_CONFIRMA = 'FOUND';

export const IDENTITY_MOBILE_VARIABLES = {
  carnetFrente: 'identidad_carnet_frente_base64',
  carnetReverso: 'identidad_carnet_reverso_base64',
  selfie: 'identidad_selfie_base64',
  pais: 'identidad_pais_documento',
  /*
   * Lo que dice el REGISTRO ESTATAL sobre el número declarado.
   *
   * Lo consulta AtlasBackend contra SEGIP antes de pedir la decisión y lo pasa
   * ya normalizado. No lo consulta el motor: el motor no tiene las credenciales
   * del proveedor ni debe tenerlas, y una llamada a un tercero dentro del camino
   * de decisión ataría cada verificación a la disponibilidad de ese tercero.
   */
  segipEstado: 'identidad_segip_estado',
  segipCoincidencia: 'identidad_segip_coincidencia',
  /*
   * La AGENDA, en agregados y sin un solo dato personal.
   *
   * No entra ni un nombre, ni un teléfono, ni un hash reversible: entran seis
   * números que describen la FORMA de la agenda. Es la diferencia entre analizar
   * el riesgo de un alta y copiarse la libreta de direcciones de alguien, y es
   * la única versión de esta señal que se puede defender ante quien la firma.
   */
  agendaDisponible: 'identidad_agenda_disponible',
  agendaTotal: 'identidad_agenda_total',
  agendaUnicosRatio: 'identidad_agenda_unicos_ratio',
  agendaBoliviaRatio: 'identidad_agenda_bolivia_ratio',
  agendaReferenciasPresentes: 'identidad_agenda_referencias_presentes',
  agendaCoincidenciasRiesgo: 'identidad_agenda_coincidencias_riesgo',
  decision: 'identidad_resultado',
  motivo: 'identidad_motivo',
  parecido: 'identidad_parecido',
  evidencia: 'identidad_evidencia_documento',
  fraude: 'identidad_riesgo_fraude',
  riesgoAgenda: 'identidad_riesgo_agenda',
} as const;

const V = IDENTITY_MOBILE_VARIABLES;
const OUTPUT_CODES = new Set<string>([
  V.decision,
  V.motivo,
  V.parecido,
  V.evidencia,
  V.fraude,
  V.riesgoAgenda,
]);
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
          {
            intermediateCode: 'id_decision',
            path: 'result.decision',
            defaultValue: 'INCONCLUSIVE',
          },
          { intermediateCode: 'id_parecido', path: 'result.faceSimilarity', defaultValue: 0 },
          { intermediateCode: 'id_evidencia', path: 'result.documentEvidence', defaultValue: 0 },
          {
            intermediateCode: 'id_tipo_documento',
            path: 'result.documentType',
            defaultValue: 'UNKNOWN',
          },
          { intermediateCode: 'id_liveness', path: 'result.liveness', defaultValue: 'NOT_RUN' },
          /*
           * La AUTENTICIDAD del documento, que es otra pregunta que la lectura
           * no contesta: el texto de una falsificación es el de un documento
           * auténtico porque se copió de uno.
           *
           * El valor por defecto es `UNKNOWN` y no `CLEAR`, y ahí está toda la
           * política: si la llamada no llegó a producir análisis, afirmar que el
           * documento es auténtico sería afirmar algo que nadie comprobó. La
           * condición de aprobación exige `CLEAR` explícito, así que un `UNKNOWN`
           * cae por la arista por defecto y termina delante de una persona.
           */
          {
            intermediateCode: 'id_fraude_veredicto',
            path: 'result.fraudVerdict',
            defaultValue: 'UNKNOWN',
          },
          { intermediateCode: 'id_fraude_riesgo', path: 'result.fraudRisk', defaultValue: 0 },
        ],
      },
    }),
    /*
     * El análisis de la AGENDA, dentro del artefacto y no en el backend.
     *
     * Podría calcularse antes de llamar, y sería más cómodo. Se hace aquí por lo
     * mismo que todo lo demás de este archivo: es POLÍTICA. Cuántos contactos son
     * pocos, cuánto pesa que las referencias declaradas no estén en la agenda y
     * a partir de qué puntaje deja de aprobarse solo son decisiones de negocio
     * que cambian, y tienen que cambiar con versión, aprobación y traza en vez de
     * con un despliegue de AtlasBackend.
     *
     * El nodo es de tipo SCORE para que el puntaje y QUÉ componentes se aplicaron
     * queden en la traza de la ejecución. Un número sin sus componentes no se
     * puede discutir, y este número puede mandar a una persona a revisar un caso.
     *
     * Escala de 0 a 100. Ninguna señal sola llega al umbral (60): tener pocos
     * contactos no es un delito, y con una sola señal bastando el producto
     * mandaría a revisión a quien acaba de estrenar teléfono.
     */
    node('ANALIZAR_AGENDA', 'SCORE', {
      label: 'Analizar la agenda del teléfono',
      config: {
        description:
          'Puntúa la forma de la agenda: tamaño, duplicados, arraigo local, si las referencias declaradas están dentro y si hay coincidencias con teléfonos ya marcados.',
        baseScore: 0,
        components: [
          { conditionCode: 'AGENDA_NO_COMPARTIDA', points: 20 },
          { conditionCode: 'AGENDA_MUY_PEQUENA', points: 30 },
          { conditionCode: 'AGENDA_DUPLICADA', points: 15 },
          { conditionCode: 'AGENDA_SIN_ARRAIGO', points: 20 },
          { conditionCode: 'REFERENCIAS_FUERA_DE_AGENDA', points: 25 },
          { conditionCode: 'AGENDA_CON_TELEFONOS_MARCADOS', points: 45 },
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
    resultNode(
      'RECHAZAR_DOCUMENTO',
      'Rechazar: no es un carnet',
      'RECHAZADO',
      'DOCUMENTO_NO_VALIDO',
    ),
    resultNode(
      'RECHAZAR_IDENTIDAD',
      'Rechazar: no es la misma persona',
      'RECHAZADO',
      'IDENTIDAD_NO_COINCIDE',
    ),
    resultNode('APROBAR', 'Verificado', 'VERIFICADO', 'IDENTIDAD_CONFIRMADA'),
    /*
     * «A revisión humana» tiene que CREAR la revisión humana.
     *
     * Este nodo era un resultado terminal como los otros tres: escribía
     * `REVISION_HUMANA` en la salida y ahí terminaba. La consecuencia es que el
     * veredicto decía «que lo mire una persona» y no había nada que mirar — el caso
     * no entraba en ninguna cola, así que el expediente se quedaba esperando a un
     * analista al que nadie avisó. Medido: la ejecución 28 salió REVISION_HUMANA y
     * `decision_manual_review_case` siguió con los cuatro casos sembrados.
     *
     * `MANUAL_REVIEW` es el tipo de nodo que el motor traduce a un caso encolado
     * (`execution-writer.service.ts`). La cola es IDENTIDAD, que es la que ya existe
     * y la que la pantalla de revisión filtra.
     *
     * El SLA de 240 minutos es el mismo que el resto de identidad: un alta detenida
     * es una persona esperando, no un expediente en un cajón.
     */
    /*
     * La sospecha de fraude tiene COLA PROPIA, prioridad y motivo propios.
     *
     * Podría caer en `REVISAR` con todo lo demás y sería un error de producto: un
     * caso que llega ahí porque la foto salió movida y uno que llega porque el
     * documento parece falsificado necesitan analistas distintos, en tiempos
     * distintos y con instrucciones distintas. Mezclarlos hace que el segundo
     * espere detrás del primero, que es exactamente al revés de lo que conviene.
     *
     * SLA de 60 minutos frente a los 240 del resto, y prioridad 10 frente a 50.
     * Nunca se rechaza automáticamente: acusar a alguien de falsificar un
     * documento es una decisión con consecuencias legales, y la firma una
     * persona.
     */
    node('REVISAR_FRAUDE', 'MANUAL_REVIEW', {
      label: 'A revisión: sospecha de fraude documental',
      terminal: true,
      config: {
        mode: 'MAPPING',
        assignments: [
          { outputCode: V.decision, source: 'LITERAL', value: 'REVISION_HUMANA' },
          { outputCode: V.motivo, source: 'LITERAL', value: 'SOSPECHA_DE_FRAUDE' },
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
          {
            outputCode: V.fraude,
            source: 'EXPRESSION',
            expression: { var: 'intermediate.id_fraude_riesgo' },
          },
          {
            outputCode: V.riesgoAgenda,
            source: 'EXPRESSION',
            expression: { op: 'div', left: { var: 'decision.score' }, right: { value: 100 } },
          },
        ],
        queueCode: 'IDENTIDAD',
        priority: 10,
        slaMinutes: 60,
        evidence: {
          motivo: 'SOSPECHA_DE_FRAUDE',
          veredictoDeFraude: '{{intermediate.id_fraude_veredicto}}',
          riesgoDeFraude: '{{intermediate.id_fraude_riesgo}}',
          tipoDocumento: '{{intermediate.id_tipo_documento}}',
          parecido: '{{intermediate.id_parecido}}',
          pruebaDeVida: '{{intermediate.id_liveness}}',
          registroEstatal: '{{identidad_segip_estado}}',
          riesgoDeAgenda: '{{decision.score}}',
        },
      },
    }),
    node('REVISAR', 'MANUAL_REVIEW', {
      label: 'A revisión humana',
      terminal: true,
      config: {
        /*
         * Las salidas se siguen escribiendo AQUÍ.
         *
         * Al convertir este nodo de `RESULT` a `MANUAL_REVIEW` se perdieron las
         * asignaciones que hacía el resultado terminal, y la ejecución terminaba sin
         * `identidad_resultado` —salida obligatoria del artefacto—, así que el motor
         * la rechazaba con `REQUIRED_OUTPUT_MISSING` y el móvil veía UNAVAILABLE.
         * Encolar el caso y responder al que llama son dos cosas distintas: hay que
         * hacer las dos.
         */
        mode: 'MAPPING',
        assignments: [
          { outputCode: V.decision, source: 'LITERAL', value: 'REVISION_HUMANA' },
          { outputCode: V.motivo, source: 'LITERAL', value: 'REQUIERE_REVISION' },
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
          {
            outputCode: V.fraude,
            source: 'EXPRESSION',
            expression: { var: 'intermediate.id_fraude_riesgo' },
          },
          {
            outputCode: V.riesgoAgenda,
            source: 'EXPRESSION',
            expression: { op: 'div', left: { var: 'decision.score' }, right: { value: 100 } },
          },
        ],
        queueCode: 'IDENTIDAD',
        priority: 50,
        slaMinutes: 240,
        /*
         * La evidencia viaja con el caso para que quien lo abra vea POR QUÉ llegó sin
         * tener que reconstruirlo: el parecido medido, qué documento se reconoció y
         * qué dijo la prueba de vida.
         */
        evidence: {
          motivo: 'REQUIERE_REVISION',
          parecido: '{{intermediate.id_parecido}}',
          tipoDocumento: '{{intermediate.id_tipo_documento}}',
          pruebaDeVida: '{{intermediate.id_liveness}}',
          decisionDelWorker: '{{intermediate.id_decision}}',
          veredictoDeFraude: '{{intermediate.id_fraude_veredicto}}',
          riesgoDeFraude: '{{intermediate.id_fraude_riesgo}}',
          registroEstatal: '{{identidad_segip_estado}}',
          riesgoDeAgenda: '{{decision.score}}',
        },
      },
    }),
  ];

  const edges: GraphEdgeSnapshot[] = [
    edge('E_START', 'START', CALL_NODE, [], true),
    edge('E_LLAMADA', CALL_NODE, 'ANALIZAR_AGENDA', [], true),
    edge('E_AGENDA', 'ANALIZAR_AGENDA', 'EVALUAR', [], true),
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
    edge(
      'E_DOC_INVALIDO',
      'EVALUAR',
      'RECHAZAR_DOCUMENTO',
      [{ code: 'DOCUMENTO_NO_VALIDO', order: 1 }],
      false,
      1,
    ),
    edge(
      'E_NO_COINCIDE',
      'EVALUAR',
      'RECHAZAR_IDENTIDAD',
      [{ code: 'IDENTIDAD_NO_COINCIDE', order: 1 }],
      false,
      2,
    ),
    /*
     * La sospecha de fraude se desvía ANTES de intentar aprobar.
     *
     * Su condición no puede alcanzar nunca a la de aprobación —`CLEAR` explícito
     * es requisito para aprobar— así que el orden no cambia el resultado; cambia
     * el MOTIVO y la cola. Sin esta arista, un documento sospechoso caería por la
     * arista por defecto y llegaría a la bandeja general etiquetado como «hay que
     * mirarlo», que es cierto y es inútil: no dice qué mirar.
     */
    edge(
      'E_FRAUDE',
      'EVALUAR',
      'REVISAR_FRAUDE',
      [{ code: 'SOSPECHA_DE_FRAUDE', order: 1 }],
      false,
      3,
    ),
    edge('E_APROBAR', 'EVALUAR', 'APROBAR', [{ code: 'IDENTIDAD_CONFIRMADA', order: 1 }], false, 4),
    edge('E_REVISAR', 'EVALUAR', 'REVISAR', [], true, 5),
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
      /*
       * Las ocho entradas nuevas son OPCIONALES, y las ocho llevan un valor por
       * defecto que empeora la decisión en vez de mejorarla.
       *
       * Opcionales porque un llamante que todavía no las manda —una versión
       * anterior de AtlasBackend, una prueba, el laboratorio— tiene que poder
       * seguir pidiendo una decisión. Con `FAIL_CLOSED` la ejecución entera se
       * caería y el móvil vería UNAVAILABLE, que es peor que decidir con menos
       * fuentes.
       *
       * Y el valor por defecto no es neutro: `NO_CONSULTADO` NO satisface la
       * condición de aprobación —que exige `FOUND` explícito— y
       * `agenda_disponible: false` suma sus veinte puntos. Omitir una entrada
       * empuja el caso hacia la revisión humana, nunca hacia la aprobación, que
       * es la única forma segura de que una entrada opcional lo sea.
       */
      input(
        ref(V.segipEstado),
        'STRING',
        {},
        { required: false, nullable: true, fallbackPolicy: 'DEFAULT_VALUE', defaultValue: 'NO_CONSULTADO' },
      ),
      input(
        ref(V.segipCoincidencia),
        'DECIMAL',
        {},
        { required: false, nullable: true, fallbackPolicy: 'DEFAULT_VALUE', defaultValue: 0 },
      ),
      input(
        ref(V.agendaDisponible),
        'BOOLEAN',
        {},
        { required: false, nullable: true, fallbackPolicy: 'DEFAULT_VALUE', defaultValue: false },
      ),
      input(
        ref(V.agendaTotal),
        'INTEGER',
        {},
        { required: false, nullable: true, fallbackPolicy: 'DEFAULT_VALUE', defaultValue: 0 },
      ),
      input(
        ref(V.agendaUnicosRatio),
        'DECIMAL',
        {},
        { required: false, nullable: true, fallbackPolicy: 'DEFAULT_VALUE', defaultValue: 0 },
      ),
      input(
        ref(V.agendaBoliviaRatio),
        'DECIMAL',
        {},
        { required: false, nullable: true, fallbackPolicy: 'DEFAULT_VALUE', defaultValue: 0 },
      ),
      input(
        ref(V.agendaReferenciasPresentes),
        'INTEGER',
        {},
        { required: false, nullable: true, fallbackPolicy: 'DEFAULT_VALUE', defaultValue: 0 },
      ),
      input(
        ref(V.agendaCoincidenciasRiesgo),
        'INTEGER',
        {},
        { required: false, nullable: true, fallbackPolicy: 'DEFAULT_VALUE', defaultValue: 0 },
      ),
      output(ref(V.decision), 'STRING', 'OUTPUT_PRIMARY'),
      output(ref(V.motivo), 'STRING', 'OUTPUT'),
      output(ref(V.parecido), 'DECIMAL', 'OUTPUT'),
      output(ref(V.evidencia), 'DECIMAL', 'OUTPUT'),
      output(ref(V.fraude), 'DECIMAL', 'OUTPUT'),
      output(ref(V.riesgoAgenda), 'DECIMAL', 'OUTPUT'),
    ],
    intermediates: [
      intermediate('id_estado_llamada', 'Estado de la llamada al worker', 'STRING', CALL_NODE),
      intermediate('id_codigo_error', 'Código de error del worker', 'STRING', CALL_NODE),
      intermediate('id_decision', 'Veredicto técnico del worker', 'STRING', CALL_NODE),
      intermediate('id_parecido', 'Parecido entre el retrato y la selfie', 'DECIMAL', CALL_NODE),
      intermediate('id_evidencia', 'Evidencia de que la imagen es un carnet', 'DECIMAL', CALL_NODE),
      intermediate('id_tipo_documento', 'Tipo de documento reconocido', 'STRING', CALL_NODE),
      intermediate('id_liveness', 'Desenlace de la prueba de vida', 'STRING', CALL_NODE),
      intermediate('id_fraude_veredicto', 'Autenticidad del documento', 'STRING', CALL_NODE),
      intermediate('id_fraude_riesgo', 'Riesgo de fraude documental', 'DECIMAL', CALL_NODE),
    ],
    outputContract: [
      contractField(V.decision, 'Decisión de identidad', 'NODE', 'EVALUAR'),
      contractField(V.motivo, 'Motivo de la decisión', 'NODE', 'EVALUAR'),
      contractField(V.parecido, 'Parecido biométrico', 'INTERMEDIATE', 'id_parecido'),
      contractField(V.evidencia, 'Evidencia de documento', 'INTERMEDIATE', 'id_evidencia'),
      contractField(V.fraude, 'Riesgo de fraude documental', 'INTERMEDIATE', 'id_fraude_riesgo'),
      contractField(V.riesgoAgenda, 'Riesgo de la agenda', 'NODE', 'ANALIZAR_AGENDA'),
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
            /*
             * `CLEAR` EXPLÍCITO, y no «distinto de sospechoso».
             *
             * Es la diferencia entre exigir una prueba y aceptar su ausencia. El
             * valor por defecto del intermedio es `UNKNOWN` —la llamada no llegó a
             * producir análisis— y con `neq FRAUD_SUSPECTED` ese `UNKNOWN`
             * aprobaría. Aquí no aprueba: cae por la arista por defecto y termina
             * delante de una persona, que es lo que hay que hacer con un documento
             * cuya autenticidad no se comprobó.
             */
            {
              op: 'eq',
              left: { var: 'intermediate.id_fraude_veredicto' },
              right: { value: 'CLEAR' },
            },
            /*
             * El registro estatal tiene que CONFIRMAR.
             *
             * Cualquier otro estado —no encontrado, coincidencia parcial, registro
             * caído— manda el caso a una persona en vez de rechazarlo. Un homónimo,
             * una tilde o un apellido compuesto producen coincidencias parciales
             * sobre gente perfectamente real, y cerrarle el producto a alguien por
             * la ortografía de un registro ajeno es el falso positivo más caro de
             * este flujo.
             */
            {
              op: 'eq',
              left: { var: V.segipEstado },
              right: { value: SEGIP_CONFIRMA },
            },
            {
              op: 'lt',
              left: { var: 'decision.score' },
              right: { value: MAX_RIESGO_AGENDA },
            },
          ],
        },
        severity: 'BLOCKING',
        reusable: false,
      },
      /*
       * La sospecha de fraude documental, tal como la firma el worker.
       *
       * Se enruta por el VEREDICTO y no por el riesgo numérico, aunque los dos
       * viajen: el umbral que convierte un riesgo en sospecha vive en el worker,
       * calibrado contra su propia población, y duplicarlo aquí crearía dos
       * verdades que se separarían en el primer recalibrado. Lo que este artefacto
       * decide es QUÉ HACER con la sospecha, que es su trabajo.
       */
      SOSPECHA_DE_FRAUDE: {
        code: 'SOSPECHA_DE_FRAUDE',
        name: 'El worker sospecha que el documento está falsificado',
        expressionType: 'JSON_AST',
        expression: {
          op: 'eq',
          left: { var: 'intermediate.id_fraude_veredicto' },
          right: { value: 'FRAUD_SUSPECTED' },
        },
        severity: 'BLOCKING',
        reusable: false,
      },

      /*
       * ── Los seis componentes del análisis de la agenda ──────────────────
       *
       * Cada uno describe UNA forma de agenda que se ve en las altas
       * fraudulentas, y ninguno acusa por su cuenta: los puntos están puestos
       * para que hagan falta dos para llegar al umbral. La justificación de cada
       * peso va en su propio comentario, porque un puntaje sin justificación se
       * acaba moviendo hasta que pase el caso que molestó ese día.
       */
      AGENDA_NO_COMPARTIDA: {
        code: 'AGENDA_NO_COMPARTIDA',
        name: 'La persona no compartió su agenda',
        expressionType: 'JSON_AST',
        /*
         * No compartirla NO es una señal de fraude: es un permiso que se puede
         * negar, y negarlo es legítimo. Suma 20 —un tercio del umbral, imposible
         * de alcanzar sola— porque lo que hay es MENOS EVIDENCIA, no evidencia en
         * contra. Puntuarlo alto convertiría un derecho en una penalización y
         * empujaría a la app a pedir el permiso de formas que no debería.
         */
        expression: { op: 'eq', left: { var: V.agendaDisponible }, right: { value: false } },
        severity: 'ADVISORY',
        reusable: false,
      },
      AGENDA_MUY_PEQUENA: {
        code: 'AGENDA_MUY_PEQUENA',
        name: 'La agenda tiene muy pocos contactos',
        expressionType: 'JSON_AST',
        /*
         * Quince contactos. Un teléfono comprado para abrir una cuenta tiene los
         * de la operadora y poco más; uno de una persona que vive con él tiene
         * decenas. El corte va bajo a propósito: hay gente que estrena teléfono y
         * no restaura la copia, y por eso esto solo no llega al umbral.
         */
        expression: {
          op: 'and',
          args: [
            { op: 'eq', left: { var: V.agendaDisponible }, right: { value: true } },
            { op: 'lt', left: { var: V.agendaTotal }, right: { value: 15 } },
          ],
        },
        severity: 'ADVISORY',
        reusable: false,
      },
      AGENDA_DUPLICADA: {
        code: 'AGENDA_DUPLICADA',
        name: 'La agenda repite los mismos números',
        expressionType: 'JSON_AST',
        /*
         * Menos del 60 % de números distintos. Una agenda inflada a mano para
         * parecer usada repite el mismo número con nombres distintos; una agenda
         * real duplica algo —el trabajo y el móvil de la misma persona— pero no
         * cuatro de cada diez.
         */
        expression: {
          op: 'and',
          args: [
            { op: 'eq', left: { var: V.agendaDisponible }, right: { value: true } },
            { op: 'lt', left: { var: V.agendaUnicosRatio }, right: { value: 0.6 } },
          ],
        },
        severity: 'ADVISORY',
        reusable: false,
      },
      AGENDA_SIN_ARRAIGO: {
        code: 'AGENDA_SIN_ARRAIGO',
        name: 'Casi ningún contacto es boliviano',
        expressionType: 'JSON_AST',
        /*
         * Menos del 30 % de números con prefijo boliviano en un alta de un
         * producto que sólo opera en Bolivia. No prueba nada por sí solo —hay
         * residentes extranjeros con la agenda de su país— y por eso suma 20; lo
         * que hace es reforzar a las otras cuando aparecen juntas.
         */
        expression: {
          op: 'and',
          args: [
            { op: 'eq', left: { var: V.agendaDisponible }, right: { value: true } },
            { op: 'lt', left: { var: V.agendaBoliviaRatio }, right: { value: 0.3 } },
          ],
        },
        severity: 'ADVISORY',
        reusable: false,
      },
      REFERENCIAS_FUERA_DE_AGENDA: {
        code: 'REFERENCIAS_FUERA_DE_AGENDA',
        name: 'Ninguna referencia declarada está en la agenda',
        expressionType: 'JSON_AST',
        /*
         * La señal más informativa de las seis, y la que justifica pedir la
         * agenda.
         *
         * Quien declara como referencias a dos personas cuyos teléfonos NO tiene
         * guardados está declarando a gente con la que no habla. En un alta
         * legítima ocurre —se teclea el número de memoria y sale con un dígito
         * cambiado— y por eso suma 25 y no más: hace falta una segunda señal.
         */
        expression: {
          op: 'and',
          args: [
            { op: 'eq', left: { var: V.agendaDisponible }, right: { value: true } },
            { op: 'eq', left: { var: V.agendaReferenciasPresentes }, right: { value: 0 } },
          ],
        },
        severity: 'ADVISORY',
        reusable: false,
      },
      AGENDA_CON_TELEFONOS_MARCADOS: {
        code: 'AGENDA_CON_TELEFONOS_MARCADOS',
        name: 'La agenda contiene teléfonos ya marcados por riesgo',
        expressionType: 'JSON_AST',
        /*
         * 45 puntos: es la única que se acerca sola al umbral, y aun así no lo
         * cruza. La coincidencia la calcula AtlasBackend contra sus propios
         * expedientes —nunca contra una lista comprada— y una coincidencia sola
         * puede ser el vecino de alguien. Dos, o una con cualquier otra señal, ya
         * merece que lo mire una persona.
         */
        expression: {
          op: 'and',
          args: [
            { op: 'eq', left: { var: V.agendaDisponible }, right: { value: true } },
            { op: 'gte', left: { var: V.agendaCoincidenciasRiesgo }, right: { value: 1 } },
          ],
        },
        severity: 'ADVISORY',
        reusable: false,
      },
    },
    actions: {},
    totals: { nodes: nodes.length, edges: edges.length, terminalPaths: 5 },
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
        {
          outputCode: V.fraude,
          source: 'EXPRESSION',
          expression: { var: 'intermediate.id_fraude_riesgo' },
        },
        /*
         * El puntaje de la agenda se publica NORMALIZADO a `[0, 1]`.
         *
         * El nodo SCORE trabaja sobre cien porque es la escala en la que se
         * escriben y se discuten los componentes; la salida del artefacto va en
         * la misma escala que los otros dos riesgos que publica, para que quien
         * la lea no tenga que recordar cuál de los tres estaba en porcentaje.
         */
        {
          outputCode: V.riesgoAgenda,
          source: 'EXPRESSION',
          expression: { op: 'div', left: { var: 'decision.score' }, right: { value: 100 } },
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
