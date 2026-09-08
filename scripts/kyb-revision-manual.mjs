#!/usr/bin/env node
/**
 * Publica la versión del KYB del comercio que SÍ abre caso de revisión manual.
 *
 * ## Qué arregla
 *
 * `PARTNER_KYB_REVIEW` tenía sus tres desenlaces como nodos `RESULT`, incluido el que se llama
 * «REVISION_MANUAL». Y un `RESULT` no abre nada: el motor sólo crea el caso en
 * `decision_manual_review_case` cuando el nodo es de tipo `MANUAL_REVIEW`. Medido contra el motor
 * local el 2026-09-08, un expediente completo con el correo sin verificar respondía
 * `outcome: REVISION_MANUAL` con **`manualReview: null`** — es decir, un expediente mandado «a
 * revisión» que no aparecía en la cola de nadie. El comercio se quedaba esperando a una persona que
 * no tenía dónde verlo.
 *
 * Esta versión convierte `REVISAR` en un nodo `MANUAL_REVIEW` con su cola propia
 * (`MERCHANT_KYB`) y con la evidencia que necesita quien lo revise: qué requisitos faltan, qué
 * señales saltaron y cuáles son. Conserva el mapeo de salidas (`mode: MAPPING`), así que quien
 * llama sigue recibiendo `kyb_decision`/`kyb_motivo` exactamente igual que antes.
 *
 * ## Por qué un guion y no una semilla
 *
 * Las semillas se movieron a una rama de PostgreSQL (`c4084c9`) y con ellas se fueron los tres
 * ficheros del artefacto; hoy no hay forma de auditarlo en un PR. Esto es reproducible, va por la
 * API de gestión —los mismos permisos y la misma auditoría que un cambio hecho a mano— y se puede
 * correr contra cualquier ambiente.
 *
 * ## Uso
 *
 *   MANAGEMENT_API_KEY=… node scripts/kyb-revision-manual.mjs [--base http://127.0.0.1:3020] [--dry-run]
 *   MANAGEMENT_API_KEY=… node scripts/kyb-revision-manual.mjs --deploy <versionId> [--environments DEV,TEST]
 *
 * El primero prepara la versión y la manda a revisión; el segundo la despliega una vez aprobada.
 * Están separados porque el gobierno del motor lo exige: quien crea una versión no puede
 * aprobarla, así que el guion no puede hacer las dos mitades.
 *
 * Es idempotente: si la versión vigente ya tiene el nodo `MANUAL_REVIEW`, no hace nada y lo dice.
 */
import { argv, env, exit } from 'node:process';

const args = new Map();
for (let i = 2; i < argv.length; i += 1) {
  const arg = argv[i];
  if (!arg.startsWith('--')) continue;
  const key = arg.slice(2);
  const next = argv[i + 1];
  if (!next || next.startsWith('--')) args.set(key, 'true');
  else {
    args.set(key, next);
    i += 1;
  }
}

const BASE = (args.get('base') ?? env.DECISION_ENGINE_BASE_URL ?? 'http://127.0.0.1:3020').replace(/\/+$/, '');
const API_KEY = env.MANAGEMENT_API_KEY;
const ARTIFACT_CODE = args.get('artifact') ?? 'PARTNER_KYB_REVIEW';
const ENVIRONMENTS = (args.get('environments') ?? 'DEV,TEST').split(',').map((code) => code.trim()).filter(Boolean);
const DRY_RUN = args.get('dry-run') === 'true';
const QUEUE_CODE = args.get('queue') ?? 'MERCHANT_KYB';

if (!API_KEY) {
  console.error('Falta MANAGEMENT_API_KEY: es la credencial del plano de gestión (la de runtime NO sirve aquí).');
  exit(1);
}

async function api(path, options = {}) {
  const response = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'x-api-key': API_KEY,
      'content-type': 'application/json',
      ...(options.headers ?? {}),
    },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`${options.method ?? 'GET'} ${path} → ${response.status}: ${text.slice(0, 600)}`);
  }
  return body;
}

