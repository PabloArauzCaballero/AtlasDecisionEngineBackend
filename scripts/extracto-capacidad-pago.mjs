#!/usr/bin/env node
/**
 * Publica `EXTRACTO_CAPACIDAD_PAGO`: la capacidad de pago verificada por extracto bancario, como
 * artefacto creado DESDE CERO por la API de gestión.
 *
 * ## Qué arregla
 *
 * La definición base de este artefacto vivía sólo en la base de datos del Motor de DEV: la
 * sembraban `src/modules/seeding/data/statement-worker-demo.{graph,seed}.ts`, que se fueron con
 * las semillas del repositorio (`c4084c9`). Sin ella no hay forma de levantar el artefacto en un
 * Motor nuevo (el de Contabo arranca vacío), ni de revisar un cambio suyo en un PR, ni de saber
 * qué se aprobó. Hallazgo M-1 de `_plan-motor-decisiones-tasa-2026-09-25/PLAN.md`.
 *
 * Esto es un PUERTO FIEL, no una reescritura: el mismo grafo (8 nodos, 7 aristas, 3 condiciones,
 * 10 intermedias, 4 campos de contrato), extraído de la versión 1 (1.1.0, `COMPILED`, checksum
 * `91769ea0…`) del Motor de DEV y traducido de la forma de LECTURA a la de ESCRITURA. Lo único
 * nuevo es la suite bloqueante, que la versión original no tenía. La definición vive en
 * `scripts/lib/extracto-capacidad-pago.definicion.json`; los cuerpos de petición, en
 * `scripts/lib/extracto-capacidad-pago.cuerpos.cjs`, y `test/extracto-capacidad-pago.spec.ts` los
 * valida contra los DTO y el validador de grafo reales: lo que se publica es lo que se prueba.
 *
 * ## Qué hace el algoritmo
 *
 *   START → ANALIZAR_EXTRACTO (WORKER bank-statement.normalize) → DERIVAR_CAPACIDAD → EVALUAR
 *
 * y de EVALUAR sale a uno de cuatro desenlaces, por este orden: `REVISION_MANUAL` si el extracto
 * no es fiable (la llamada falló, confianza < 0,6 o menos de 5 movimientos); `APROBADO` si los
 * abonos cubren la cuota 3 veces o más; `APROBADO_CON_CONDICIONES` si la cubren 1,5 veces o más;
 * `RECHAZADO` en el resto. El ingreso son los abonos del periodo, sin separar nómina de otros
 * abonos: es una simplificación de la versión original y se porta tal cual.
 *
 * ## Uso
 *
 *   MANAGEMENT_API_KEY=… node scripts/extracto-capacidad-pago.mjs [--base http://127.0.0.1:3020] [--dry-run]
 *   MANAGEMENT_API_KEY=… node scripts/extracto-capacidad-pago.mjs --deploy <versionId> [--environments TEST]
 *
 * El primero crea (o reutiliza) las variables y el artefacto, escribe el grafo, compila, corre la
 * suite bloqueante y manda la versión a revisión. El segundo la despliega una vez aprobada por DOS
 * personas (QA_ANALYST y RISK_APPROVER, ninguna la autora). Están separados porque el gobierno del
 * Motor lo exige: quien crea una versión no puede aprobarla, y este guion NO despliega por su cuenta.
 *
 * `--environments` es una lista separada por comas de DEV, TEST y STAGING; por defecto `TEST`. PROD
 * se rechaza a propósito: una primera salida a producción de este artefacto es una decisión de
 * personas, y además el gate económico del Motor la pararía (es una originación sin PD declarada).
 * Ojo: el Motor de Contabo sólo tiene el ambiente STAGING, así que contra él hay que pasar
 * `--environments STAGING`. Con el valor por defecto el guion se detiene antes de desplegar
 * en ninguno: comprueba contra `GET /v1/environments` que todos existan y estén activos.
 *
 * ## Primera vez que este artefacto se despliega en cualquier ambiente
 *
 * La versión 1 de DEV quedó `COMPILED` y JAMÁS se desplegó: no hay un despliegue previo cuyo
 * comportamiento haya sido observado en ningún ambiente. Conviene que quienes aprueban miren con
 * atención extra el grafo y los desenlaces de la suite, y que después del despliegue se haga una
 * ejecución real con un extracto (`POST /v1/simulations/EXTRACTO_CAPACIDAD_PAGO`) antes de darlo
 * por bueno.
 *
 * ## Lo que la suite necesita del Motor donde se corra
 *
 * Los casos llevan PDF de verdad y el nodo los procesa con el worker de extractos REAL, así que el
 * Motor tiene que tener `BANK_STATEMENT_WORKER_ENABLED=true` (el guion lo comprueba antes de crear
 * nada), el padrón de entidades cargado y —con lo que es su valor por defecto—
 * `BANK_STATEMENT_ENFORCE_MINIMUM_MONTHS=false`. Con la exigencia de tres meses naturales
 * completos encendida, ningún extracto vigente la cumple salvo en los tres primeros días del mes.
 *
 * Los documentos se generan en el momento con fecha de ayer (`scripts/lib/extracto-pdf-sintetico.cjs`)
 * porque la compuerta de vigencia rechaza extractos con más de tres días. Por la misma razón la
 * suite se crea y se corre EN LA MISMA PASADA, y por la misma razón el guion no puede repararla
 * después: la API no permite editar ni borrar una suite. Si queda en rojo, la versión no puede
 * pasar a revisión y hay que clonarla.
 *
 * Es idempotente: las variables se reutilizan si ya existen; el artefacto también; si la versión ya
 * está compilada no se reescribe el grafo; si la suite ya tiene una corrida verde no se repite; y si
 * la versión ya está en revisión, aprobada o desplegada, sólo lo dice.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argv, env, exit } from 'node:process';
import cuerpos from './lib/extracto-capacidad-pago.cuerpos.cjs';

const { casosDeLaSuite, cuerpoDeArtefacto, cuerpoDeVariable, cuerpoDelGrafo } = cuerpos;

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
const AMBIENTES_VALIDOS = ['DEV', 'TEST', 'STAGING'];
const ENVIRONMENTS = (args.get('environments') ?? 'TEST')
  .split(',')
  .map((code) => code.trim().toUpperCase())
  .filter(Boolean);
const DRY_RUN = args.get('dry-run') === 'true';

const DEFINICION = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'lib', 'extracto-capacidad-pago.definicion.json'),
    'utf8',
  ),
);
const ARTIFACT_CODE = DEFINICION.artifact.artifactCode;
const SUITE = DEFINICION.suite;

if (!API_KEY) {
  console.error(
    'Falta MANAGEMENT_API_KEY: es la credencial del plano de gestión (la de runtime NO sirve aquí).',
  );
  exit(1);
}

const invalidos = ENVIRONMENTS.filter((code) => !AMBIENTES_VALIDOS.includes(code));
if (ENVIRONMENTS.length === 0 || invalidos.length > 0) {
  console.error(
    `--environments admite ${AMBIENTES_VALIDOS.join(', ')} (recibido: ${invalidos.join(', ') || 'nada'}). ` +
      'PROD no se despliega desde este guion.',
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
  // Se mira el estado ANTES de interpretar el cuerpo: un 502 con HTML de un proxy reventaba en
  // `JSON.parse` y el mensaje hablaba de un «token inesperado» en vez del 502.
  if (!response.ok) {
    throw new Error(
      `${options.method ?? 'GET'} ${path} → ${response.status}: ${text.slice(0, 600)}`,
    );
  }
  return text ? JSON.parse(text) : null;
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

const masReciente = (versiones) =>
  versiones.reduce(
    (mejor, version) =>
      !mejor || Number(version.versionNumber) > Number(mejor.versionNumber) ? version : mejor,
    null,
  );

/* ------------------------------------------------------------------------------------------ */
/* Variables                                                                                    */
/* ------------------------------------------------------------------------------------------ */

