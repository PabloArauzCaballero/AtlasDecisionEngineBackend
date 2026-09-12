import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { managementHeaders } from './headers';
import { seededVariableVersionId } from './seeded-variables';

/**
 * Provisiona `BNPL_CREDIT_DECISION` si no está desplegado, por la API del producto.
 *
 * ## Por qué existe
 *
 * Dos suites —`runtime` y `sample-inputs`— ejecutan decisiones REALES contra este artefacto, y
 * hasta ahora sólo existía en el conjunto sembrado que publica una base del VPS. Un runner de CI
 * no la alcanza, así que esas pruebas fallaban con 404 en una batería por lo demás sana, y el 404
 * se leía como «el motor no encuentra la ruta» cuando lo que faltaba era el ARTEFACTO.
 *
 * Se construye por HTTP y no a golpe de `INSERT`: crear a mano la versión, el grafo, el compilado
 * y el despliegue significaría escribir en la base un estado que el producto nunca produciría, y
 * la prueba dejaría de medir el camino que de verdad se recorre. Aquí, si el alta, la validación,
 * la compilación, el gobierno o el despliegue se rompen, estas pruebas lo dicen antes que nadie.
 *
 * ## Lo que decide, y por qué así
 *
 * Tres desenlaces, que son los que las suites afirman:
 *
 *   KYC no verificado o sin consentimiento  → DECLINED, con `KYC_OR_CONSENT_INVALID`
 *   Persona políticamente expuesta          → MANUAL_REVIEW
 *   El resto                                → APPROVED, con un límite mayor que cero
 *
 * El orden importa: el rechazo por identidad va ANTES que la revisión por exposición política,
 * porque a quien no ha verificado su identidad no se le abre una cola —se le pide que la
 * verifique—.
 *
 * ## Y por qué declara probabilidad de incumplimiento
 *
 * Porque despliega a PRODUCCIÓN y `decisionKind` es `ORIGINATION` por omisión: la compuerta
 * económica exige que un artefacto que origina crédito publique su PD, y tiene razón —lo que no
 * declara PD no se puede calibrar ni vigilar—. Declararla aquí no es un trámite para pasar el
 * gate: es lo que hace que este artefacto de prueba se parezca a uno de verdad.
 */
const CODIGO = 'BNPL_CREDIT_DECISION';

/** Un artefacto desplegado sirve a todas las suites de la corrida: sólo se provisiona una vez. */
let provisionado: Promise<void> | null = null;

export function provisionDemoArtifact(app: INestApplication): Promise<void> {
  provisionado ??= provisionar(app);
  return provisionado;
}

