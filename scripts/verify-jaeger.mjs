#!/usr/bin/env node
/**
 * Verificación de extremo a extremo de la trazabilidad.
 *
 * Recorre el camino completo que recorrería un operador: comprueba que Jaeger responde, hace
 * una petición real al backend, lee el `x-trace-id` de la respuesta y busca ESA traza en
 * Jaeger. Es la única prueba que demuestra que la cadena entera —instrumentación, exportador,
 * red, colector, almacenamiento— funciona; todo lo demás verifica un tramo.
 *
 * Va en Node y no en bash porque el repositorio se desarrolla también en Windows y `fetch` y
 * Node ya son requisitos. `scripts/verify-jaeger.sh` es un envoltorio para quien espere el
 * script POSIX.
 *
 * Uso:
 *   yarn jaeger:verify
 *   BASE_URL=http://localhost:3000 JAEGER_URL=http://localhost:16686 yarn jaeger:verify
 *
 * Salida: 0 si la traza aparece en Jaeger, 1 con un diagnóstico concreto en cualquier otro caso.
 */
const BASE_URL = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const JAEGER_URL = process.env.JAEGER_URL ?? 'http://127.0.0.1:16686';
const SERVICE_NAME = process.env.OTEL_SERVICE_NAME ?? 'atlas-api';
// El exportador agrupa en lotes y Jaeger indexa después: preguntar de inmediato produce un
// falso negativo que parece un fallo de configuración y no lo es.
const LOOKUP_ATTEMPTS = Number(process.env.VERIFY_ATTEMPTS ?? 15);
const LOOKUP_DELAY_MS = Number(process.env.VERIFY_DELAY_MS ?? 2000);

const steps = [];

function record(name, ok, detail) {
  steps.push({ name, ok, detail });
  process.stdout.write(`${ok ? '  OK  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}\n`);
  return ok;
}

function fail(reason, hint) {
  process.stdout.write(`\n✗ ${reason}\n`);
  if (hint) process.stdout.write(`  ${hint}\n`);
  process.exit(1);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getJson(url) {
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function main() {
  process.stdout.write(`Verificando trazabilidad\n  backend: ${BASE_URL}\n  jaeger:  ${JAEGER_URL}\n\n`);

  // 1 — Jaeger disponible.
  try {
    await getJson(`${JAEGER_URL}/api/services`);
    record('Jaeger responde', true, `${JAEGER_URL}/api/services`);
  } catch (error) {
    record('Jaeger responde', false, String(error.message ?? error));
    fail('Jaeger no está disponible.', 'Levántelo con `yarn jaeger:up` y espere a que la UI responda.');
  }

  // 2 — Backend vivo. Se usa /health, que está EXCLUIDO de las trazas a propósito: sólo
  // confirma que el proceso atiende, no genera ruido en el sistema de trazas.
  let health;
  try {
    health = await fetch(`${BASE_URL}/health`);
    record('Backend responde', health.ok, `GET /health → ${health.status}`);
  } catch (error) {
    record('Backend responde', false, String(error.message ?? error));
    fail('El backend no responde.', 'Arránquelo con OTEL_ENABLED=true y el endpoint OTLP apuntando a Jaeger.');
  }

  // 3 — Petición trazada. Cualquier ruta servida por el motor vale; se usa una inexistente a
  // propósito: produce una traza real y un 404 controlado, sin escribir ni una fila.
  const probePath = process.env.VERIFY_PATH ?? '/v1/artifacts/__trace-probe__';
  const response = await fetch(`${BASE_URL}${probePath}`);
  const traceId = response.headers.get('x-trace-id');
  if (!record('La respuesta trae x-trace-id', Boolean(traceId), traceId ?? `GET ${probePath} → ${response.status}`)) {
    fail(
      'La respuesta no incluyó la cabecera x-trace-id.',
      'Causas habituales: OTEL_ENABLED no es true, la ruta está en UNTRACED_HTTP_PATHS, o el muestreo la descartó (OTEL_TRACES_SAMPLER_ARG).',
    );
  }

  // 4 — El servicio aparece en Jaeger. Sin esto, no ha llegado ni un solo lote.
  let services = [];
  for (let attempt = 1; attempt <= LOOKUP_ATTEMPTS; attempt += 1) {
    const body = await getJson(`${JAEGER_URL}/api/services`);
    services = body.data ?? [];
    if (services.includes(SERVICE_NAME)) break;
    await sleep(LOOKUP_DELAY_MS);
  }
  if (!record('El servicio aparece en Jaeger', services.includes(SERVICE_NAME), `esperado ${SERVICE_NAME}; visto: ${services.join(', ') || 'ninguno'}`)) {
    fail(
      `Jaeger no conoce el servicio ${SERVICE_NAME}.`,
      'Compruebe OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: dentro de Docker es http://jaeger:4318/v1/traces, fuera http://localhost:4318/v1/traces.',
    );
  }

  // 5 — La traza CONCRETA está almacenada. Es lo que hace útil el x-trace-id para soporte.
  let trace;
  for (let attempt = 1; attempt <= LOOKUP_ATTEMPTS; attempt += 1) {
    try {
      const body = await getJson(`${JAEGER_URL}/api/traces/${traceId}`);
      if (body.data?.length) {
        trace = body.data[0];
        break;
      }
    } catch {
      // 404 mientras el lote no se ha indexado todavía: se reintenta.
    }
    await sleep(LOOKUP_DELAY_MS);
  }
  if (!record('La traza consultada existe en Jaeger', Boolean(trace), traceId)) {
    fail(
      'El servicio exporta, pero esa traza no aparece.',
      `Suele ser muestreo. Con OTEL_TRACES_SAMPLER_ARG=1.0 debe aparecer siempre. Búsquela a mano: ${JAEGER_URL}/trace/${traceId}`,
    );
  }

  const spans = trace.spans ?? [];
  record('La traza contiene spans', spans.length > 0, `${spans.length} span(s)`);

  // 6 — Ningún atributo prohibido llegó al almacenamiento.
  const FORBIDDEN = ['authorization', 'cookie', 'x-api-key', 'password', 'token', 'secret'];
  const leaked = new Set();
  for (const span of spans) {
    for (const tag of span.tags ?? []) {
      const key = String(tag.key).toLowerCase();
      if (FORBIDDEN.some((needle) => key.includes(needle))) leaked.add(tag.key);
    }
  }
  if (!record('Sin atributos sensibles en la traza', leaked.size === 0, leaked.size ? [...leaked].join(', ') : 'ninguno')) {
    fail('Se encontraron atributos prohibidos en la traza.', 'Revise docs/observability/04-data-privacy-policy.md y la redacción del Collector.');
  }

  process.stdout.write(`\n✓ Trazabilidad verificada de extremo a extremo\n  ${JAEGER_URL}/trace/${traceId}\n`);
}

main().catch((error) => {
  process.stderr.write(`\nError inesperado durante la verificación: ${error?.stack ?? error}\n`);
  process.exit(1);
});
