#!/usr/bin/env node
/**
 * Publica `RIESGO_ONBOARDING_CLIENTE`: la política versionada del riesgo de onboarding.
 *
 * ## Qué arregla
 *
 * Hasta el 2026-09-14 el riesgo de onboarding de un cliente NO lo decidía el Motor. AtlasBackend
 * tiene la cadena Motor → ruleset local → `risk_heuristic_v0`, pero `DECISION_ENGINE_RISK_ARTIFACT`
 * estaba vacío en todos los entornos y en el Motor no existía ningún artefacto de riesgo: cada alta
 * la aprobaba una heurística dentro del código, con 65 puntos, sin versión, sin aprobación y sin
 * ejecución que auditar. Medido en la base del VPS: cero evaluaciones con `decision_source =
 * decision_engine`.
 *
 * Esta versión es la MISMA política escrita como artefacto: sin documento de identidad o sin
 * consentimiento el caso va a una persona (cola `RIESGO_ONBOARDING`); con ambos, 65 o más sigue
 * adelante y menos lo mira una persona. Nunca rechaza. La definición vive en
 * `scripts/lib/riesgo-onboarding-cliente.definicion.json` y la ejecuta con el motor real
 * `test/riesgo-onboarding-cliente.spec.ts`: lo que se publica es lo que se prueba.
 *
 * ## Por qué un guion y no una semilla
 *
 * Las semillas viven en una rama de PostgreSQL (`c4084c9`) y un artefacto sembrado por debajo del
 * gobierno no se puede revisar en un PR ni pasa por aprobaciones. Esto va por la API de gestión:
 * los mismos permisos, la misma auditoría y la misma cola de gobierno que un cambio hecho a mano.
 *
 * ## Uso
 *
 *   MANAGEMENT_API_KEY=… node scripts/riesgo-onboarding-cliente.mjs [--base http://127.0.0.1:3020] [--dry-run]
 *   MANAGEMENT_API_KEY=… node scripts/riesgo-onboarding-cliente.mjs --deploy <versionId> [--environments DEV,TEST]
 *
 * El primero crea (o reutiliza) el artefacto, escribe el grafo, compila, corre la suite bloqueante y
 * manda la versión a revisión. El segundo la despliega una vez aprobada por DOS personas (QA_ANALYST
 * y RISK_APPROVER, ninguna la autora). Están separados porque el gobierno del Motor lo exige.
 *
 * Es idempotente: reason codes y variables se reutilizan si ya existen; si la versión vigente ya
 * está compilada no se reescribe el grafo; si ya hay solicitud de aprobación no se crea otra.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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

const BASE = (args.get('base') ?? env.DECISION_ENGINE_BASE_URL ?? 'http://127.0.0.1:3020').replace(
  /\/+$/,
  '',
);
const API_KEY = env.MANAGEMENT_API_KEY;
const TENANT_ID = args.get('tenant') ?? env.DECISION_ENGINE_TENANT_ID ?? '1';
const ENVIRONMENTS = (args.get('environments') ?? 'DEV,TEST')
  .split(',')
  .map((code) => code.trim())
  .filter(Boolean);
const DRY_RUN = args.get('dry-run') === 'true';

const DEFINICION = JSON.parse(
  readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      'lib',
      'riesgo-onboarding-cliente.definicion.json',
    ),
    'utf8',
  ),
);
const ARTIFACT_CODE = DEFINICION.artifact.artifactCode;

if (!API_KEY) {
  console.error(
    'Falta MANAGEMENT_API_KEY: es la credencial del plano de gestión (la de runtime NO sirve aquí).',
  );
  exit(1);
}

async function api(path, options = {}) {
  const response = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'x-api-key': API_KEY,
      'x-tenant-id': TENANT_ID,
      'content-type': 'application/json',
      ...(options.headers ?? {}),
    },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(
      `${options.method ?? 'GET'} ${path} → ${response.status}: ${text.slice(0, 600)}`,
    );
  }
  return body;
}

const items = (body) => (Array.isArray(body) ? body : (body?.items ?? body?.data ?? []));

/** Recorre una lista paginada entera. Buscar por `search` devuelve parecidos, no iguales: se filtra por código exacto. */
async function todas(path) {
  const acumulado = [];
  for (let page = 1; page < 50; page += 1) {
    const body = await api(`${path}${path.includes('?') ? '&' : '?'}page=${page}&pageSize=100`);
    acumulado.push(...items(body));
    if (!body?.hasNextPage) break;
  }
  return acumulado;
}