async function provisionar(app: INestApplication): Promise<void> {
  const server = () => app.getHttpServer();
  const autor = managementHeaders('e2e.demo-author', ['RISK_ANALYST']);
  const qa = managementHeaders('e2e.demo-qa', ['QA_ANALYST']);
  const riesgo = managementHeaders('e2e.demo-risk', ['RISK_APPROVER']);
  const desplegador = managementHeaders('e2e.demo-admin', ['PLATFORM_ADMIN']);

  /*
   * Idempotente y capaz de RETOMAR, que no es lo mismo.
   *
   * La primera versión se rendía en cuanto encontraba el artefacto, y eso dejaba un estado
   * peor que ninguno: si una corrida anterior lo creó y murió antes de desplegarlo, la
   * siguiente se lo saltaba y las pruebas seguían viendo 404. Aquí cada paso se intenta y se
   * tolera el «ya estaba»: crear, escribir el grafo, compilar, gobernar y desplegar.
   *
   * Se busca por el LISTADO y no por `/v1/artifacts/:id`, que espera un identificador numérico:
   * pedirle un código no devuelve «no existe», devuelve otra cosa.
   */
  const listado = await request(server())
    .get('/v1/artifacts')
    .query({ search: CODIGO, pageSize: 50 })
    .set(autor);
  const yaCreado = (
    (listado.body?.items ?? []) as Array<{ artifactCode?: string; id?: string }>
  ).find((item) => item.artifactCode === CODIGO);

  let versionId: string;
  let lockVersion = 1;
  if (yaCreado?.id) {
    const detalle = await request(server())
      .get(`/v1/artifacts/${yaCreado.id}`)
      .set(autor)
      .expect(200);
    const version = detalle.body.versions?.[0] as
      { id: string; status: string; lockVersion?: number } | undefined;
    if (!version) throw new Error(`${CODIGO} existe pero no tiene ninguna versión.`);
    /*
     * Los estados de despliegue llevan el ambiente en el nombre —`DEPLOYED_TO_PROD`, `_DEV`,
     * `_STAGING`—, y esperar un genérico «DEPLOYED» hacía que una versión ya publicada se tomara
     * por editable: el fixture intentaba reescribir su grafo y recibía `VERSION_IMMUTABLE`.
     *
     * En producción no hay nada que retomar. En DEV o STAGING falta subir el escalón, así que se
     * salta directo al despliegue sin tocar el grafo, que ya es inmutable.
     */
    if (version.status === 'DEPLOYED_TO_PROD') return;
    versionId = version.id;
    lockVersion = version.lockVersion ?? 1;
    if (version.status.startsWith('DEPLOYED_TO_') || version.status === 'APPROVED') {
      await desplegar(app, versionId, desplegador);
      return;
    }
  } else {
    const artefacto = await request(server())
      .post('/v1/artifacts')
      .set(autor)
      .send({
        artifactCode: CODIGO,
        artifactType: 'CREDIT_POLICY',
        name: 'Decisión de crédito BNPL',
        ownerTeam: 'RISK_DECISIONING',
        businessPurpose:
          'Artefacto de demostración que ejercitan las pruebas de extremo a extremo.',
        riskDomain: 'CREDIT_ORIGINATION',
      })
      .expect(201);
    versionId = artefacto.body.versions[0].id as string;
  }

  /*
   * Todas las variables que el grafo LEE y ESCRIBE, declaradas.
   *
   * El validador rechaza una condición que nombra una variable no declarada, y con razón: si no
   * está en el contrato, nadie sabe de dónde sale ni qué pasa cuando falta. Los tipos importan —
   * `kyc_status` es texto y `consent_active` booleano— porque el motor los comprueba al resolver.
   */
  const variables = {
    age: await seededVariableVersionId(app, autor, 'age', 'INTEGER'),
    kyc_status: await seededVariableVersionId(app, autor, 'kyc_status', 'STRING'),
    consent_active: await seededVariableVersionId(app, autor, 'consent_active', 'BOOLEAN'),
    pep_status: await seededVariableVersionId(app, autor, 'pep_status', 'BOOLEAN'),
    /*
     * `disposable_income` y no `monthly_income`, y lo decide un contrato que ya existía:
     * `smoke/demo-applicant.json` —el solicitante canónico que usan el humo del runtime y el
     * ejemplo del manual— declara 56 variables, y el ingreso que trae es el DISPONIBLE. Pidiendo el
     * mensual, este artefacto contestaba `VARIABLE_MISSING_OR_INVALID` a la petición documentada.
     * Para un límite de crédito el disponible es además la magnitud correcta: es lo que queda
     * después de los compromisos, no lo que entra.
     */
    disposable_income: await seededVariableVersionId(app, autor, 'disposable_income', 'DECIMAL'),
    requested_amount: await seededVariableVersionId(app, autor, 'requested_amount', 'DECIMAL'),
    approved_credit_limit: await seededVariableVersionId(
      app,
      autor,
      'approved_credit_limit',
      'DECIMAL',
    ),
    probability_of_default: await seededVariableVersionId(
      app,
      autor,
      'probability_of_default',
      'DECIMAL',
    ),
    /*
     * El DESENLACE es una salida declarada, no un efecto secundario del último nodo.
     *
     * Es la salida PRIMARIA, y eso tiene una consecuencia que hay que conocer antes de tocar este
     * archivo: `setOutputValue` copia el valor de la primaria en el desenlace de la respuesta. Con
     * el límite de crédito como primaria, `POST /v1/decisions` devolvía `outcome: "2500"` — un
     * importe donde se espera una decisión—. La primaria tiene que ser lo que RESPONDE «¿qué
     * decidió esto?»; el importe es una consecuencia de haber decidido que sí.
     */
    decision: await seededVariableVersionId(app, autor, 'decision', 'STRING'),
  };

  /*
   * El motivo del rechazo, por ID y no por código.
   *
   * Una acción enlaza sus motivos con `reasonCodeId`, así que el catálogo del tenant tiene que
   * tenerlo antes de que exista el grafo. Es además lo que la suite afirma: un rechazo por
   * identidad DEBE llegar con `KYC_OR_CONSENT_INVALID`, porque un «no» sin motivo no es medible
   * ni se le puede explicar a quien lo recibe.
   */
  const motivoId = await asegurarMotivo(app, autor);

  const escritura = await request(server())
    .put(`/v1/artifact-versions/${versionId}/graph`)
    .set(autor)
    .set('If-Match', String(lockVersion))
    .send(grafo(variables, motivoId));
  if (escritura.status !== 200) {
    // Con el cuerpo: un 400 a secas obliga a adivinar cuál de treinta campos del grafo falla.
    throw new Error(
      `El grafo del artefacto de demostración no se pudo escribir (${escritura.status}): ` +
        JSON.stringify(escritura.body).slice(0, 700),
    );
  }

  const validacion = await request(server())
    .post(`/v1/artifact-versions/${versionId}/validate`)
    .set(autor)
    .expect(201);
  if (!validacion.body.valid) {
    throw new Error(
      `El artefacto de demostración no valida: ${JSON.stringify(validacion.body).slice(0, 800)}`,
    );
  }

  // Tolerante: una corrida anterior pudo dejarlo compilado o ya enviado a gobierno.
  await request(server()).post(`/v1/artifact-versions/${versionId}/compile`).set(autor);

  /*
   * Una suite de regresión BLOQUEANTE, porque el gobierno la exige y hace bien.
   *
   * Enviar a revisión sin ella responde `BLOCKING_TESTS_NOT_PASSED`: nadie debería tener que
   * aprobar un artefacto del que no consta que sus caminos terminales hagan lo que dicen. Los tres
   * casos son exactamente los tres desenlaces que las suites de extremo a extremo afirman después.
   */
  const entradaBase = {
    age: 30,
    disposable_income: 4200,
    requested_amount: 2500,
  };
  const suite = await request(server())
    .post(`/v1/artifact-versions/${versionId}/test-suites`)
    .set(autor)
    .send({
      suiteCode: `${CODIGO}_REGRESION`,
      name: 'Regresión de los tres desenlaces',
      suiteType: 'REGRESSION',
      isBlocking: true,
      cases: [
        {
          caseCode: 'APRUEBA_LIMPIO',
          testName: 'Aprueba a quien tiene identidad en regla y no es PEP',
          input: {
            ...entradaBase,
            kyc_status: 'VERIFIED',
            consent_active: true,
            pep_status: false,
          },
          expectedResult: { outcome: 'APPROVED' },
        },
        {
          caseCode: 'RECHAZA_SIN_KYC',
          testName: 'Rechaza a quien no verificó su identidad',
          input: {
            ...entradaBase,
            kyc_status: 'REJECTED',
            consent_active: true,
            pep_status: false,
          },
          expectedResult: { outcome: 'DECLINED' },
        },
        {
          caseCode: 'REVISA_PEP',
          testName: 'Manda a revisión a una persona políticamente expuesta',
          input: { ...entradaBase, kyc_status: 'VERIFIED', consent_active: true, pep_status: true },
          expectedResult: { outcome: 'MANUAL_REVIEW' },
        },
      ],
    });
  if (suite.status !== 201) {
    throw new Error(
      `No se pudo crear la suite del artefacto de demostración: ${suite.status} ` +
        JSON.stringify(suite.body).slice(0, 400),
    );
  }

  const encolada = await request(server())
    .post(`/v1/test-suites/${suite.body.id}/runs`)
    .set(autor)
    .send({})
    .expect(202);
  const limite = Date.now() + 30_000;
  let corrida = encolada;
  while (Date.now() < limite) {
    corrida = await request(server()).get(`/v1/test-runs/${encolada.body.id}`).set(autor);
    if (['PASSED', 'FAILED', 'ERROR'].includes(corrida.body.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  if (corrida.body.status !== 'PASSED') {
    // Con los casos: si el grafo decide distinto de lo que la suite afirma, hay que verlo aquí y
    // no dos pruebas más adelante como un desenlace inesperado.
    throw new Error(
      `La suite del artefacto de demostración no pasó (${corrida.body.status}): ` +
        JSON.stringify(
          (corrida.body.caseRuns ?? []).map((c: Record<string, unknown>) => ({
            estado: c.resultStatus,
            desenlace: (c.actualResultJson as Record<string, unknown> | null)?.outcome,
          })),
        ).slice(0, 500),
    );
  }

  /*
   * Gobierno: quien escribe no aprueba, y cada paso lo firma el rol que le toca.
   *
   * Las rutas son `submit-for-review` y `approval-steps/:id/decisions` —no `governance/*`—, y el
   * envío devuelve los PASOS con su rol requerido. Aprobar sin leerlos deja la versión a medias y
   * el despliegue responde `VERSION_NOT_APPROVED`, que es correcto y no dice cuál faltó.
   */
  const enviado = await request(server())
    .post(`/v1/artifact-versions/${versionId}/submit-for-review`)
    .set(autor)
    .send({ requireCompliance: false });
  const pasos = (enviado.body?.steps ?? []) as Array<{
    id: string;
    requiredRole: string;
    stepOrder: number;
  }>;
  if (enviado.status !== 201 || pasos.length === 0) {
    throw new Error(
      `No se pudo enviar a revisión el artefacto de demostración: ${enviado.status} ` +
        JSON.stringify(enviado.body).slice(0, 400),
    );
  }

  const firmantes: Record<string, Record<string, string>> = {
    QA_ANALYST: qa,
    RISK_APPROVER: riesgo,
    COMPLIANCE: managementHeaders('e2e.demo-compliance', ['COMPLIANCE']),
  };
  for (const paso of [...pasos].sort((a, b) => a.stepOrder - b.stepOrder)) {
    const firmante = firmantes[paso.requiredRole];
    if (!firmante) throw new Error(`Nadie puede firmar el paso ${paso.requiredRole}.`);
    const decision = await request(server())
      .post(`/v1/approval-steps/${paso.id}/decisions`)
      .set(firmante)
      .send({ decision: 'APPROVE', evidence: [] });
    if (decision.status !== 201 && decision.status !== 200) {
      throw new Error(
        `El paso ${paso.requiredRole} no se pudo aprobar: ${decision.status} ` +
          JSON.stringify(decision.body).slice(0, 400),
      );
    }
  }

  await desplegar(app, versionId, desplegador);
}

/** Promueve la versión por los tres escalones, tolerando los que ya estén hechos. */
async function desplegar(
  app: INestApplication,
  versionId: string,
  desplegador: Record<string, string>,
): Promise<void> {
  const server = () => app.getHttpServer();
  /*
   * DEV → STAGING → PROD, en ese orden y sin saltarse escalones.
   *
   * La tabla de transiciones no admite DEV → PROD directo: desde DEV se va a TEST o a STAGING, y
   * de ahí a producción. Saltárselo responde `INVALID_VERSION_TRANSITION`, que es el gobierno
   * haciendo su trabajo. `sample-inputs` genera entradas en DEV y `runtime` decide en PROD, así
   * que hacen falta los dos extremos y el escalón del medio.
   */
  for (const environmentCode of ['DEV', 'STAGING', 'PROD']) {
    const despliegue = await request(server())
      .post(`/v1/artifact-versions/${versionId}/deployments`)
      .set(desplegador)
      .send({ environmentCode, deploymentMode: 'DIRECT', traffic: [] });
    /*
     * Un 409 sólo se tolera si es «ya está ahí». La compuerta económica también responde 409
     * (`ECONOMIC_CONTRACT_INCOMPLETE`), y tragárselo dejaba el artefacto sin publicar con la
     * prueba fallando después por un `ACTIVE_DEPLOYMENT_NOT_FOUND` que no explicaba nada.
     */
    const yaEstaba =
      despliegue.status === 409 &&
      /ALREADY|INVALID_VERSION_TRANSITION/.test(String(despliegue.body?.error?.code ?? ''));
    if (despliegue.status !== 201 && !yaEstaba) {
      throw new Error(
        `No se pudo desplegar el artefacto de demostración a ${environmentCode}: ` +
          `${despliegue.status} ${JSON.stringify(despliegue.body).slice(0, 400)}`,
      );
    }
  }
}

function grafo(variables: Record<string, string>, motivoId: string): Record<string, unknown> {
  return {
    dependencies: [
      ...[
        'age',
        'kyc_status',
        'consent_active',
        'pep_status',
        'disposable_income',
        'requested_amount',
      ].map((codigo) => ({
        variableVersionId: variables[codigo],
        usageType: 'INPUT',
        isRequired: true,
        fallbackPolicy: 'FAIL_CLOSED',
        dependencyPath: `input.${codigo}`,
      })),
      // Las dos de SALIDA: el contrato de salida no puede publicar un campo que el grafo no
      // declare, y eso es lo que impide que una decisión devuelva un número que nadie definió.
      // Exactamente UNA salida primaria: es la que responde «¿qué decidió esto?». El grafo lo
      // exige y tiene razón —dos primarias son dos respuestas y ninguna manda—.
      {
        variableVersionId: variables.decision,
        usageType: 'OUTPUT_PRIMARY',
        // Obligatoria, y se produce en los TRES caminos terminales: una ejecución que acabara sin
        // decisión declarada moriría con `REQUIRED_OUTPUT_MISSING`, que es exactamente lo que debe
        // pasar. Un artefacto que puede terminar sin decir qué decidió está roto.
        isRequired: true,
        fallbackPolicy: 'FAIL_CLOSED',
        dependencyPath: 'output.decision',
      },
      {
        variableVersionId: variables.approved_credit_limit,
        usageType: 'OUTPUT',
        // Opcional porque un rechazo y una revisión no conceden importe alguno, y el contrato lo
        // dice con sus `absenceReasons` en vez de publicar un cero que se leería como un límite.
        isRequired: false,
        fallbackPolicy: 'FAIL_OPEN',
        dependencyPath: 'output.approved_credit_limit',
      },
      {
        variableVersionId: variables.probability_of_default,
        usageType: 'OUTPUT',
        isRequired: false,
        fallbackPolicy: 'FAIL_OPEN',
        dependencyPath: 'output.probability_of_default',
      },
    ],
    conditions: [
      {
        code: 'IDENTIDAD_OK',
        name: 'KYC verificado y consentimiento vigente',
        expressionType: 'JSON_AST',
        /*
         * `and` toma `args`, NO `left`/`right`.
         *
         * Con left/right el array de argumentos queda vacío y `every` sobre un array vacío es
         * TRUE: la condición aprobaba a todo el mundo, incluido a quien no había verificado su
         * identidad. Es el fallo más peligroso de este archivo y no da ningún error —el grafo
         * valida, compila y decide; sólo decide mal—.
         */
        expression: {
          op: 'and',
          args: [
            { op: 'eq', left: { var: 'kyc_status' }, right: { value: 'VERIFIED' } },
            { op: 'eq', left: { var: 'consent_active' }, right: { value: true } },
          ],
        },
        severity: 'BLOCKING',
        reusable: true,
      },
      {
        code: 'ES_PEP',
        name: 'Persona políticamente expuesta',
        expressionType: 'JSON_AST',
        expression: { op: 'eq', left: { var: 'pep_status' }, right: { value: true } },
        severity: 'BLOCKING',
        reusable: true,
      },
    ],
    /*
     * Las acciones PUBLICAN la salida; no basta con declararla en el contrato.
     *
     * Es la corrección menos evidente de este archivo. El contrato de salida dice de dónde sale
     * cada campo —`sourceKind` + `sourceRef`— y eso es una DECLARACIÓN que el validador comprueba;
     * el motor no la ejecuta. El valor lo escribe un nodo: una acción `SET_FIELD` o un nodo
     * `RESULT`. Con sólo `SET_OUTCOME`, el artefacto validaba, compilaba, pasaba su suite y
     * decidía bien… y devolvía `output: {}`. Una salida declarada que nadie produce no da ningún
     * error: sale ausente, y la ausencia es indistinguible de un camino que no la concede.
     */
    actions: [
      {
        code: 'APROBAR',
        type: 'SET_FIELD',
        payload: { field: 'decision', value: 'APPROVED' },
        terminal: true,
        reasonCodes: [],
      },
      {
        code: 'LIMITE_APROBADO',
        type: 'SET_FIELD',
        // Tres veces el ingreso DISPONIBLE, acotado al importe pedido y redondeado a dos decimales:
        // la prueba afirma «mayor que cero» sobre una regla que se puede leer, no sobre una
        // constante que pasaría igual si el motor no evaluara nada.
        payload: {
          field: 'approved_credit_limit',
          valueExpression: {
            op: 'round',
            precision: 2,
            arg: {
              op: 'min',
              args: [
                { var: 'requested_amount' },
                { op: 'mul', args: [{ var: 'disposable_income' }, { value: 3 }] },
              ],
            },
          },
        },
        terminal: false,
        reasonCodes: [],
      },
      {
        code: 'PD_APROBADO',
        type: 'SET_FIELD',
        payload: { field: 'probability_of_default', value: 0.05 },
        terminal: false,
        reasonCodes: [],
      },
      {
        code: 'RECHAZAR_IDENTIDAD',
        type: 'SET_FIELD',
        payload: { field: 'decision', value: 'DECLINED' },
        terminal: true,
        reasonCodes: [{ reasonCodeId: motivoId, priority: 1 }],
      },
      {
        code: 'A_REVISION',
        type: 'SET_FIELD',
        payload: { field: 'decision', value: 'MANUAL_REVIEW' },
        terminal: true,
        reasonCodes: [],
      },
    ],
    nodes: [
      nodo('START', 'START', 'Inicio', 1, false, 0, 0),
      nodo('IDENTIDAD', 'CONDITION', '¿Identidad en regla?', 2, false, 120, 0),
      nodo('PEP', 'CONDITION', '¿Persona expuesta?', 3, false, 240, 0),
      {
        ...nodo('APROBADO', 'ACTION', 'Aprobar', 4, true, 360, -80),
        // El desenlace PRIMERO: si el límite se calculara antes y su expresión fallara, la
        // ejecución moriría sin haber dejado constancia de qué se había decidido.
        actions: [
          { actionCode: 'APROBAR', order: 1 },
          { actionCode: 'LIMITE_APROBADO', order: 2 },
          { actionCode: 'PD_APROBADO', order: 3 },
        ],
      },
      {
        ...nodo('RECHAZADO', 'ACTION', 'Rechazar por identidad', 5, true, 240, 120),
        actions: [{ actionCode: 'RECHAZAR_IDENTIDAD', order: 1 }],
      },
      {
        ...nodo('REVISION', 'ACTION', 'A revisión', 6, true, 360, 80),
        actions: [{ actionCode: 'A_REVISION', order: 1 }],
      },
    ],
    edges: [
      arista('START_IDENTIDAD', 'START', 'IDENTIDAD', 1, true, []),
      // El rechazo por identidad va PRIMERO: a quien no verificó su identidad no se le abre una
      // cola, se le pide que la verifique.
      arista('IDENTIDAD_PEP', 'IDENTIDAD', 'PEP', 1, false, [
        { conditionCode: 'IDENTIDAD_OK', order: 1 },
      ]),
      arista('IDENTIDAD_RECHAZO', 'IDENTIDAD', 'RECHAZADO', 2, true, []),
      arista('PEP_REVISION', 'PEP', 'REVISION', 1, false, [{ conditionCode: 'ES_PEP', order: 1 }]),
      arista('PEP_APROBADO', 'PEP', 'APROBADO', 2, true, []),
    ],
    outputContract: [
      {
        code: 'decision',
        name: 'Decisión',
        description: 'Qué decidió el artefacto: APPROVED, DECLINED o MANUAL_REVIEW.',
        // El desenlace no sale de un nodo concreto: sale del camino terminal que la ejecución
        // alcanza, y hay tres. `EXPRESSION` es el único origen que admite eso sin mentir —
        // declarar `NODE: APROBADO` sería cierto en un camino de los tres—.
        sourceKind: 'EXPRESSION',
        sourceRef: 'terminal(APROBADO | RECHAZADO | REVISION)',
        // Obligatoria: no hay motivo de ausencia posible, y declarar uno sería declarar que esto
        // puede terminar sin decidir.
        absenceReasons: [],
        contractVersion: '1.0.0',
        sensitivityClass: 'INTERNAL',
        tracePolicy: 'FULL',
        semanticRole: 'NONE',
      },
      {
        code: 'approved_credit_limit',
        name: 'Límite de crédito aprobado',
        description: 'Importe que la decisión concede. Ausente cuando no aprueba.',
        // El nodo que lo produce, que es lo que de verdad ocurre: lo escribe la acción
        // `LIMITE_APROBADO` del nodo APROBADO. El validador comprueba que el nodo exista.
        sourceKind: 'NODE',
        sourceRef: 'APROBADO',
        absenceReasons: ['DECLINED', 'MANUAL_REVIEW'],
        contractVersion: '1.0.0',
        sensitivityClass: 'INTERNAL',
        tracePolicy: 'FULL',
        // Declarado, no deducido del nombre: es lo que hace que el motor compruebe su RANGO al
        // ejecutar y que un límite negativo deje de publicarse como un importe.
        semanticRole: 'APPROVED_LIMIT',
      },
      {
        code: 'probability_of_default',
        name: 'Probabilidad de incumplimiento',
        description:
          'Declarada porque este artefacto origina crédito: sin PD no se puede calibrar ni vigilar.',
        sourceKind: 'CONSTANT',
        sourceRef: '0.05',
        // Un campo opcional que no dice cuándo falta obliga a quien lo lee a adivinar si su
        // ausencia es un caso previsto o una avería.
        absenceReasons: ['DECLINED', 'MANUAL_REVIEW'],
        contractVersion: '1.0.0',
        sensitivityClass: 'INTERNAL',
        tracePolicy: 'FULL',
        semanticRole: 'PROBABILITY_OF_DEFAULT',
      },
    ],
  };
}

function nodo(
  key: string,
  type: string,
  label: string,
  order: number,
  terminal: boolean,
  x: number,
  y: number,
): Record<string, unknown> {
  return { key, type, label, config: {}, x, y, order, terminal, conditions: [], actions: [] };
}

function arista(
  key: string,
  from: string,
  to: string,
  priority: number,
  esPorDefecto: boolean,
  conditions: Array<{ conditionCode: string; order: number }>,
): Record<string, unknown> {
  return { key, from, to, type: 'DEFAULT', priority, default: esPorDefecto, conditions };
}

/** Da de alta `KYC_OR_CONSENT_INVALID` si no está, y devuelve su id. */
async function asegurarMotivo(
  app: INestApplication,
  headers: Record<string, string>,
): Promise<string> {
  const server = () => app.getHttpServer();
  const CODIGO_MOTIVO = 'KYC_OR_CONSENT_INVALID';

  const listado = await request(server())
    .get('/v1/reason-codes')
    .query({ search: CODIGO_MOTIVO, pageSize: 100 })
    .set(headers);
  const existente = (
    (listado.body?.items ?? []) as Array<{ reasonCode?: string; id?: string }>
  ).find((item) => item.reasonCode === CODIGO_MOTIVO);
  if (existente?.id) return existente.id;

  const creado = await request(server()).post('/v1/reason-codes').set(headers).send({
    reasonCode: CODIGO_MOTIVO,
    category: 'IDENTITY',
    publicMessage: 'No pudimos verificar tu identidad o falta tu consentimiento.',
    internalMessage: 'KYC no VERIFIED o consentimiento inactivo en la entrada de la decisión.',
    severity: 'HIGH',
    isAdverseAction: true,
  });
  if (creado.status !== 201 && creado.status !== 200) {
    throw new Error(
      `No se pudo crear el motivo ${CODIGO_MOTIVO}: ${creado.status} ` +
        JSON.stringify(creado.body).slice(0, 400),
    );
  }
  return creado.body.id as string;
}
