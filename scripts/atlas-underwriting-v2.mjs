#!/usr/bin/env node
/**
 * Publica `ATLAS_BNPL_UNDERWRITING` v2: el underwriting con puntaje, PD, banda y precio reales.
 *
 * ## Qué arregla
 *
 * La v1 desplegada en PROD (versión 371) es primitiva: START → APPROVE/DECLINE con 5 entradas y
 * sin puntaje. El precio del crédito lo decide hoy la tasa fija del producto o lo que escriba el
 * operador al desembolsar, sin tope y sin motivo (T-1); si el producto no tiene tasa, se cobra 0 %.
 * Esta v2 pasa el Paso 0 (compuertas duras de identidad/sanciones/fraude/jurisdicción/señales
 * técnicas, en orden de prioridad — defensa en profundidad: el alta debería haber bloqueado ya lo
 * que no pasa identidad), puntúa con las ~56 señales que Core YA manda, deriva `probability_of_default`
 * y `risk_band` (A-E) por tabla, y sólo si aprueba (A-D) tarifa: `annual_percentage_rate` =
 * `product_base_annual_rate` (única variable nueva; Core la manda desde
 * `credit_products.annual_interest_rate` convertida a tanto por uno) + la prima de la banda
 * (A:0 B:6 C:14 D:24 pt, aprobadas por Pablo — D-P2, 2026-09-25) / 100. E rechaza de verdad
 * (`RIESGO_EXCEDE_EL_LIMITE`): a diferencia de `RIESGO_ONBOARDING_CLIENTE`, que nunca rechaza
 * (D-P3), aquí SÍ hay desenlace de rechazo porque es la decisión de originar crédito, no de dar
 * de alta un cliente.
 *
 * ## Por qué clona en vez de crear
 *
 * El artefacto YA EXISTE (`ATLAS_BNPL_UNDERWRITING`, v1 desplegada). v2 es una VERSIÓN NUEVA del
 * MISMO artefacto — el mismo patrón que `kyb-revision-manual.mjs` usó para pasar `REVISAR` de
 * `RESULT` a `MANUAL_REVIEW`, salvo que aquí el grafo se REEMPLAZA entero (v1 no tiene puntaje del
 * que partir). Este guion falla si el artefacto no existe: crearlo desde cero no es su trabajo.
 *
 * ## Uso
 *
 *   MANAGEMENT_API_KEY=… node scripts/atlas-underwriting-v2.mjs [--base http://127.0.0.1:3020] [--dry-run]
 *   MANAGEMENT_API_KEY=… node scripts/atlas-underwriting-v2.mjs --deploy <versionId> [--environments DEV,TEST]
 *   MANAGEMENT_API_KEY=… node scripts/atlas-underwriting-v2.mjs --crear [--environments STAGING]   (entorno sin crédito: esta definición es la v1)
 *
 * El primero clona la versión vigente, escribe el grafo de v2 entero, compila, corre la suite
 * bloqueante y manda a revisión. El segundo despliega una versión YA aprobada por dos personas
 * (QA_ANALYST y RISK_APPROVER, ninguna la autora) — separado porque el gobierno del Motor lo exige
 * y porque M-2 del plan pone el `--deploy` en otra credencial (RELEASE_MANAGER).
 *
 * Es idempotente: si ya hay un borrador con el grafo de v2 escrito, lo reutiliza; si ya hay
 * solicitud de aprobación, no crea otra.
 *
 * ## 2.1.0: el CUÁNTO, y una frescura que se puede cumplir (2026-10-05)
 *
 * La 2.0.0 decía sí/no y a qué precio, pero no cuánto: no emitía `approved_credit_limit`, y la
 * línea que la app enseña como tarjeta principal quedaba en 0 o sin escribir. La 2.1.0 lo emite
 * (capacidad recomendada por Core × factor de la banda; ver `authoringNotes` de la definición).
 * Además, sus 37 variables exigían 60 s de frescura y Core manda la fecha REAL del dato: en TEST las
 * 67 ejecuciones de la 2.0.0 acabaron en `NO_DECISION`. Por eso el guion, además de crear las
 * variables que faltan, crea una VERSIÓN NUEVA de las que ya existen cuando la definición declara
 * otra frescura u otra obligatoriedad (`contratoPendiente`). Los demás artefactos siguen atados a la
 * versión vieja por id: no les cambia nada.
 *
 * ## 2.2.0: vetos, banda D y tope de usura (revisión financiera, 2026-10-06)
 *
 * Con las fórmulas de la 2.1.0 un cliente con 95 días de mora salía en banda C aprobado, uno con un
 * castigo también, y un desempleado con Bs 1.000 en D: el puntaje compensaba cualquier cosa y E
 * empezaba en más de 180 puntos. La 2.2.0 pone tres vetos entre las compuertas y el puntaje
 * (`RECHAZAR_POR_VETO`, límite 0), deja de financiar la banda D (con el tope de usura su prima no se
 * cobra y la pérdida esperada no se cubre), recorta `annual_percentage_rate` al `usury_cap_rate` que
 * Core ya mandaba, y suma la conducta del extracto verificado (cinco `statement_*` opcionales).
 * Necesita AtlasBackend con `fix/credito-vetos-y-senales-reales` para recibir esas variables; sin él
 * decide igual (son opcionales) y sólo pierde la parte del extracto. Detalle en `authoringNotes`.
 */