/* ------------------------------------------------------------------------------------------ */
/* Reason codes                                                                                 */
/* ------------------------------------------------------------------------------------------ */

async function asegurarReasonCodes() {
  const existentes = await todas('/v1/reason-codes');
  const porCodigo = new Map(existentes.map((reason) => [reason.reasonCode, reason]));
  const ids = new Map();
  for (const reason of DEFINICION.reasonCodes) {
    const previo = porCodigo.get(reason.reasonCode);
    if (previo) {
      ids.set(reason.reasonCode, String(previo.id));
      continue;
    }
    if (DRY_RUN) {
      console.log(`[dry-run] crearía el reason code ${reason.reasonCode}`);
      ids.set(reason.reasonCode, 'dry-run');
      continue;
    }
    const creado = await api('/v1/reason-codes', { method: 'POST', body: JSON.stringify(reason) });
    ids.set(reason.reasonCode, String(creado.id));
    console.log(`Reason code ${reason.reasonCode} creado (id ${creado.id}).`);
  }
  return ids;
}

/* ------------------------------------------------------------------------------------------ */
/* Variables                                                                                    */
/* ------------------------------------------------------------------------------------------ */

function cuerpoDeVariable(definicion, direccion) {
  const esEntrada = direccion === 'input';
  return {
    variableCode: definicion.code,
    canonicalName: definicion.name,
    businessDescription: definicion.description,
    dataClassification: 'INTERNAL',
    ownerTeam: DEFINICION.artifact.ownerTeam,
    isSensitive: false,
    initialVersion: {
      dataType: definicion.dataType,
      ...(definicion.unitCode ? { unitCode: definicion.unitCode } : {}),
      nullable: false,
      displayName: definicion.name,
      description: definicion.description,
      ...(definicion.constraints
        ? { constraints: definicion.constraints, validationSchema: definicion.constraints }
        : {}),
      expectedOrigin: esEntrada ? 'REQUEST' : 'GRAPH_NODE',
      contractVersion: '1',
      sources: [
        {
          sourceSystemCode: esEntrada ? 'REQUEST_PAYLOAD' : 'DECISION_ENGINE',
          sourcePath: esEntrada ? '$.variables' : '$.output',
          sourceField: definicion.code,
          freshnessSlaSeconds: 60,
          precedence: 1,
          isAuthoritative: true,
        },
      ],
      validationRules: [],
    },
  };
}

