#!/usr/bin/env node
/**
 * Crea desde cero `PARTNER_KYB_REVIEW`: la verificación del expediente de un comercio (KYB).
 *
 * ## Qué arregla
 *
 * La definición base de este artefacto NO estaba en el repositorio. Vivía sólo en la base de datos
 * del Motor de DEV, sembrada cuando `src/modules/seeding/data/` existía; ese directorio se borró
 * en `c4084c9` y con él se fue la única copia revisable. Consecuencia práctica: un Motor nuevo (el
 * de TEST en Contabo) no tenía cómo obtenerlo, y `scripts/kyb-revision-manual.mjs` no lo
 * remedia porque es un PARCHE —clona la versión vigente y le corrige un nodo—: asume que el
 * artefacto ya existe en el ambiente destino.
 *
 * Esto es un PUERTO fiel, no una reescritura. La estructura (7 nodos, 6 aristas, 2 condiciones,
 * 2 intermedias, 11 variables, 4 campos del contrato de salida) se copió de la lectura de la
 * versión publicada en DEV y se comprobó nodo por nodo contra ella; los identificadores de la base
 * de origen NO viajan (un id de variable de otra base apunta a otra cosa o a nada), así que las
 * variables se resuelven por código en cada Motor. La definición vive en
 * `scripts/lib/partner-kyb-review.definicion.json` y la ejecuta con el motor real
 * `test/partner-kyb-review.spec.ts`: lo que se publica es lo que se prueba.
 *
 * ## Lo que este guion NO corrige, a propósito
 *
 * En esta versión `REVISAR` es un nodo `RESULT`: el desenlace se llama REVISION_MANUAL pero no abre
 * caso en ninguna cola (`manualReview` sale vacío). Ese defecto lo corrige la versión siguiente,
 * que publica `scripts/kyb-revision-manual.mjs` (convierte `REVISAR` en `MANUAL_REVIEW` con la cola
 * `MERCHANT_KYB`). Adelantarlo aquí mezclaría dos cambios de gobierno en una sola aprobación y
 * dejaría de ser un puerto: quien firme la v1 tiene que poder comprobar que es la que ya circulaba.
 * Por eso el caso KYB-CORREO-SIN-PROBAR-REVISA afirma `outcome: REVISION_MANUAL` (el valor de la
 * salida principal, que es lo que un `RESULT` deja como desenlace) y no `MANUAL_REVIEW`. Cuando la
 * versión 2 se apruebe, ese caso pasa a afirmar `MANUAL_REVIEW` y el caso abierto en la cola.
 *
 * ## Por qué un guion y no una semilla
 *
 * Un artefacto sembrado por debajo del gobierno no se puede revisar en un PR ni pasa por
 * aprobaciones. Esto va por la API de gestión: los mismos permisos, la misma auditoría y la misma
 * cola de gobierno que un cambio hecho a mano.
 *
 * ## Uso
 *
 *   MANAGEMENT_API_KEY=… node scripts/partner-kyb-review.mjs [--base http://127.0.0.1:3020] [--dry-run]
 *   MANAGEMENT_API_KEY=… node scripts/partner-kyb-review.mjs --deploy <versionId> [--environments TEST]
 *
 * El primero crea (o reutiliza) el artefacto, escribe el grafo, compila, corre la suite bloqueante y
 * manda la versión a revisión. El segundo la despliega una vez aprobada por DOS personas (QA_ANALYST
 * y RISK_APPROVER, ninguna la autora) y con la credencial de una TERCERA (RELEASE_MANAGER): con la
 * misma que la creó el Motor responde 403 SEPARATION_OF_DUTIES_VIOLATION. Están separados porque el
 * gobierno del Motor lo exige.
 *
 * `--environments` (por defecto TEST) admite una lista: DEV, TEST, STAGING… El código tiene que
 * existir en el Motor destino. El de Contabo sólo tiene STAGING, que es el que AtlasBackend de TEST
 * ya envía: allí se corre con `--environments STAGING`, y el guion lo avisa antes de que un
 * despliegue falle a medias en vez de descubrirlo por el 404.
 *
 * Es idempotente: las variables se reutilizan si ya existen; si la versión vigente ya está
 * compilada no se reescribe el grafo; si ya hay solicitud de aprobación no se crea otra; si ya está
 * desplegada no hace nada. `--dry-run` sólo LEE: dice qué haría y no escribe nada.
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
const ENVIRONMENTS = (args.get('environments') ?? 'TEST')
  .split(',')
  .map((code) => code.trim())
  .filter(Boolean);
const DRY_RUN = args.get('dry-run') === 'true';

const DEFINICION = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'lib', 'partner-kyb-review.definicion.json'),
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
/* Ambientes                                                                                    */
/* ------------------------------------------------------------------------------------------ */