/** Devuelve `código → variableVersionId` (la versión más reciente de cada definición). */
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
      const ultima = masReciente(detalle.versions ?? []);
      if (!ultima) throw new Error(`La variable ${variable.code} existe sin versiones.`);
      // El código es único por inquilino y se reutiliza, pero sólo si significa lo mismo: una
      // variable con otro tipo rompería el grafo al compilar, y una `extracto_pdf_base64` que no
      // esté marcada como sensible haría que el motor guardase el PDF entero en cada ejecución.
      if (String(ultima.dataType).toUpperCase() !== variable.dataType) {
        throw new Error(
          `La variable ${variable.code} ya existe como ${ultima.dataType} y este artefacto la necesita como ${variable.dataType}.`,
        );
      }
      if (variable.isSensitive && detalle.isSensitive === false) {
        throw new Error(
          `La variable ${variable.code} ya existe SIN marcar como sensible: reutilizarla guardaría el documento en cada ejecución. Revísala antes de seguir.`,
        );
      }
      versiones.set(variable.code, String(ultima.id));
      console.log(`Variable ${variable.code} ya existe (versión ${ultima.id}): se reutiliza.`);
      avisarSiSensitivityClassNoViajo(variable, detalle);
      continue;
    }
    if (DRY_RUN) {
      console.log(
        `[dry-run] crearía la variable ${variable.code} (${variable.dataType}, ${variable.direccion}${variable.isSensitive ? ', sensible' : ''})`,
      );
      versiones.set(variable.code, 'dry-run');
      continue;
    }
    const creada = await api('/v1/variables', {
      method: 'POST',
      body: JSON.stringify(cuerpoDeVariable(DEFINICION, variable, variable.direccion)),
    });
    const version = (creada.versions ?? [])[0];
    if (!version) throw new Error(`La API creó ${variable.code} sin devolver su versión.`);
    versiones.set(variable.code, String(version.id));
    console.log(
      `Variable ${variable.code} creada (definición ${creada.id}, versión ${version.id}).`,
    );
    avisarSiSensitivityClassNoViajo(variable, creada);
  }
  return versiones;
}