import { argv, env, exit } from 'node:process';

// Como módulo JSON y no con `readFileSync`: la definición es código del repo, no un dato de entrada.
import DEFINICION from './lib/atlas-underwriting-v2.definicion.json' with { type: 'json' };

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
const CREAR = args.get('crear') === 'true';

const ARTIFACT_CODE = args.get('artifact') ?? DEFINICION.artifact.artifactCode;
// La firma de esta versión: si un borrador ya trae este nodo, YA es el grafo de ESTA definición.
// Es el nodo que la 2.1.0 añade (el límite por banda) y no `SC_PD_BAND`, que ya traía la 2.0.0:
// con la firma vieja, publicar la 2.1 sobre un entorno con un borrador de la 2.0 lo habría dado
// por bueno y se habría enviado a revisión una versión sin límite.
const SIGNATURE_NODE_KEY = 'SC_LIMITE';
// El compromiso de frescura de lo que Core lee en vivo al decidir. Lo que NO es en vivo —identidad
// verificada una vez, expediente económico declarado en el alta— declara el suyo en la definición.
const FRESHNESS_EN_VIVO_S = 60;

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
/* Variables: 32 de las 33 entradas/salidas YA existen en el catálogo; se reutilizan por código. */
/* product_base_annual_rate es la ÚNICA que este guion crea.                                    */
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
      nullable: definicion.nullable ?? false,
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
          freshnessSlaSeconds: definicion.freshnessSlaSeconds ?? FRESHNESS_EN_VIVO_S,
          precedence: 1,
          isAuthoritative: true,
        },
      ],
      validationRules: [],
    },
  };
}

/**
 * Lo que esta definición EXIGE del contrato de una variable que ya existe, y la versión vigente no
 * cumple. Sólo mira lo que la definición declara de forma explícita (`freshnessSlaSeconds`,
 * `nullable`): una variable sin nada declarado se reutiliza tal cual, como hasta ahora.
 */
function contratoPendiente(definicion, version) {
  const cambios = [];
  const slas = (version.sources ?? []).map((source) => Number(source.freshnessSlaSeconds));
  if (
    definicion.freshnessSlaSeconds !== undefined &&
    (slas.length === 0 || slas.some((sla) => sla !== definicion.freshnessSlaSeconds))
  ) {
    cambios.push(`frescura ${slas.join('/') || '—'} s → ${definicion.freshnessSlaSeconds} s`);
  }
  if (definicion.nullable === true && version.nullable !== true) cambios.push('admite ausencia');
  return cambios;
}

/**
 * La versión vigente, vuelta a escribir como cuerpo de una versión NUEVA con el contrato corregido.
 *
 * Una versión de variable es inmutable y otros artefactos (identidad, riesgo, KYB) están atados a
 * la SUYA por id: crear una nueva no les cambia nada. Se copia TODO lo que la vigente declaraba y
 * sólo se toca lo que la definición pide, para no perder restricciones ni reglas por el camino.
 */