/** Devuelve `code → variableVersionId` (la versión más reciente de cada definición). */
async function asegurarVariables() {
  const versiones = new Map();
  const pendientes = [
    ...DEFINICION.inputs.map((v) => ({ ...v, direccion: 'input' })),
    ...DEFINICION.outputs.map((v) => ({ ...v, direccion: 'output' })),
  ];
  for (const variable of pendientes) {
    const candidatas = await todas(`/v1/variables?search=${encodeURIComponent(variable.code)}`);
    const existente = candidatas.find((item) => item.variableCode === variable.code);
    if (existente) {
      const detalle = await api(`/v1/variables/${existente.id}`);
      const ultima = (detalle.versions ?? []).reduce(
        (mejor, version) =>
          !mejor || Number(version.versionNumber) > Number(mejor.versionNumber) ? version : mejor,
        null,
      );
      if (!ultima) throw new Error(`La variable ${variable.code} existe sin versiones.`);
      versiones.set(variable.code, String(ultima.id));
      // `fraud_score` ya existía en el catálogo (id 169, NUMBER 0-100, origen DERIVED): se reutiliza
      // en vez de duplicar el código, que es único por inquilino.
      continue;
    }
    if (DRY_RUN) {
      console.log(
        `[dry-run] crearía la variable ${variable.code} (${variable.dataType}, ${variable.direccion})`,
      );
      versiones.set(variable.code, 'dry-run');
      continue;
    }
    const creada = await api('/v1/variables', {
      method: 'POST',
      body: JSON.stringify(cuerpoDeVariable(variable, variable.direccion)),
    });
    const version = (creada.versions ?? [])[0];
    if (!version) throw new Error(`La API creó ${variable.code} sin devolver su versión.`);
    versiones.set(variable.code, String(version.id));
    console.log(
      `Variable ${variable.code} creada (definición ${creada.id}, versión ${version.id}).`,
    );
  }
  return versiones;
}

/* ------------------------------------------------------------------------------------------ */
/* Grafo                                                                                       */
/* ------------------------------------------------------------------------------------------ */

function cuerpoDelGrafo(versiones, reasonIds) {
  return {
    dependencies: [
      ...DEFINICION.inputs.map((v) => ({
        variableVersionId: versiones.get(v.code),
        usageType: 'INPUT',
        dependencyPath: `input.${v.code}`,
        isRequired: true,
        fallbackPolicy: 'FAIL_CLOSED',
      })),
      ...DEFINICION.outputs.map((v) => ({
        variableVersionId: versiones.get(v.code),
        usageType: v.usageType,
        dependencyPath: `output.${v.code}`,
        isRequired: true,
        fallbackPolicy: 'FAIL_CLOSED',
      })),
    ],
    conditions: DEFINICION.conditions,
    actions: DEFINICION.actions.map((action) => ({
      code: action.code,
      type: action.type,
      payload: action.payload,
      terminal: action.terminal,
      reasonCodes: action.reasonCodes.map((reason) => ({
        reasonCodeId: reasonIds.get(reason.reasonCode),
        priority: reason.priority,
      })),
    })),
    nodes: DEFINICION.nodes.map((node, index) => ({
      key: node.key,
      type: node.type,
      label: node.label,
      config: node.config,
      x: (index % 4) * 260,
      y: Math.floor(index / 4) * 160,
      order: index,
      terminal: node.terminal,
      conditions: [],
      actions: node.actions,
      calculatedFieldCalls: [],
    })),
    edges: DEFINICION.edges,
    intermediates: DEFINICION.intermediates.map((item) => ({
      ...item,
      nullable: false,
      updatePolicy: 'SINGLE_WRITE',
      sensitivityClass: 'INTERNAL',
      tracePolicy: 'FULL',
    })),
    outputContract: DEFINICION.outputs.map((output) => ({
      code: output.code,
      name: output.name,
      description: output.description,
      sourceKind: 'NODE',
      sourceRef: 'EVALUAR',
      absenceReasons: [],
      reasonCodes: [],
      contractVersion: '1',
      semanticRole: 'NONE',
      tracePolicy: 'FULL',
      sensitivityClass: 'INTERNAL',
    })),
  };
}

/* ------------------------------------------------------------------------------------------ */
/* Suite bloqueante y gobierno                                                                  */
/* ------------------------------------------------------------------------------------------ */

async function esperarCorrida(runId, intentos = 40) {
  let detalle = await api(`/v1/test-runs/${runId}`);
  for (let i = 0; i < intentos; i += 1) {
    const estado = String(detalle.status ?? detalle.runStatus ?? '').toUpperCase();
    if (estado && !['QUEUED', 'RUNNING', 'PENDING'].includes(estado)) return detalle;
    await new Promise((listo) => setTimeout(listo, 1_000));
    detalle = await api(`/v1/test-runs/${runId}`);
  }
  return detalle;
}