/**
 * `POST /v1/variables` no tiene forma de escribir `sensitivityClass` (sólo lo declara
 * `UpdateVariableDefinitionDto`, y ese DTO no está cableado a ninguna ruta — no es un `--dry-run`
 * de este guion, es que el Motor no expone cómo corregirlo hoy). Una variable que en el origen
 * llevaba PII o más queda silenciosamente en INTERNAL, el valor por defecto del esquema. Avisar
 * aquí es la única red de seguridad hasta que el Motor exponga el PATCH que le falta.
 */
function avisarSiSensitivityClassNoViajo(variable, creada) {
  const esperado = variable._sensitivityClassEnOrigen;
  if (!esperado || esperado === 'INTERNAL') return;
  const real = String(creada.sensitivityClass ?? 'INTERNAL');
  if (real === esperado) return;
  console.warn(
    `⚠️  ${variable.code}: el origen la declara sensitivityClass=${esperado}, pero la API de alta ` +
      `no acepta ese campo y quedó en ${real}. Esto NO lo corrige este guion: hoy no existe un ` +
      `PATCH de variables que lo permita (UpdateVariableDefinitionDto existe pero no está montado ` +
      `en ninguna ruta). Corregirlo requiere un cambio en el Motor o una escritura directa en la base.`,
  );
}

/* ------------------------------------------------------------------------------------------ */
/* Suite bloqueante y gobierno                                                                  */
/* ------------------------------------------------------------------------------------------ */

async function esperarCorrida(runId, intentos = 90) {
  let detalle = await api(`/v1/test-runs/${runId}`);
  for (let i = 0; i < intentos; i += 1) {
    const estado = String(detalle.status ?? detalle.runStatus ?? '').toUpperCase();
    if (estado && !['QUEUED', 'RUNNING', 'PENDING'].includes(estado)) return detalle;
    await new Promise((listo) => setTimeout(listo, 1_000));
    detalle = await api(`/v1/test-runs/${runId}`);
  }
  return detalle;
}

/** ¿Está el worker de extractos disponible en ESTE Motor? Es la misma bandera que publica `GET /v1/workers`. */
async function workerDeExtractosDisponible() {
  const catalogo = items(await api('/v1/workers'));
  return catalogo.find((worker) => worker.code === 'bank-statement')?.available === true;
}

/**
 * El gate de gobierno exige, además de la corrida en verde, un 80 % de cobertura de NODOS
 * (`TestExecutionService.verifyBlockingTests`). Esta suite recorre los 8 (100 %); se comprueba
 * igualmente sobre lo que devuelve el Motor para no descubrirlo en el 409 de `submit-for-review`.
 */
