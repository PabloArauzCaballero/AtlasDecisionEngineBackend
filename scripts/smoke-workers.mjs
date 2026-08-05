#!/usr/bin/env node
/**
 * Smoke de los workers adicionales, de extremo a extremo y por HTTP.
 *
 * Es lo que ninguna otra prueba cubre. Las unitarias comprueban el motor de
 * extractos, la de integración comprueba las garantías de la cola contra
 * Postgres, y el E2E comprueba el portal contra un motor simulado. Ninguna
 * recorre el camino completo:
 *
 *   API acepta → fila encolada → pg_notify → worker reclama → procesa →
 *   resultado persistido → resultado consultable por HTTP → descarga
 *
 * Si algo de ese recorrido está mal cableado —el trabajo sin registrar, el
 * aviso sin emitir, el módulo sin cargar— ninguna de las otras lo nota y esta
 * falla en la primera vuelta.
 *
 * Uso: node scripts/smoke-workers.mjs
 * Requiere BASE_URL, MANAGEMENT_API_KEY y TENANT_ID (los toma de .env).
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

const BASE_URL = process.env.SMOKE_BASE_URL ?? 'http://localhost:3000';
const API_KEY = process.env.MANAGEMENT_API_KEY;
const TENANT_ID = process.env.BOOTSTRAP_TENANT_ID ?? '1';

if (!API_KEY) {
  console.error('Falta MANAGEMENT_API_KEY. Sin credencial no hay smoke que valga.');
  process.exit(2);
}

const headers = { 'x-api-key': API_KEY, 'x-tenant-id': TENANT_ID };

let fallos = 0;
function check(ok, titulo, detalle = '') {
  console.log(`${ok ? '  OK  ' : ' FALLO'} ${titulo}${detalle ? ` — ${detalle}` : ''}`);
  if (!ok) fallos += 1;
  return ok;
}

/**
 * El motor devuelve un ARRAY DESNUDO en las colecciones no paginadas, no un
 * sobre `{ items }`. Esta prueba lo asumía mal —igual que lo asumía el cliente
 * del portal— y por eso el catálogo salía vacío contra una API que respondía
 * 200. Se normaliza en un sitio.
 */
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
  return { status: response.status, body, text };
}

/**
 * Espera a que la ejecución alcance un estado terminal.
 *
 * Con tope: si el worker no está registrado la ejecución se queda en QUEUED para
 * siempre, y un smoke que esperase indefinidamente parecería colgado en vez de
 * señalar el defecto.
 */
async function esperarTerminal(requestId, maxSegundos = 90) {
  const terminales = ['SUCCEEDED', 'SUCCEEDED_WITH_WARNINGS', 'FAILED', 'CANCELLED'];
  const vistos = new Set();
  for (let i = 0; i < maxSegundos; i += 1) {
    const { status, body } = await api(`/v1/workers/bank-statement/runs/${requestId}`);
    if (status >= 500) {
      // Un 5xx aislado tras recrear contenedores es el pool reconectando, no un
      // defecto. Se reintenta; si persiste, se agota el tope y se informa.
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      continue;
    }
    if (status !== 200) return { error: `consulta devolvió ${status}` };
    vistos.add(body.status);
    if (terminales.includes(body.status)) return { run: body, vistos: [...vistos] };
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  return { error: 'la ejecución no alcanzó un estado terminal', vistos: [...vistos] };
}

console.log(`\nSmoke de workers adicionales contra ${BASE_URL}\n`);

// 1. El catálogo responde y declara los dos workers.
const catalogo = await api('/v1/workers');
check(catalogo.status === 200, 'GET /v1/workers responde 200', `status=${catalogo.status}`);
const codigos = items(catalogo.body).map((w) => w.code);
check(
  codigos.includes('bank-statement') && codigos.includes('semantic-analysis'),
  'el catálogo declara los dos workers',
  codigos.join(', '),
);
const extractos = items(catalogo.body).find((w) => w.code === 'bank-statement');
check(extractos?.available === true, 'el worker de extractos se declara disponible');

// 2. Los escenarios de prueba se sirven.
const fixtures = await api('/v1/workers/bank-statement/fixtures');
check(fixtures.status === 200, 'GET fixtures responde 200', `status=${fixtures.status}`);
const codigosFixture = items(fixtures.body).map((f) => f.code);
check(codigosFixture.includes('valid-basic'), 'existe el escenario valid-basic');

// 3. Se encola una conversión con un escenario.
const creada = await api('/v1/workers/bank-statement/runs', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ fixtureCode: 'valid-basic' }),
});
check(creada.status === 202, 'POST runs responde 202 Accepted', `status=${creada.status}`);
const requestId = creada.body?.requestId;
check(Boolean(requestId), 'la respuesta trae un identificador de ejecución', requestId ?? '—');