/** Crea la suite bloqueante si falta y la ejecuta. Devuelve `true` si quedó en verde. */
async function asegurarSuiteBloqueante(versionId) {
  const existentes = items(await api(`/v1/artifact-versions/${versionId}/test-suites`));
  let suite = existentes.find((s) => s.suiteCode === DEFINICION.suite.suiteCode);
  if (!suite) {
    suite = await api(`/v1/artifact-versions/${versionId}/test-suites`, {
      method: 'POST',
      body: JSON.stringify({ ...DEFINICION.suite, cases: DEFINICION.cases }),
    });
    console.log(`Suite ${DEFINICION.suite.suiteCode} creada con ${DEFINICION.cases.length} casos.`);
  } else {
    console.log(`Suite ${DEFINICION.suite.suiteCode} ya existe (id ${suite.id}).`);
  }

  const corrida = await api(`/v1/test-suites/${suite.id}/runs`, {
    method: 'POST',
    body: JSON.stringify({ triggerType: 'MANUAL' }),
  });
  const runId = corrida.id ?? corrida.runId;
  const detalle = await esperarCorrida(runId);
  const estado = String(detalle.status ?? detalle.runStatus ?? '').toUpperCase();
  const casos = detalle.caseRuns ?? detalle.cases ?? [];
  const fallados = casos.filter(
    (caso) => String(caso.resultStatus ?? caso.status).toUpperCase() !== 'PASS',
  );
  console.log(
    `Corrida ${runId}: ${estado} · ${casos.length - fallados.length} en verde, ${fallados.length} en rojo.`,
  );
  for (const caso of fallados) {
    console.log(
      `  ✗ ${caso.testCase?.caseCode ?? caso.caseCode ?? '?'}: ${JSON.stringify(caso.assertions ?? caso.error)}`.slice(
        0,
        600,
      ),
    );
  }
  return casos.length > 0 && fallados.length === 0 && estado === 'PASSED';
}

async function enviarARevision(versionId) {
  return api(`/v1/artifact-versions/${versionId}/submit-for-review`, {
    method: 'POST',
    body: JSON.stringify({ requireCompliance: false }),
  });
}

function instruccionesDeAprobacion(versionId) {
  console.log('');
  console.log('Falta lo que NO puede hacer este guion, y es deliberado:');
  console.log(
    '  1. Un QA_ANALYST aprueba el paso 1 en el portal del Motor (Gobierno → Revisiones).',
  );
  console.log('  2. Un RISK_APPROVER aprueba el paso 2.');
  console.log(
    `  3. Y entonces: node scripts/riesgo-onboarding-cliente.mjs --deploy ${versionId} --environments ${ENVIRONMENTS.join(',')}`,
  );
  console.log(
    '  4. Y en AtlasBackend: DECISION_ENGINE_RISK_ARTIFACT=RIESGO_ONBOARDING_CLIENTE (o la asignación en /internal/settings/decision-artifacts).',
  );
  console.log('');
  console.log(
    'Ninguno de los tres puede ser quien corrió esto: la versión la creó este principal.',
  );
}

/* ------------------------------------------------------------------------------------------ */
/* Flujo principal                                                                              */
/* ------------------------------------------------------------------------------------------ */