function coberturaDeNodos(corrida) {
  const nodos = (corrida.coverage ?? []).find((item) => item.coverageType === 'NODE');
  return nodos ? Number(nodos.coveragePercentage) : null;
}

/** Ejecuta la suite y devuelve `true` si la corrida quedó en verde con cobertura suficiente. */
async function correrSuite(suite) {
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
  const cobertura = coberturaDeNodos(detalle);
  console.log(
    `Corrida ${runId}: ${estado} · ${casos.length - fallados.length} en verde, ${fallados.length} en rojo · ` +
      `cobertura de nodos ${cobertura === null ? 'sin dato' : `${cobertura} %`}.`,
  );
  for (const caso of fallados) {
    const discrepancias = (caso.assertions ?? [])
      .filter((asercion) => asercion.passed === false)
      .map(
        (asercion) =>
          `${asercion.assertionPath}: esperado ${JSON.stringify(asercion.expectedJson)}, real ${JSON.stringify(asercion.actualJson)}`,
      );
    console.log(
      `  ✗ ${caso.testCase?.caseCode ?? caso.caseCode ?? '?'}: ${discrepancias.join(' · ') || JSON.stringify(caso.errorJson ?? caso.error ?? null)}`.slice(
        0,
        700,
      ),
    );
  }
  if (fallados.length > 0) {
    console.log(
      '  Si fallan TODOS los casos con documento y salen en REVISION_MANUAL, la causa está en el worker de extractos ' +
        'del Motor y no en el grafo: BANK_STATEMENT_RECENCY_ENFORCE / BANK_STATEMENT_ENFORCE_MINIMUM_MONTHS, el padrón ' +
        'de entidades sin cargar, o el reloj del servidor.',
    );
  }
  return (
    casos.length > 0 &&
    fallados.length === 0 &&
    estado === 'PASSED' &&
    (cobertura === null || cobertura >= 80)
  );
}

/**
 * Crea la suite bloqueante si falta y la ejecuta. Devuelve `true` si quedó en verde.
 *
 * Una suite ya creada NO se rehace: si tiene una corrida verde el gate está satisfecho para
 * siempre (mira la última corrida PASSED, no la última corrida); si no la tiene, se vuelve a
 * ejecutar una vez, pero sus documentos ya tienen la fecha de cuando se creó.
 */
async function asegurarSuiteBloqueante(versionId) {
  const existentes = await todas(`/v1/artifact-versions/${versionId}/test-suites`);
  let suite = existentes.find((s) => s.suiteCode === SUITE.suiteCode);

  if (suite) {
    const verde = (suite.runs ?? []).some((run) => String(run.status).toUpperCase() === 'PASSED');
    if (verde) {
      console.log(`Suite ${SUITE.suiteCode} ya existe (id ${suite.id}) y tiene una corrida verde.`);
      return true;
    }
    console.log(
      `Suite ${SUITE.suiteCode} ya existe (id ${suite.id}) sin ninguna corrida verde: se ejecuta de nuevo. ` +
        'Ojo: sus documentos se generaron cuando se creó y la compuerta de vigencia rechaza los de más de tres días.',
    );
  } else {
    // Antes de crear NADA que no se pueda borrar. Una suite bloqueante en rojo deja la versión
    // sin poder pasar a revisión para siempre, y con el worker apagado todos los casos con
    // documento acaban en revisión manual, así que sería rojo seguro.
    if (!(await workerDeExtractosDisponible())) {
      console.error(
        'El worker de extractos NO está disponible en este Motor (BANK_STATEMENT_WORKER_ENABLED). ' +
          'No se crea la suite: con el worker apagado los casos con documento no pueden pasar, y una suite bloqueante ' +
          'en rojo no se puede editar ni borrar por la API. La versión queda COMPILADA; enciende el worker y vuelve a lanzar el guion.',
      );
      return false;
    }
    const casos = casosDeLaSuite(DEFINICION, { hoy: new Date() });
    suite = await api(`/v1/artifact-versions/${versionId}/test-suites`, {
      method: 'POST',
      body: JSON.stringify({ ...SUITE, cases: casos }),
    });
    console.log(`Suite ${SUITE.suiteCode} creada con ${casos.length} casos.`);
  }

  const verde = await correrSuite(suite);
  if (!verde) {
    console.error(
      `La suite ${SUITE.suiteCode} quedó EN ROJO y no se puede editar ni borrar por la API. ` +
        'Esta versión no podrá pasar a revisión: corrige la causa y clona la versión (POST /v1/artifact-versions/:id/clone).',
    );
  }
  return verde;
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
    `  3. Y entonces: node scripts/extracto-capacidad-pago.mjs --deploy ${versionId} --environments ${ENVIRONMENTS.join(',')}`,
  );
  console.log('');
  console.log(
    'Ninguno de los tres puede ser quien corrió esto: la versión la creó este principal. Y es la PRIMERA',
  );
  console.log(
    'vez que este artefacto se despliega en cualquier ambiente: que quien revise mire el grafo con atención.',
  );
}