/**
 * Los códigos de ambiente que ESTE Motor conoce, o `null` si no se pudieron leer.
 *
 * El catálogo lo puede leer un rol de consulta pero quizá no la credencial que despliega, y un
 * despliegue no debe fallar por no poder mirar una lista: `null` significa «no lo sé», y quien
 * llama lo trata como «no hay nada que objetar», no como «no existe».
 */
async function ambientesDelMotor() {
  try {
    const codigos = items(await api('/v1/environments')).map((ambiente) =>
      String(ambiente.code ?? ambiente.environmentCode ?? '').toUpperCase(),
    );
    return codigos.filter(Boolean).length > 0 ? codigos.filter(Boolean) : null;
  } catch (error) {
    console.log(`(no se pudo leer el catálogo de ambientes: ${error.message})`);
    return null;
  }
}

/** Los ambientes pedidos que el Motor no tiene, para decirlo ANTES de aprobar o desplegar nada. */
async function ambientesQueFaltan() {
  const existentes = await ambientesDelMotor();
  if (!existentes) return { faltan: [], existentes: [] };
  return {
    faltan: ENVIRONMENTS.filter((codigo) => !existentes.includes(codigo.toUpperCase())),
    existentes,
  };
}

function textoDeAmbientesQueFaltan({ faltan, existentes }) {
  return (
    `El Motor ${BASE} no tiene el ambiente ${faltan.join(', ')}; los que existen son ` +
    `${existentes.join(', ')}. Usa --environments con uno de esos (en Contabo, STAGING).`
  );
}

/* ------------------------------------------------------------------------------------------ */
/* Reason codes                                                                                 */
/* ------------------------------------------------------------------------------------------ */

/**
 * Este artefacto no declara motivos ni acciones —sus desenlaces son nodos `RESULT` con las
 * salidas mapeadas— pero la definición conserva la lista por si una versión futura los añade, y el
 * atajo evita una lectura del catálogo que no tiene nada que buscar.
 */