function cuerpoDeNuevaVersion(definicion, version) {
  const opcional = (clave, valor) =>
    valor === null || valor === undefined ? {} : { [clave]: valor };
  return {
    dataType: version.dataType,
    nullable: definicion.nullable === true ? true : Boolean(version.nullable),
    ...opcional('unitCode', version.unitCode),
    ...opcional('defaultValue', version.defaultValueJson),
    ...opcional('validationSchema', version.validationSchemaJson),
    ...opcional('derivationExpression', version.derivationExpressionJson),
    ...opcional('displayName', version.displayName),
    ...opcional('description', version.description),
    ...opcional('constraints', version.constraintsJson),
    ...opcional('validationMessage', version.validationMessage),
    ...opcional('exampleValid', version.exampleValidJson),
    ...opcional('exampleInvalid', version.exampleInvalidJson),
    expectedOrigin: version.expectedOrigin ?? 'REQUEST',
    contractVersion: version.contractVersion ?? '1',
    sources: (version.sources ?? []).map((source) => ({
      sourceSystemCode: source.sourceSystemCode,
      sourcePath: source.sourcePath,
      sourceField: source.sourceField,
      freshnessSlaSeconds: definicion.freshnessSlaSeconds ?? Number(source.freshnessSlaSeconds),
      precedence: Number(source.precedence),
      isAuthoritative: Boolean(source.isAuthoritative),
    })),
    validationRules: (version.validationRules ?? []).map((rule) => ({
      ruleType: rule.ruleType,
      config: rule.ruleConfigJson ?? rule.config ?? {},
      severity: rule.severity,
      errorCode: rule.errorCode,
    })),
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
      const cambios = contratoPendiente(variable, ultima);
      if (!cambios.length) {
        versiones.set(variable.code, String(ultima.id));
        continue;
      }
      if (DRY_RUN) {
        console.log(
          `[dry-run] crearía una versión nueva de ${variable.code} (${cambios.join('; ')}).`,
        );
        versiones.set(variable.code, 'dry-run');
        continue;
      }
      const nueva = await api(`/v1/variables/${existente.id}/versions`, {
        method: 'POST',
        body: JSON.stringify(cuerpoDeNuevaVersion(variable, ultima)),
      });
      versiones.set(variable.code, String(nueva.id));
      console.log(
        `Variable ${variable.code}: versión ${nueva.versionNumber ?? '?'} (id ${nueva.id}) — ${cambios.join('; ')}.`,
      );
      continue;
    }
    // Lo que el catálogo de este entorno todavía no tiene (en TEST, al publicar la 2.1.0:
    // `capacity_recommended_limit` y `approved_credit_limit`).
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
        // Opcionales: `fraud_signal` (Core sólo la manda con un caso abierto) y
        // `capacity_recommended_limit` (sólo la manda el recálculo de la línea, no una compra).
        isRequired: v.required ?? true,
        // `DEGRADE` en lo que Core no puede fechar; ver `authoringNotes` (4) de la definición.
        fallbackPolicy: v.fallbackPolicy ?? 'FAIL_CLOSED',
      })),
      ...DEFINICION.outputs.map((v) => ({
        variableVersionId: versiones.get(v.code),
        usageType: v.usageType,
        dependencyPath: `output.${v.code}`,
        // Sólo probability_of_default y risk_band se producen en TODOS los caminos RESULT
        // (RECHAZAR y APROBAR); pricing_tier/annual_percentage_rate no salen de RECHAZAR, y
        // el validador del contrato de salida exige que eso se declare aquí (isRequired=false)
        // y no sólo en el contrato (absenceReasons), o rechaza la versión al compilar.
        isRequired: v.required,
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
      x: (index % 5) * 220,
      y: Math.floor(index / 5) * 150,
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
      sourceRef: 'APROBAR',
      absenceReasons: output.absenceReasons,
      reasonCodes: [],
      contractVersion: '1',
      semanticRole: output.semanticRole,
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
    `  3. Y entonces, con la credencial del RELEASE_MANAGER (M-2 del plan): ` +
      `node scripts/atlas-underwriting-v2.mjs --deploy ${versionId} --environments ${ENVIRONMENTS.join(',')}`,
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
  /*
   * `--crear`: un entorno que arranca sin crédito (TEST el 2026-09-29) no tiene una v1 de la que
   * clonar. Con la bandera se crea el artefacto y ESTA definición es su primera versión; pasa por
   * la misma suite bloqueante y las mismas dos firmas. Sin la bandera se sigue negando, para no
   * crear un artefacto de crédito por error apuntando al Motor equivocado.
   */
  let recienCreada = null;
  if (!artefacto) {
    if (!CREAR) {
      throw new Error(
        `${ARTIFACT_CODE} no existe en ${BASE}. Este guion publica una VERSIÓN NUEVA de un ` +
          'artefacto existente; para crearlo desde cero en un entorno vacío, repite con --crear.',
      );
    }
    if (DRY_RUN) {
      console.log(
        `[dry-run] crearía ${ARTIFACT_CODE} con esta definición como v1 (${DEFINICION.nodes.length} ` +
          `nodos, ${DEFINICION.edges.length} aristas, ${DEFINICION.cases.length} casos).`,
      );
      return;
    }
    const { authoringNotes, ...alta } = DEFINICION.artifact;
    artefacto = await api('/v1/artifacts', { method: 'POST', body: JSON.stringify(alta) });
    console.log(`Artefacto ${ARTIFACT_CODE} creado (id ${artefacto.id}).`);
    recienCreada = (artefacto.versions ?? [])[0] ?? null;
    if (recienCreada && authoringNotes) {
      await api(`/v1/artifact-versions/${recienCreada.id}/notes`, {
        method: 'PATCH',
        body: JSON.stringify({ notes: authoringNotes }),
      }).catch((error) => console.log(`(notas de autoría no escritas: ${error.message})`));
    }
  }

  const detalle = await api(`/v1/artifacts/${artefacto.id}`);
  const versionesArtefacto = detalle.versions ?? [];
  if (!versionesArtefacto.length) throw new Error(`${ARTIFACT_CODE} no tiene versiones.`);

  // El borrador (o la versión YA enviada a revisión) de un intento anterior de ESTA v2 se
  // reutiliza (idempotencia): sin esto, cada corrida fallida deja un DRAFT huérfano y la
  // siguiente clona ESE, encadenando basura, igual que documenta `kyb-revision-manual.mjs`. Se
  // distingue de un borrador AJENO (de otra sesión, otra versión en curso) mirando si su grafo
  // ya trae la firma de v2, no sólo el estado. Incluir IN_REVIEW es lo que evita clonar DE NUEVO
  // sobre una v2 que una corrida anterior ya envió a revisión: sin esto, cada corrida repetida
  // encadenaba una v2 nueva encima de la que ya esperaba las dos firmas.
  const borradores = versionesArtefacto.filter(
    (version) => version.status === 'DRAFT' || version.status === 'IN_REVIEW',
  );
  let borradorPropio = null;
  for (const borrador of recienCreada ? [] : borradores) {
    const grafo = await api(`/v1/artifact-versions/${borrador.id}/graph`).catch(() => null);
    if ((grafo?.nodes ?? []).some((node) => node.key === SIGNATURE_NODE_KEY)) {
      borradorPropio = borrador;
      break;
    }
  }
  if (!recienCreada && !borradorPropio && borradores.length) {
    throw new Error(
      `${ARTIFACT_CODE} ya tiene ${borradores.length} borrador(es) que NO son de esta v2 (¿otra ` +
        'sesión con un cambio en curso?). No se clona encima: revísalo en el portal primero.',
    );
  }

  let versionId;
  if (recienCreada) {
    versionId = recienCreada.id;
    const escrito = await api(`/v1/artifact-versions/${versionId}/graph`, {
      method: 'PUT',
      headers: { 'if-match': String(recienCreada.lockVersion ?? 1) },
      body: JSON.stringify(cuerpoDelGrafo(versiones, reasonIds)),
    });
    console.log(
      `Grafo escrito en la v1 recién creada (lockVersion ${escrito.lockVersion ?? '?'}).`,
    );
    const compilado = await api(`/v1/artifact-versions/${versionId}/validate-and-compile`, {
      method: 'POST',
      body: '{}',
    });
    console.log(
      `Compilada: ${compilado.canonicalChecksum ?? compilado.checksum ?? 'sin checksum en la respuesta'}.`,
    );
  } else if (borradorPropio) {
    versionId = borradorPropio.id;
    console.log(`Reutilizando el borrador de v2 ya escrito (id ${versionId}).`);
  } else {
    // La vigente para clonar es la última NO-borrador (normalmente la v1 desplegada).
    const vigente = versionesArtefacto
      .filter((version) => version.status !== 'DRAFT')
      .reduce(
        (mejor, version) =>
          !mejor || Number(version.versionNumber) > Number(mejor.versionNumber) ? version : mejor,
        null,
      );
    if (!vigente)
      throw new Error(`${ARTIFACT_CODE} no tiene una versión publicada de la que partir.`);
    console.log(
      `Clonando la versión vigente ${vigente.versionNumber} (id ${vigente.id}, ${vigente.status}).`,
    );

    if (DRY_RUN) {
      console.log(
        `[dry-run] clonaría ${vigente.id} y escribiría el grafo de v2 (${DEFINICION.nodes.length} ` +
          `nodos, ${DEFINICION.edges.length} aristas, ${DEFINICION.cases.length} casos).`,
      );
      return;
    }

    const clon = await api(`/v1/artifact-versions/${vigente.id}/clone`, {
      method: 'POST',
      body: JSON.stringify({
        changeSummary:
          `v${DEFINICION.artifact.semanticVersion}: VETOS antes del puntaje (mora vigente, crédito ` +
          'castigado, cuota por encima del 40 % del ingreso: rechazan con límite 0); la banda D deja ' +
          'de financiarse; la tasa se recorta al tope de usura; la situación laboral no declarada suma ' +
          '15 y no 60; consultas = solicitudes rechazadas en 6 meses; la velocidad sólo suma por encima ' +
          'de 3 solicitudes en 24 h; y la conducta del extracto verificado (fondos insuficientes, meses ' +
          'en negativo, cobranza, gasto de alto riesgo) entra al puntaje. Revisión financiera 2026-10-06.',
      }),
    });
    versionId = clon.id ?? clon.versionId;
    const lockVersion = clon.lockVersion ?? 1;
    console.log(`Clonada como versión id ${versionId}.`);

    const escrito = await api(`/v1/artifact-versions/${versionId}/graph`, {
      method: 'PUT',
      headers: { 'if-match': String(lockVersion) },
      body: JSON.stringify(cuerpoDelGrafo(versiones, reasonIds)),
    });
    console.log(`Grafo de v2 escrito (lockVersion ${escrito.lockVersion ?? '?'}).`);

    const compilado = await api(`/v1/artifact-versions/${versionId}/validate-and-compile`, {
      method: 'POST',
      body: '{}',
    });
    console.log(
      `Compilada: ${compilado.canonicalChecksum ?? compilado.checksum ?? 'sin checksum en la respuesta'}.`,
    );
  }

  const versionActual = await api(`/v1/artifact-versions/${versionId}`).catch(() => null);
  if (versionActual && String(versionActual.status).startsWith('DEPLOYED')) {
    console.log('Ya está desplegada: nada que hacer.');
    return;
  }

  const solicitudes = items(await api('/v1/approval-requests'));
  const suya = solicitudes.find(
    (peticion) => String(peticion.artifactVersionId) === String(versionId),
  );
  if (suya) {
    console.log(`Ya está en revisión (solicitud ${suya.id}, ${suya.status}).`);
  } else {
    const verde = await asegurarSuiteBloqueante(versionId);
    if (!verde) {
      console.error(
        'La suite bloqueante NO está en verde: el Motor no admitirá la versión a revisión, y hace bien.',
      );
      exit(1);
    }
    const creada = await enviarARevision(versionId);
    console.log(`Enviada a revisión (solicitud ${creada.id ?? '?'}).`);
  }
  instruccionesDeAprobacion(versionId);
}

/** Despliega una versión YA aprobada. Se separa porque el permiso para hacerlo es de otra persona (M-2). */
async function desplegar(versionId) {
  for (const environmentCode of ENVIRONMENTS) {
    const despliegue = await api(`/v1/artifact-versions/${versionId}/deployments`, {
      method: 'POST',
      body: JSON.stringify({ environmentCode, deploymentMode: 'DIRECT', traffic: [] }),
    });
    console.log(
      `Desplegada en ${environmentCode} (deployment ${despliegue.id ?? despliegue.deploymentId ?? '?'}).`,
    );
  }
  console.log(
    'Listo. Falta que AtlasBackend empiece a mandar `product_base_annual_rate` y a leer las ' +
      'cuatro salidas nuevas (Frente 3A, punto 4 del plan).',
  );
}

const DEPLOY = args.get('deploy');

(DEPLOY && DEPLOY !== 'true' ? desplegar(DEPLOY) : main()).catch((error) => {
  console.error(error.message);
  exit(1);
});