/* ------------------------------------------------------------------------------------------ */
/* Flujo principal                                                                              */
/* ------------------------------------------------------------------------------------------ */

/** Escribe el grafo y compila. Si la validación no pasa, la API contesta 2xx con `compiledArtifact: null`. */
async function escribirYCompilar(vigente, versiones) {
  if (['DRAFT', 'VALIDATION_FAILED'].includes(vigente.status)) {
    const escrito = await api(`/v1/artifact-versions/${vigente.id}/graph`, {
      method: 'PUT',
      headers: { 'if-match': String(vigente.lockVersion ?? 1) },
      body: JSON.stringify(cuerpoDelGrafo(DEFINICION, versiones)),
    });
    console.log(`Grafo escrito (lockVersion ${escrito.lockVersion ?? '?'}).`);
  }
  const respuesta = await api(`/v1/artifact-versions/${vigente.id}/validate-and-compile`, {
    method: 'POST',
    body: '{}',
  });
  if (!respuesta?.compiledArtifact) {
    // El template de los otros guiones seguía adelante aquí con «sin checksum en la respuesta» y
    // fallaba después, en el 409 de la revisión, lejos de la causa.
    console.error('La validación del grafo NO pasó, así que no hay versión compilada:');
    const informe = respuesta?.validation ?? {};
    for (const problema of informe.errors ?? [JSON.stringify(informe)]) {
      console.error(`  ✗ ${typeof problema === 'string' ? problema : JSON.stringify(problema)}`.slice(0, 500));
    }
    exit(1);
  }
  console.log(
    `Compilada: ${respuesta.compiledArtifact.compiledChecksum ?? 'sin checksum en la respuesta'}.`,
  );
}