async function asegurarReasonCodes() {
  const ids = new Map();
  if (!DEFINICION.reasonCodes?.length) return ids;
  const existentes = await todas('/v1/reason-codes');
  const porCodigo = new Map(existentes.map((reason) => [reason.reasonCode, reason]));
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
      // Las salidas de la versión de origen son DERIVED; la definición lo dice por variable y sólo
      // si falta se cae al origen que el guion de riesgo usa para lo que produce un nodo.
      expectedOrigin: definicion.expectedOrigin ?? (esEntrada ? 'REQUEST' : 'GRAPH_NODE'),
      contractVersion: '1',
      sources: [
        {
          sourceSystemCode: esEntrada ? 'REQUEST_PAYLOAD' : 'DECISION_ENGINE',
          sourcePath: esEntrada ? '$.variables' : '$.output',
          sourceField: definicion.code,
          // El origen tenía 0 en las salidas (una salida no envejece), pero la API exige >= 1: se
          // pone el mismo 60 que en las entradas, que en una salida no se evalúa nunca.
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
      // El código es único por inquilino: si ya existe se reutiliza en vez de duplicarlo. Pero un
      // código igual no garantiza el mismo contrato, y atar el grafo a una variable de otro tipo
      // haría que el Motor rechazara cada expediente en tiempo de ejecución, no al crear.
      if (ultima.dataType && ultima.dataType !== variable.dataType) {
        throw new Error(
          `La variable ${variable.code} ya existe como ${ultima.dataType} y este artefacto la necesita ${variable.dataType}: no se reutiliza.`,
        );
      }
      versiones.set(variable.code, String(ultima.id));
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

/**
 * De la definición (que conserva la forma de LECTURA del grafo de origen) a lo que exige el PUT.
 *
 * Las dos formas no son la misma y la diferencia no avisa: la respuesta de un GET llama
 * `{ code, order }` a los enlaces de condición y `required` a la obligatoriedad de una dependencia,
 * y la escritura exige `{ conditionCode, order }` e `isRequired`. Reenviar la lectura tal cual
 * responde 400 quejándose de un campo que la respuesta anterior sí traía, con otro nombre. La
 * definición ya guarda los nombres de ESCRITURA, y aquí se completa lo que la lectura no da (el
 * contrato de las intermedias, la sensibilidad, la política de traza).
 */
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
        // Una salida no se «recupera» con un plan B: la produce el grafo. Es la misma convención
        // que ya usa el importador de código (`code-import.service.ts`) y la de la versión de origen.
        fallbackPolicy: 'NOT_APPLICABLE',
      })),
    ],
    conditions: DEFINICION.conditions,
    actions: (DEFINICION.actions ?? []).map((action) => ({
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
      // La versión de origen los dejó todos en (0, 0), que en el editor es una pila ilegible; el
      // flujo en línea con los tres desenlaces a la derecha se ve de un vistazo. No afecta a nada
      // que el Motor ejecute.
      x: node.x ?? (index % 4) * 260,
      y: node.y ?? Math.floor(index / 4) * 160,
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
      // El origen de cada campo NO es el mismo para todos: la decisión y el motivo salen del nodo
      // EVALUAR y los dos contadores de una intermedia. Ponerlos todos como NODE/EVALUAR (lo que
      // hace el guion de riesgo, donde sí es cierto) declararía un origen falso para dos campos.
      sourceKind: output.sourceKind,
      sourceRef: output.sourceRef,
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

/**
 * Crea la suite bloqueante si falta y la ejecuta. Devuelve `true` si quedó en verde.
 *
 * Que sea BLOQUEANTE es el punto: sin una suite bloqueante en verde `submit-for-review` responde
 * 409 `BLOCKING_TESTS_NOT_PASSED / NO_BLOCKING_TEST_SUITE`. Es la diferencia entre una política
 * probada y una publicada. La corrida es ASÍNCRONA (nace `QUEUED`): se espera el veredicto, y se
 * cuenta sobre `caseRuns`, que es lo que la respuesta trae de verdad.
 */
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

/** Envía la versión a la cola de gobierno. Enviar NO es aprobar: eso son dos personas. */
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
    `  3. Y entonces, con la credencial del RELEASE_MANAGER (no la de quien corrió esto): node scripts/partner-kyb-review.mjs --deploy ${versionId} --environments ${ENVIRONMENTS.join(',')}`,
  );
  console.log(
    '  4. Después, node scripts/kyb-revision-manual.mjs prepara la versión 2, la que hace que REVISAR abra caso.',
  );
  console.log('');
  console.log(
    'Ninguno de los tres puede ser quien corrió esto: la versión la creó este principal. Con la misma credencial el Motor responde 403 SEPARATION_OF_DUTIES_VIOLATION.',
  );
}

/* ------------------------------------------------------------------------------------------ */
/* Flujo principal                                                                              */
/* ------------------------------------------------------------------------------------------ */

async function main() {
  const ambientes = await ambientesQueFaltan();
  if (ambientes.faltan.length > 0) {
    // Sólo aviso: crear y enviar a revisión no necesita el ambiente, pero enterarse ahora evita
    // que dos personas firmen una versión que luego no se puede desplegar donde se dijo.
    console.log(`AVISO: ${textoDeAmbientesQueFaltan(ambientes)}`);
  }

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
  const ambientes = await ambientesQueFaltan();
  if (ambientes.faltan.length > 0) {
    // Aquí sí es un error: un despliegue a un ambiente inexistente falla, y si el primero de la
    // lista existe y el segundo no, el guion dejaría la versión desplegada a medias.
    throw new Error(textoDeAmbientesQueFaltan(ambientes));
  }
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
    `Listo. Comprueba con una ejecución real (POST /v1/decisions/${ARTIFACT_CODE}, credencial de runtime): tiene que responder COMPLETED, y un expediente sin QR bancario, RECHAZADO.`,
  );
}

const DEPLOY = args.get('deploy');

(DEPLOY && DEPLOY !== 'true' ? desplegar(DEPLOY) : main()).catch((error) => {
  console.error(error.message);
  exit(1);
});
