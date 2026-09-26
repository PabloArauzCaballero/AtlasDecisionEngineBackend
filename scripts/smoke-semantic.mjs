#!/usr/bin/env node
/**
 * Smoke del worker semántico, de extremo a extremo y por HTTP.
 *
 * Hermano de `smoke-workers.mjs`, que cubre el de extractos. Recorre lo que
 * ninguna otra prueba recorre entero:
 *
 *   API acepta → fila encolada → pg_notify → worker reclama → recupera
 *   categorías → clasifica → resultado persistido → resultado consultable
 *
 * Exige que el worker esté ENCENDIDO en el motor al que apunta:
 *
 *   SEMANTIC_ANALYSIS_WORKER_ENABLED=true
 *   SEMANTIC_ANALYSIS_PROVIDER=openai|transformer   (y su configuración)
 *
 * Sin proveedor de modelo el catálogo declara el worker no disponible y este
 * smoke lo dice en vez de fallar: apagado es una configuración legítima. Para
 * ejercitarlo en un puesto de trabajo sin cuenta de OpenAI ni servidor de
 * inferencia, `scripts/semantic-local-provider.mjs` levanta un proveedor
 * determinista que habla el dialecto del adaptador de OpenAI.
 *
 * Uso: node scripts/smoke-semantic.mjs
 * Toma BASE_URL de SEMANTIC_BASE_URL o SMOKE_BASE_URL, y la credencial de .env.
 */
import { readFileSync } from 'node:fs';

function loadEnv() {
  try {
    for (const line of readFileSync('.env', 'utf8').split('\n')) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
    }
  } catch {
    // Sin .env se depende de las variables ya exportadas: es el caso de CI.
  }
}
loadEnv();

const BASE_URL =
  process.env.SEMANTIC_BASE_URL ?? process.env.SMOKE_BASE_URL ?? 'http://localhost:3000';
const API_KEY = process.env.MANAGEMENT_API_KEY;
const TENANT_ID = process.env.BOOTSTRAP_TENANT_ID ?? '1';
/**
 * Cuánto esperar a que un análisis termine.
 *
 * 90 s sirven de sobra contra el clasificador de transformers, que resuelve un
 * lote en cientos de milisegundos. Contra un modelo generativo grande, o contra
 * un codificador sobre CPU cargada, un smoke que se rinde antes que el motor no
 * informa de un fallo: informa de su propio reloj. Súbelo entonces:
 *
 *   SEMANTIC_SMOKE_TIMEOUT_SECONDS=420 node scripts/smoke-semantic.mjs
 */
const MAX_ESPERA = Number(process.env.SEMANTIC_SMOKE_TIMEOUT_SECONDS ?? 90);

if (!API_KEY) {
  console.error('Falta MANAGEMENT_API_KEY. Sin credencial no hay smoke que valga.');
  process.exit(2);
}

const headers = { 'x-api-key': API_KEY, 'x-tenant-id': TENANT_ID };
const TERMINALES = ['SUCCEEDED', 'SUCCEEDED_WITH_WARNINGS', 'FAILED', 'CANCELLED'];

let fallos = 0;
function check(ok, titulo, detalle = '') {
  console.log(`${ok ? '  OK  ' : ' FALLO'} ${titulo}${detalle ? ` — ${detalle}` : ''}`);
  if (!ok) fallos += 1;
  return ok;
}

/** El motor devuelve un array desnudo en las colecciones no paginadas. */
function items(payload) {
  if (Array.isArray(payload)) return payload;
  return Array.isArray(payload?.items) ? payload.items : [];
}

async function api(path, init = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { ...headers, ...(init.headers ?? {}) },
  });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

/**
 * Espera a un estado terminal, con tope.
 *
 * Un RUNNING perpetuo es exactamente el síntoma del bloqueo que tuvo parado a
 * este worker: el procesador se saltaba su propia fila creyéndola ajena. Por eso
 * el tope, y por eso el mensaje dice dónde mirar.
 */