/**
 * La evidencia del caso. Son las mismas siete entradas más las dos intermedias: el analista tiene
 * que poder decidir sin volver a abrir el expediente en Atlas, y el motor no guarda datos del
 * comercio (por eso las entradas son booleanas y no documentos).
 */
const EVIDENCE = {
  motivo: 'KYB_SENALES_OPERATIVAS',
  requisitosFaltantes: '{{intermediate.requisitos_faltantes}}',
  senalesOperativas: '{{intermediate.senales_operativas}}',
  matricula: '{{kyb_tiene_matricula}}',
  representanteAcreditado: '{{kyb_representante_acreditado}}',
  qrNegocio: '{{kyb_qr_negocio}}',
  qrBancario: '{{kyb_qr_bancario}}',
  correoVerificado: '{{kyb_correo_verificado}}',
  sucursalesDeclaradas: '{{kyb_sucursales}}',
  antiguedadDias: '{{kyb_antiguedad_dias}}',
};

function nodoRevisionManual(previo) {
  return {
    ...previo,
    type: 'MANUAL_REVIEW',
    label: 'A revisión de una persona',
    config: {
      ...previo.config,
      // Cola propia: `CREDIT_REVIEW` (el defecto del motor) mezclaría expedientes de comercio con
      // solicitudes de crédito en la misma bandeja, que las revisa otro equipo con otro criterio.
      queueCode: QUEUE_CODE,
      priority: 80,
      // Cuatro horas: un comercio que espera la verificación no puede cobrar, así que el plazo se
      // mide en horas de trabajo, no en días.
      slaMinutes: 240,
      evidence: EVIDENCE,
    },
  };
}

/**
 * La lectura devuelve `{ code, order }` y la escritura exige `{ conditionCode, order }`. Es la
 * misma asimetría que en las dependencias: la respuesta de un GET no se puede reenviar tal cual.
 */
function bindingDeCondicion(binding) {
  return {
    conditionCode: binding.conditionCode ?? binding.code,
    order: binding.order ?? 1,
    ...(binding.expected === undefined ? {} : { expected: binding.expected }),
  };
}

function cuerpoDelGrafo(grafo, nodos) {
  return {
    /*
     * La LECTURA del grafo llama `required`/`fallbackPolicy` a lo que la ESCRITURA exige como
     * `isRequired`/`fallbackPolicy`. Sin la traducción, el PUT responde 400 quejándose de un campo
     * que la respuesta anterior sí traía, con otro nombre.
     */
    dependencies: (grafo.variables ?? []).map((variable) => ({
      variableVersionId: variable.variableVersionId,
      usageType: variable.usageType,
      dependencyPath: variable.dependencyPath,
      isRequired: variable.isRequired ?? variable.required ?? true,
      fallbackPolicy: variable.fallbackPolicy ?? 'FAIL_CLOSED',
    })),
    conditions: (grafo.conditions ?? []).map((condition) => ({
      code: condition.code,
      name: condition.name,
      expressionType: condition.expressionType,
      expression: condition.expression,
      severity: condition.severity,
      reusable: condition.reusable,
    })),
    actions: (grafo.actions ?? []).map((action) => ({ ...action, id: undefined })),
    nodes: nodos.map((node) => ({
      key: node.key,
      type: node.type,
      label: node.label,
      config: node.config,
      x: node.x,
      y: node.y,
      order: node.order,
      terminal: node.terminal,
      conditions: (node.conditions ?? []).map(bindingDeCondicion),
      actions: (node.actions ?? []).map((action) => ({
        actionCode: action.actionCode ?? action.code,
        order: action.order ?? 1,
      })),
      calculatedFieldCalls: node.calculatedFieldCalls ?? [],
    })),
    edges: (grafo.edges ?? []).map((edge) => ({
      key: edge.key,
      from: edge.from,
      to: edge.to,
      type: edge.type,
      priority: edge.priority,
      default: edge.default,
      conditions: (edge.conditions ?? []).map(bindingDeCondicion),
    })),
    intermediates: (grafo.intermediates ?? []).map((item) => ({
      code: item.code,
      name: item.name,
      description: item.description,
      dataType: item.dataType,
      producerNodeKey: item.producerNodeKey,
      consumerNodeKeys: item.consumerNodeKeys,
      nullable: item.nullable ?? false,
      updatePolicy: item.updatePolicy ?? 'SINGLE_WRITE',
      sensitivityClass: item.sensitivityClass ?? 'INTERNAL',
      tracePolicy: item.tracePolicy ?? 'FULL',
      ...(item.constraints ? { constraints: item.constraints } : {}),
      ...(item.initialValue === undefined || item.initialValue === null ? {} : { initialValue: item.initialValue }),
      ...(item.availabilityCondition ? { availabilityCondition: item.availabilityCondition } : {}),
    })),
    outputContract: (grafo.outputContract ?? []).map((field) => ({
      code: field.code,
      name: field.name,
      ...(field.description ? { description: field.description } : {}),
      sourceKind: field.sourceKind,
      sourceRef: field.sourceRef,
      ...(field.valueMapping ? { valueMapping: field.valueMapping } : {}),
      absenceReasons: field.absenceReasons ?? [],
      // Por CÓDIGO y no por id: es lo que hace que el contrato siga significando lo mismo entre ambientes.
      reasonCodes: (field.reasonCodes ?? []).map((reason) => (typeof reason === 'string' ? reason : (reason.code ?? reason))),
      contractVersion: String(field.contractVersion ?? '1'),
      semanticRole: field.semanticRole ?? 'NONE',
      tracePolicy: field.tracePolicy ?? 'FULL',
      sensitivityClass: field.sensitivityClass ?? 'INTERNAL',
    })),
  };
}