async function main() {
  const reasonIds = await asegurarReasonCodes();
  const versiones = await asegurarVariables();

  const lista = items(await api('/v1/artifacts?pageSize=100'));
  let artefacto = lista.find((item) => (item.artifactCode ?? item.code) === ARTIFACT_CODE);
  if (!artefacto) {
    if (DRY_RUN) {
      console.log(
        `[dry-run] crearía el artefacto ${ARTIFACT_CODE} y escribiría su grafo (${DEFINICION.nodes.length} nodos, ${DEFINICION.edges.length} aristas).`,
      );
      return;
    }
    const { authoringNotes, ...alta } = DEFINICION.artifact;
    artefacto = await api('/v1/artifacts', { method: 'POST', body: JSON.stringify(alta) });
    console.log(`Artefacto ${ARTIFACT_CODE} creado (id ${artefacto.id}).`);
    const primera = (artefacto.versions ?? [])[0];
    if (primera && authoringNotes) {
      await api(`/v1/artifact-versions/${primera.id}/notes`, {
        method: 'PATCH',
        body: JSON.stringify({ notes: authoringNotes }),
      }).catch((error) => console.log(`(notas de autoría no escritas: ${error.message})`));
    }
  }

  const detalle = await api(`/v1/artifacts/${artefacto.id}`);
  const versionesArtefacto = detalle.versions ?? [];
  const vigente = versionesArtefacto.reduce(
    (mejor, version) =>
      !mejor || Number(version.versionNumber) > Number(mejor.versionNumber) ? version : mejor,
    null,
  );
  if (!vigente) throw new Error(`${ARTIFACT_CODE} no tiene versiones.`);
  console.log(`Versión vigente ${vigente.versionNumber} (id ${vigente.id}): ${vigente.status}.`);

  if (String(vigente.status).startsWith('DEPLOYED')) {
    console.log('Ya está desplegada: nada que hacer.');
    return;
  }

  if (vigente.status === 'DRAFT') {
    if (DRY_RUN) {
      console.log(
        `[dry-run] escribiría el grafo (${DEFINICION.nodes.length} nodos, ${DEFINICION.edges.length} aristas) y compilaría.`,
      );
      return;
    }
    const escrito = await api(`/v1/artifact-versions/${vigente.id}/graph`, {
      method: 'PUT',
      headers: { 'if-match': String(vigente.lockVersion ?? 1) },
      body: JSON.stringify(cuerpoDelGrafo(versiones, reasonIds)),
    });
    console.log(`Grafo escrito (lockVersion ${escrito.lockVersion ?? '?'}).`);
    const compilado = await api(`/v1/artifact-versions/${vigente.id}/validate-and-compile`, {
      method: 'POST',
      body: '{}',
    });
    console.log(
      `Compilada: ${compilado.canonicalChecksum ?? compilado.checksum ?? 'sin checksum en la respuesta'}.`,
    );
  } else if (DRY_RUN) {
    console.log(
      '[dry-run] la versión ya está compilada; sólo comprobaría la suite y la solicitud.',
    );
    return;
  }

  const solicitudes = items(await api('/v1/approval-requests'));
  const suya = solicitudes.find(
    (peticion) => String(peticion.artifactVersionId) === String(vigente.id),
  );
  if (suya) {
    console.log(`Ya está en revisión (solicitud ${suya.id}, ${suya.status}).`);
  } else {
    const verde = await asegurarSuiteBloqueante(vigente.id);
    if (!verde) {
      console.error(
        'La suite bloqueante NO está en verde: el Motor no admitirá la versión a revisión, y hace bien.',
      );
      exit(1);
    }
    const creada = await enviarARevision(vigente.id);
    console.log(`Enviada a revisión (solicitud ${creada.id ?? '?'}).`);
  }
  instruccionesDeAprobacion(vigente.id);
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
    console.log(
      `Desplegada en ${environmentCode} (deployment ${despliegue.id ?? despliegue.deploymentId ?? '?'}).`,
    );
  }
  console.log(
    'Listo. Falta apuntar AtlasBackend: DECISION_ENGINE_RISK_ARTIFACT=RIESGO_ONBOARDING_CLIENTE.',
  );
}

const DEPLOY = args.get('deploy');

(DEPLOY && DEPLOY !== 'true' ? desplegar(DEPLOY) : main()).catch((error) => {
  console.error(error.message);
  exit(1);
});