if (!requestId) {
  console.error('\nSin identificador no se puede seguir.\n');
  process.exit(1);
}

// 4. El worker la toma y la termina. Aquí es donde se comprueba que el trabajo
//    está registrado y que el aviso llega: si no, se queda en QUEUED.
console.log('\n  … esperando al worker\n');
const resultado = await esperarTerminal(requestId);
if (resultado.error) {
  check(false, 'la ejecución alcanza un estado terminal', resultado.error);
  console.error(`\n  estados vistos: ${(resultado.vistos ?? []).join(' → ') || 'ninguno'}`);
  console.error('  Un QUEUED perpetuo significa que el worker no reclamó: revisa');
  console.error('  BANK_STATEMENT_WORKER_ENABLED y WORKER_ROLE en el proceso worker.\n');
  process.exit(1);
}

const run = resultado.run;
check(
  run.status === 'SUCCEEDED' || run.status === 'SUCCEEDED_WITH_WARNINGS',
  'la ejecución termina con éxito',
  run.status,
);
// El ciclo de vida sólo se puede observar en la PRIMERA corrida: a partir de la
// segunda, la idempotencia devuelve la ejecución ya terminada y no hay nada
// intermedio que ver. Exigirlo siempre convertiría el acierto —deduplicar— en un
// fallo, que es justo lo contrario de lo que debe reportar un smoke.
const deduplicada = resultado.vistos.length === 1 && terminalDesdeElPrincipio(resultado.vistos);
if (deduplicada) {
  console.log(
    '  INFO  ciclo de vida no observable: la ejecución ya existía (idempotencia).' +
      ' Borra la fila o cambia el escenario para verlo.',
  );
} else {
  check(resultado.vistos.length > 1, 'se observó el ciclo de vida', resultado.vistos.join(' → '));
}
check(run.progress === 100, 'el progreso llega a 100', String(run.progress));

// 5. El resultado es el que debe ser, y viene enmascarado.
const cuenta = run.result?.account?.accountNumberMasked;
check(Boolean(run.result), 'la ejecución trae resultado');
check(
  run.result?.institution?.id === 'BGA',
  'reconoce la institución del escenario',
  String(run.result?.institution?.id),
);
check(
  (run.result?.transactions ?? []).length === 2,
  'lee los dos movimientos',
  String((run.result?.transactions ?? []).length),
);
check(
  typeof cuenta === 'string' && /^\*+\d{4}$/.test(cuenta),
  'el número de cuenta viaja enmascarado',
  String(cuenta),
);
check(
  !JSON.stringify(run.result).includes('1234567890'),
  'el número completo no aparece en ninguna parte del resultado',
);

// 6. La descarga funciona y sale como archivo.
const descarga = await fetch(
  `${BASE_URL}/v1/workers/bank-statement/runs/${requestId}/download?format=csv`,
  { headers },
);
const csv = await descarga.text();
check(descarga.status === 200, 'la descarga en CSV responde 200', `status=${descarga.status}`);
check(
  (descarga.headers.get('content-disposition') ?? '').includes('attachment'),
  'se sirve como adjunto y no en línea',
);
check(csv.includes('PAGO SERVICIOS'), 'el CSV contiene los movimientos');
check(!csv.includes('1234567890'), 'el CSV tampoco filtra el número de cuenta');

// 7. Idempotencia: el mismo escenario no crea una segunda ejecución.
const repetida = await api('/v1/workers/bank-statement/runs', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ fixtureCode: 'valid-basic' }),
});
check(
  repetida.body?.requestId === requestId,
  'reenviar el mismo documento devuelve la ejecución existente',
  `${repetida.body?.requestId} vs ${requestId}`,
);

// 8. Aislamiento: la ejecución de otro tenant no se ve.
const ajena = await fetch(`${BASE_URL}/v1/workers/bank-statement/runs/${requestId}`, {
  headers: { 'x-api-key': API_KEY, 'x-tenant-id': '999' },
});
check(
  ajena.status === 404 || ajena.status === 403,
  'una ejecución de otro tenant no es accesible',
  `status=${ajena.status}`,
);

console.log(`\n${fallos === 0 ? 'SMOKE EN VERDE' : `SMOKE EN ROJO — ${fallos} fallo(s)`}\n`);
process.exit(fallos === 0 ? 0 : 1);