async function main() {
  const artifacts = await api('/v1/artifacts');
  const lista = Array.isArray(artifacts) ? artifacts : (artifacts.items ?? []);
  const artefacto = lista.find((item) => (item.artifactCode ?? item.code) === ARTIFACT_CODE);
  if (!artefacto) throw new Error(`No existe el artefacto ${ARTIFACT_CODE} en ${BASE}.`);

  const detalle = await api(`/v1/artifacts/${artefacto.id}`);
  const versiones = detalle.versions ?? [];
  // La vigente es la última PUBLICADA: un borrador a medias de otra sesión no es de dónde clonar.
  const vigente = versiones
    .filter((version) => version.status !== 'DRAFT')
    .reduce((mejor, version) => (!mejor || Number(version.versionNumber) > Number(mejor.versionNumber) ? version : mejor), null);
  if (!vigente) throw new Error(`${ARTIFACT_CODE} no tiene versiones.`);

  const grafo = await api(`/v1/artifact-versions/${vigente.id}/graph`);
  const revisar = (grafo.nodes ?? []).find((node) => node.key === 'REVISAR');
  if (!revisar) throw new Error('El grafo no tiene el nodo REVISAR: revisa el artefacto antes de seguir.');
  if (revisar.type === 'MANUAL_REVIEW') {
    const desplegada = String(vigente.status ?? '').startsWith('DEPLOYED');
    console.log(
      `La versión ${vigente.versionNumber} (id ${vigente.id}, ${vigente.status}) de ${ARTIFACT_CODE} ya abre caso ` +
        `en la cola ${revisar.config?.queueCode}.`,
    );
    // Preparada no es desplegada: decirlo evita dar por hecho que ya decide así en el ambiente.
    if (!desplegada) {
      console.log(`Todavía NO está desplegada. Cuando esté aprobada: node scripts/kyb-revision-manual.mjs --deploy ${vigente.id}`);
    }
    return;
  }
  console.log(`Versión vigente ${vigente.versionNumber} (id ${vigente.id}): REVISAR es ${revisar.type} y NO abre caso.`);
  if (DRY_RUN) {
    console.log('--dry-run: no se escribe nada.');
    return;
  }

  /*
   * Si ya hay un borrador de un intento anterior, se reutiliza. Sin esto, cada corrida fallida
   * dejaba una versión DRAFT huérfana detrás y la siguiente clonaba ESA, encadenando basura.
   */
  const borrador = versiones.find((version) => version.status === 'DRAFT');
  const clon = borrador
    ? borrador
    : await api(`/v1/artifact-versions/${vigente.id}/clone`, {
    method: 'POST',
    body: JSON.stringify({
      changeSummary:
        'La derivación a revisión abre caso: REVISAR pasa de RESULT a MANUAL_REVIEW en la cola MERCHANT_KYB. ' +
        'Antes el desenlace REVISION_MANUAL no creaba caso y el expediente no aparecía en ninguna bandeja.',
    }),
      });
  const nuevaId = clon.id ?? clon.versionId;
  console.log(borrador ? `Reutilizando el borrador ${clon.versionNumber} (id ${nuevaId}).` : `Clonada como versión id ${nuevaId}.`);

  const nodos = (grafo.nodes ?? []).map((node) => (node.key === 'REVISAR' ? nodoRevisionManual(node) : node));
  const escrito = await api(`/v1/artifact-versions/${nuevaId}/graph`, {
    method: 'PUT',
    headers: { 'if-match': String(clon.lockVersion ?? 1) },
    body: JSON.stringify(cuerpoDelGrafo(grafo, nodos)),
  });
  console.log(`Grafo reemplazado (lockVersion ${escrito.lockVersion ?? '?'}).`);

  const compilado = await api(`/v1/artifact-versions/${nuevaId}/validate-and-compile`, { method: 'POST', body: '{}' });
  console.log(`Compilada: ${compilado.canonicalChecksum ?? compilado.checksum ?? 'sin checksum en la respuesta'}.`);

  /*
   * Y aquí se para, a propósito.
   *
   * Desplegar exige que la versión esté APROBADA, y las dos aprobaciones llevan
   * `separationOfDuties`: quien creó la versión NO puede aprobarla. Este guion la creó, así que
   * aprobarla desde aquí sería exactamente la puerta trasera que ese control existe para cerrar
   * —y con la llave de gestión, que tiene todos los roles, saldría bien—. La versión anterior
   * llegó a estar desplegada porque la sembró un script escribiendo filas por debajo del gobierno;
   * esa es la práctica que esto no repite.
   */
  const solicitud = await api(`/v1/artifact-versions/${nuevaId}/submit-for-review`, {
    method: 'POST',
    body: JSON.stringify({ requireCompliance: false }),
  });
  console.log(`Enviada a revisión (solicitud ${solicitud.id ?? '?'}).`);
  console.log('');
  console.log('Falta lo que NO puede hacer este guion, y es deliberado:');
  console.log('  1. Un QA_ANALYST aprueba el paso 1 en el portal del Motor (Gobierno → Revisiones).');
  console.log('  2. Un RISK_APPROVER aprueba el paso 2.');
  console.log(`  3. Y entonces: node scripts/kyb-revision-manual.mjs --deploy ${nuevaId}`);
  console.log('');
  console.log('Ninguno de los tres puede ser quien corrió esto: la versión la creó este principal.');
}

/** Despliega una versión YA aprobada. Se separa porque el permiso para hacerlo es de otra persona. */
async function desplegar(versionId) {
  for (const environmentCode of ENVIRONMENTS) {
    const despliegue = await api(`/v1/artifact-versions/${versionId}/deployments`, {
      method: 'POST',
      body: JSON.stringify({ environmentCode, deploymentMode: 'DIRECT', traffic: [] }),
    });
    // El despliegue escribe además el `decision_runtime_binding`: sin él, ejecutar responde
    // ACTIVE_DEPLOYMENT_NOT_FOUND aunque la versión esté compilada y desplegada.
    console.log(`Desplegada en ${environmentCode} (deployment ${despliegue.id ?? despliegue.deploymentId ?? '?'}).`);
  }
  console.log('Listo. Comprueba con una ejecución que `manualReview.caseCode` ya no es null.');
}

const DEPLOY = args.get('deploy');

(DEPLOY && DEPLOY !== 'true' ? desplegar(DEPLOY) : main()).catch((error) => {
  console.error(error.message);
  exit(1);
});