async function esperarTerminal(requestId, maxSegundos = MAX_ESPERA) {
  const vistos = [];
  for (let i = 0; i < maxSegundos; i += 1) {
    const { status, body } = await api(`/v1/workers/semantic-analysis/runs/${requestId}`);
    if (status >= 500) {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      continue;
    }
    if (status !== 200) return { error: `consulta devolvió ${status}` };
    if (vistos.at(-1) !== body.status) vistos.push(body.status);
    if (TERMINALES.includes(body.status)) return { run: body, vistos };
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  return { error: 'la ejecución no alcanzó un estado terminal', vistos };
}

/**
 * Todo el recorrido dentro de una función para poder salir con `return`.
 *
 * `process.exit()` en medio de una petición deja handles a medio cerrar y Node
 * en Windows lo remata con un `Assertion failed` de libuv: un smoke en verde que
 * termina con un aborto rojo se lee como un fallo que no es.
 */
async function main() {
  console.log(`\nSmoke del worker semántico contra ${BASE_URL}\n`);

  // 1. El catálogo lo declara disponible. Si no, no hay nada más que probar.
  const catalogo = await api('/v1/workers');
  check(catalogo.status === 200, 'GET /v1/workers responde 200', `status=${catalogo.status}`);
  const descriptor = items(catalogo.body).find((worker) => worker.code === 'semantic-analysis');
  check(Boolean(descriptor), 'el catálogo declara el worker semántico');

  if (descriptor?.available !== true) {
    console.log(
      '\n  INFO  el worker semántico está apagado en este motor.' +
        '\n        Enciéndelo con SEMANTIC_ANALYSIS_WORKER_ENABLED=true y un' +
        '\n        SEMANTIC_ANALYSIS_PROVIDER configurado. Nada que probar aquí.\n',
    );
    return fallos === 0 ? 0 : 1;
  }

  check(
    typeof descriptor.limits?.maxTextLength === 'number',
    'publica su límite de texto',
    String(descriptor.limits?.maxTextLength),
  );

  // 2. Los escenarios se sirven.
  const fixtures = await api('/v1/workers/semantic-analysis/fixtures');
  const codigos = items(fixtures.body).map((fixture) => fixture.code);
  check(fixtures.status === 200, 'GET fixtures responde 200', `status=${fixtures.status}`);
  check(codigos.includes('gasto-claro'), 'existe el escenario gasto-claro', codigos.join(', '));

  // 3. Camino feliz. La clave de idempotencia es única para poder observar el
  //    ciclo de vida: reutilizarla devolvería la ejecución anterior ya terminada.
  const marca = `smoke-${Date.now()}`;
  const creada = await api('/v1/workers/semantic-analysis/runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fixtureCode: 'gasto-claro', idempotencyKey: marca }),
  });
  check(creada.status === 202, 'POST runs responde 202 Accepted', `status=${creada.status}`);
  const requestId = creada.body?.requestId;
  if (!requestId) {
    console.error('\nSin identificador no se puede seguir.\n');
    return 1;
  }

  console.log('\n  … esperando al worker\n');
  const resultado = await esperarTerminal(requestId);
  if (resultado.error) {
    check(false, 'la ejecución alcanza un estado terminal', resultado.error);
    console.error(`\n  estados vistos: ${(resultado.vistos ?? []).join(' → ') || 'ninguno'}`);
    console.error('  Un RUNNING perpetuo significa que el procesador se saltó su propia');
    console.error('  fila: revisa PrismaSemanticAuditRepository.claim.\n');
    return 1;
  }

  const run = resultado.run;
  check(
    run.status === 'SUCCEEDED' || run.status === 'SUCCEEDED_WITH_WARNINGS',
    'la ejecución termina con éxito',
    `${run.status}${run.errorMessage ? ` (${run.errorMessage})` : ''}`,
  );
  check(run.progress === 100, 'el progreso llega a 100', String(run.progress));

  // 4. El resultado dice algo, y lo dice con su respaldo.
  const clasificacion = run.result;
  check(Boolean(clasificacion), 'la ejecución trae resultado');
  check(
    typeof clasificacion?.status === 'string',
    'el resultado declara su estado de clasificación',
    String(clasificacion?.status),
  );
  /*
   * Quién decidió cambia QUÉ se puede exigir del resultado, y esto llevaba en rojo desde que
   * existe el atajo por reglas.
   *
   * Cuando una regla determinista lee la glosa —`rule-fast-path`— el motor resuelve ANTES de
   * recuperar candidatas: no le pregunta al modelo, así que `evaluatedCategoryCodes` viene vacío
   * con toda la razón. Exigirle candidatas a un camino que existe precisamente para no pedirlas
   * convertía en fallo el comportamiento que más ahorra, y la comprobación de «no se inventó la
   * categoría» se caía detrás por el mismo motivo.
   *
   * La garantía de que la regla no inventa nada existe, pero es otra y vive en otro sitio:
   * `semantic-cobertura-categorias.spec.ts` comprueba que todo código que una regla puede proponer
   * está sembrado como hoja del catálogo.
   */
  const decidioElModelo = clasificacion?.decidedBy === 'MODEL';
  check(
    Array.isArray(clasificacion?.evaluatedCategoryCodes) &&
      (decidioElModelo ? clasificacion.evaluatedCategoryCodes.length > 0 : true),
    decidioElModelo
      ? 'evaluó el catálogo de categorías del tenant'
      : `resolvió sin preguntar al modelo (decidedBy=${String(clasificacion?.decidedBy)})`,
    String(clasificacion?.evaluatedCategoryCodes?.length),
  );
  check(
    typeof clasificacion?.model === 'string' && clasificacion.model.length > 0,
    'el resultado dice qué modelo decidió',
    String(clasificacion?.model),
  );
  check(
    typeof clasificacion?.decidedBy === 'string' &&
      ['MODEL', 'RULE', 'BIN'].includes(clasificacion.decidedBy),
    'el resultado declara QUIÉN decidió',
    String(clasificacion?.decidedBy),
  );

  const primera = clasificacion?.matches?.[0];
  if (primera) {
    check(
      typeof primera.confidence === 'number' && primera.confidence >= 0 && primera.confidence <= 1,
      'la categoría trae una confianza acotada',
      String(primera.confidence),
    );
    if (decidioElModelo) {
      check(
        clasificacion.evaluatedCategoryCodes.includes(primera.categoryCode),
        'la decisión del modelo recae sobre una candidata, no sobre una inventada',
        String(primera.categoryCode),
      );
    }
  }

  // 5. Texto propio.
  const propio = await api('/v1/workers/semantic-analysis/runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      text: 'PAGO PLAN DE INTERNET FIBRA OPTICA MES DE JUNIO BS 320,00',
      idempotencyKey: `${marca}-propio`,
    }),
  });
  check(
    propio.status === 202,
    'POST runs con texto propio responde 202',
    `status=${propio.status}`,
  );
  const segundo = await esperarTerminal(propio.body?.requestId);
  check(
    !segundo.error,
    'el texto propio también termina',
    segundo.error ?? segundo.vistos.join(' → '),
  );

  // 6. Entrada inválida: se rechaza antes de encolar, sin gastar una llamada al
  //    proveedor.
  const vacio = await api('/v1/workers/semantic-analysis/runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fixtureCode: 'invalid-example' }),
  });
  check(
    vacio.status >= 400 && vacio.status < 500,
    'el escenario inválido se rechaza antes de encolar',
    `status=${vacio.status}`,
  );

  // 7. Texto y escenario a la vez: se rechaza en vez de elegir en silencio.
  const ambigua = await api('/v1/workers/semantic-analysis/runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'hola', fixtureCode: 'gasto-claro' }),
  });
  check(
    ambigua.status === 400,
    'texto y escenario a la vez se rechaza',
    `status=${ambigua.status}`,
  );

  // 8. Aislamiento por tenant.
  const ajena = await fetch(`${BASE_URL}/v1/workers/semantic-analysis/runs/${requestId}`, {
    headers: { 'x-api-key': API_KEY, 'x-tenant-id': '999' },
  });
  check(
    ajena.status === 404 || ajena.status === 403,
    'una ejecución de otro tenant no es accesible',
    `status=${ajena.status}`,
  );

  console.log(`\n${fallos === 0 ? 'SMOKE EN VERDE' : `SMOKE EN ROJO — ${fallos} fallo(s)`}\n`);
  return fallos === 0 ? 0 : 1;
}

process.exitCode = await main();