async function main() {
  const versiones = await asegurarVariables();

  const lista = await todas('/v1/artifacts');
  let artefacto = lista.find((item) => (item.artifactCode ?? item.code) === ARTIFACT_CODE);
  if (!artefacto) {
    if (DRY_RUN) {
      const casos = casosDeLaSuite(DEFINICION, { hoy: new Date() });
      console.log(
        `[dry-run] crearía el artefacto ${ARTIFACT_CODE}, escribiría su grafo (${DEFINICION.nodes.length} nodos, ` +
          `${DEFINICION.edges.length} aristas), lo compilaría y crearía la suite ${SUITE.suiteCode} con ${casos.length} casos ` +
          `(bloqueante: ${SUITE.isBlocking}).`,
      );
      return;
    }
    artefacto = await api('/v1/artifacts', {
      method: 'POST',
      body: JSON.stringify(cuerpoDeArtefacto(DEFINICION)),
    });
    console.log(`Artefacto ${ARTIFACT_CODE} creado (id ${artefacto.id}).`);
    const primera = (artefacto.versions ?? [])[0];
    if (primera && DEFINICION.artifact.authoringNotes) {
      await api(`/v1/artifact-versions/${primera.id}/notes`, {
        method: 'PATCH',
        body: JSON.stringify({ notes: DEFINICION.artifact.authoringNotes }),
      }).catch((error) => console.log(`(notas de autoría no escritas: ${error.message})`));
    }
  }

  const detalle = await api(`/v1/artifacts/${artefacto.id}`);
  const vigente = masReciente(detalle.versions ?? []);
  if (!vigente) throw new Error(`${ARTIFACT_CODE} no tiene versiones.`);
  const estado = String(vigente.status);
  console.log(`Versión vigente ${vigente.versionNumber} (id ${vigente.id}): ${estado}.`);

  if (estado.startsWith('DEPLOYED')) {
    console.log('Ya está desplegada: nada que hacer.');
    return;
  }
  if (estado === 'APPROVED') {
    console.log(
      `Ya está aprobada: falta desplegarla con --deploy ${vigente.id} --environments ${ENVIRONMENTS.join(',')}.`,
    );
    return;
  }
  if (estado === 'IN_REVIEW') {
    console.log('Ya está en revisión. Faltan las aprobaciones.');
    instruccionesDeAprobacion(vigente.id);
    return;
  }
  if (!['DRAFT', 'VALIDATION_FAILED', 'VALIDATED', 'COMPILED'].includes(estado)) {
    throw new Error(
      `La versión ${vigente.versionNumber} está en ${estado}: este guion no la puede continuar. Clónala desde el portal y vuelve a lanzarlo.`,
    );
  }

  if (estado !== 'COMPILED') {
    if (DRY_RUN) {
      console.log(
        `[dry-run] ${['DRAFT', 'VALIDATION_FAILED'].includes(estado) ? `escribiría el grafo (${DEFINICION.nodes.length} nodos, ${DEFINICION.edges.length} aristas) y ` : ''}compilaría.`,
      );
      return;
    }
    await escribirYCompilar(vigente, versiones);
  } else if (DRY_RUN) {
    console.log('[dry-run] la versión ya está compilada; sólo comprobaría la suite y enviaría a revisión.');
    return;
  }

  const verde = await asegurarSuiteBloqueante(vigente.id);
  if (!verde) exit(1);
  const creada = await enviarARevision(vigente.id);
  console.log(`Enviada a revisión (solicitud ${creada.id ?? '?'}).`);
  instruccionesDeAprobacion(vigente.id);
}

/** Despliega una versión YA aprobada. Se separa porque el permiso para hacerlo es de otra persona. */
async function desplegar(versionId) {
  // Que el id sea de ESTE artefacto: un id equivocado desplegaría en un ambiente lo que no es.
  const version = await api(`/v1/artifact-versions/${versionId}`);
  if (version?.artifact?.artifactCode !== ARTIFACT_CODE) {
    throw new Error(
      `La versión ${versionId} es de ${version?.artifact?.artifactCode ?? 'otro artefacto'}, no de ${ARTIFACT_CODE}.`,
    );
  }
  if (!['APPROVED', 'DEPLOYED_TO_DEV', 'DEPLOYED_TO_TEST', 'DEPLOYED_TO_STAGING'].includes(version.status)) {
    throw new Error(
      `La versión ${versionId} está en ${version.status}: sólo se despliega una versión APROBADA por dos personas.`,
    );
  }
  // Todos los ambientes ANTES de desplegar en el primero: si el segundo no existe, el primero ya
  // estaría desplegado y la versión a medio camino.
  const ambientes = items(await api('/v1/environments'));
  for (const environmentCode of ENVIRONMENTS) {
    const ambiente = ambientes.find((item) => item.code === environmentCode);
    if (!ambiente || ambiente.status !== 'ACTIVE' || ambiente.isProduction) {
      throw new Error(
        `El ambiente ${environmentCode} no existe en este Motor, no está activo o es de producción. ` +
          `Ambientes activos: ${ambientes.filter((item) => item.status === 'ACTIVE' && !item.isProduction).map((item) => item.code).join(', ') || 'ninguno'}.`,
      );
    }
  }
  if (DRY_RUN) {
    console.log(`[dry-run] desplegaría la versión ${versionId} en ${ENVIRONMENTS.join(', ')}.`);
    return;
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
    'Listo. Es el primer despliegue de este artefacto en cualquier ambiente: haz una ejecución real ' +
      `(POST /v1/simulations/${ARTIFACT_CODE}) con un extracto vigente antes de darlo por bueno.`,
  );
}

const DEPLOY = args.get('deploy');

(DEPLOY && DEPLOY !== 'true' ? desplegar(DEPLOY) : main()).catch((error) => {
  console.error(error.message);
  exit(1);
});
