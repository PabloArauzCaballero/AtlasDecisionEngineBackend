#!/usr/bin/env node
/**
 * Benchmark PROPIO del runtime de decisiones (P-16 · B18).
 *
 * Pega a `POST /v1/decisions/:artifactCode` contra la API COMPILADA (`node dist/main.js`) con
 * concurrencia configurable y separa lo que la documentación anterior mezclaba:
 *
 *   - decisión servida (200, por desenlace: APPROVED / DECLINED / MANUAL_REVIEW …);
 *   - rechazo de NEGOCIO (422: la decisión no se puede tomar con esos datos) — no es indisponibilidad;
 *   - conflicto de idempotencia (409), limitación (429) y otros 4xx;
 *   - error TÉCNICO (5xx o sin respuesta: conexión rechazada, reset, timeout).
 *
 * Cada petición lógica lleva su `idempotencyKey`/`requestId` propios. Con `--retry-seconds > 0` una
 * petición que falla por causa técnica se REINTENTA con la MISMA clave y el MISMO cuerpo hasta que
 * responde o vence el plazo: así se comporta un cliente correcto durante una caída, y es lo que
 * permite comprobar después que un reintento no produce una segunda decisión (todas las respuestas de
 * una misma clave deben traer el mismo `executionId`; la base lo confirma aparte).
 *
 * Mide además, si se le dan los medios:
 *   --pid <pid>              RSS y CPU del proceso de la API (vía `ps`), muestreados cada segundo.
 *   --metrics-token <token>  pool de conexiones de Prisma (`atlas_database_pool_connections`) de /metrics.
 *
 * Uso:
 *   node scripts/perf/decision-load.mjs --concurrency 8 --duration 120 --label sostenida \
 *     --api-key "$RUNTIME_KEY" --pid "$API_PID" --metrics-token "$METRICS_TOKEN" --out result.json
 *
 * Salida: resumen legible por stdout y JSON completo en `--out` (o por stdout con `--json`).
 * No es un SLO: los números valen para la máquina y la configuración en que se midieron.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const key = process.argv[i];
  if (!key.startsWith('--')) continue;
  const next = process.argv[i + 1];
  if (next === undefined || next.startsWith('--')) {
    args.set(key.slice(2), 'true');
  } else {
    args.set(key.slice(2), next);
    i += 1;
  }
}

const opt = (name, fallback) =>
  args.get(name) ?? process.env[`BENCH_${name.toUpperCase().replace(/-/g, '_')}`] ?? fallback;

const BASE_URL = opt('base-url', 'http://127.0.0.1:3000');
const ARTIFACT = opt('artifact', 'BNPL_CREDIT_DECISION');
const API_KEY = opt('api-key', '');
const TENANT = opt('tenant', '1');
const SUBJECT = opt('subject', 'e2e-subject');
const ENVIRONMENT = opt('environment', 'PROD');
const CONCURRENCY = Number(opt('concurrency', '8'));
const DURATION_S = Number(opt('duration', '30'));
const MAX_REQUESTS = Number(opt('requests', '0'));
const WARMUP = Number(opt('warmup', '30'));
const BUSINESS_REJECT_RATIO = Number(opt('business-reject-ratio', '0.05'));
const RETRY_SECONDS = Number(opt('retry-seconds', '0'));
const REQUEST_TIMEOUT_MS = Number(opt('timeout-ms', '10000'));
const LABEL = opt('label', 'sin-etiqueta');
const KEY_PREFIX = opt('key-prefix', `bench-${LABEL}-${Date.now()}`);
const PID = opt('pid', '');
const METRICS_TOKEN = opt('metrics-token', '');
const OUT = opt('out', '');
const JSON_ONLY = opt('json', 'false') === 'true';

if (!API_KEY) {
  console.error('Falta --api-key (credencial de audiencia runtime con el rol de decisión).');
  process.exit(2);
}

/** Solicitante sintético: sin datos personales, variables del artefacto de las e2e. */
function payloadFor(n) {
  const variables = {
    age: 25 + (n % 40),
    kyc_status: n % 11 === 0 ? 'REJECTED' : 'VERIFIED',
    consent_active: true,
    pep_status: n % 17 === 0,
    disposable_income: 3000 + (n % 50) * 20,
    requested_amount: 500 + (n % 30) * 50,
  };
  // Una fracción, determinista por índice, sin una variable obligatoria: el motor debe contestar 422
  // (NO_DECISION), que es un rechazo de negocio y no cuenta como indisponibilidad.
  if (BUSINESS_REJECT_RATIO > 0 && n % Math.round(1 / BUSINESS_REJECT_RATIO) === 1) {
    delete variables.requested_amount;
  }
  const key = `${KEY_PREFIX}-${n}`;
  return {
    requestId: key,
    idempotencyKey: key,
    subjectReference: SUBJECT,
    environmentCode: ENVIRONMENT,
    variables,
  };
}

function classify(status) {
  if (status === 0) return 'technical';
  if (status >= 500) return 'technical';
  if (status === 422) return 'business422';
  if (status === 429) return 'throttled';
  if (status === 409) return 'conflict';
  if (status >= 400) return 'client4xx';
  return 'ok';
}

async function attempt(body) {
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${BASE_URL}/v1/decisions/${ARTIFACT}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': API_KEY,
        'x-tenant-id': TENANT,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
    return {
      ms: performance.now() - started,
      status: response.status,
      executionId: parsed?.executionId ?? null,
      outcome: parsed?.outcome ?? null,
      errorCode: parsed?.error?.code ?? parsed?.code ?? null,
      retryAfterS: Number(response.headers.get('retry-after') ?? 0) || 0,
    };
  } catch (error) {
    return {
      ms: performance.now() - started,
      status: 0,
      executionId: null,
      outcome: null,
      errorCode:
        error?.name === 'AbortError' ? 'CLIENT_TIMEOUT' : (error?.cause?.code ?? 'NETWORK'),
      retryAfterS: 0,
    };
  } finally {
    clearTimeout(timer);
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Number(sorted[index].toFixed(2));
}

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  return {
    n: sorted.length,
    mean: sorted.length ? Number((sum / sorted.length).toFixed(2)) : null,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted.length ? Number(sorted[sorted.length - 1].toFixed(2)) : null,
  };
}

function sampleProcess() {
  if (!PID) return null;
  try {
    const out = execFileSync('ps', ['-o', 'rss=,%cpu=', '-p', PID], { encoding: 'utf8' }).trim();
    const [rss, cpu] = out.split(/\s+/);
    return { rssMb: Number((Number(rss) / 1024).toFixed(1)), cpu: Number(cpu) };
  } catch {
    return null;
  }
}

async function samplePool() {
  if (!METRICS_TOKEN) return null;
  try {
    const response = await fetch(`${BASE_URL}/metrics`, {
      headers: { 'x-metrics-token': METRICS_TOKEN },
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) return null;
    const text = await response.text();
    const pool = {};
    for (const line of text.split('\n')) {
      const match = line.match(/^atlas_database_pool_connections\{([^}]*)\}\s+([0-9.e+-]+)/);
      if (!match) continue;
      const labels = Object.fromEntries(
        [...match[1].matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1], m[2]]),
      );
      pool[`${labels.connection ?? labels.pool ?? 'default'}.${labels.state ?? 'value'}`] = Number(
        match[2],
      );
    }
    return pool;
  } catch {
    return null;
  }
}

async function warmup() {
  for (let i = 0; i < WARMUP; i += 1) {
    const body = payloadFor(i);
    body.requestId = `${KEY_PREFIX}-warmup-${i}`;
    body.idempotencyKey = body.requestId;
    await attempt(body);
  }
}

async function main() {
  await warmup();

  const attempts = []; // { t, ms, status, category }
  const logical = new Map(); // key -> { attempts, executionIds:Set, finalStatus, outcome }
  const timeline = [];
  let issued = 0;
  const startedAt = performance.now();
  const deadline = startedAt + DURATION_S * 1000;
  let stop = false;

  const sampler = setInterval(async () => {
    const t = Number(((performance.now() - startedAt) / 1000).toFixed(1));
    const proc = sampleProcess();
    const pool = await samplePool();
    timeline.push({ t, ...(proc ?? {}), pool });
  }, 1000);

  async function runLogical(n) {
    const body = payloadFor(n);
    const record = { attempts: 0, executionIds: new Set(), finalStatus: null, outcome: null };
    logical.set(body.idempotencyKey, record);
    const retryUntil = performance.now() + RETRY_SECONDS * 1000;
    for (;;) {
      const result = await attempt(body);
      const category = classify(result.status);
      record.attempts += 1;
      attempts.push({
        t: (performance.now() - startedAt) / 1000,
        ms: result.ms,
        status: result.status,
        category,
        errorCode: result.errorCode,
      });
      if (result.executionId) record.executionIds.add(String(result.executionId));
      record.finalStatus = result.status;
      record.outcome = result.outcome;
      // Un cliente correcto reintenta con la MISMA clave lo técnico (5xx, red) y lo limitado (429,
      // respetando Retry-After); nunca un 4xx de negocio.
      // `IDEMPOTENCY_IN_PROGRESS` (409) también es transitorio: otra petición con la misma clave
      // tiene la reserva; al vencer su arrendamiento, el reintento la retoma.
      const retryable =
        category === 'technical' ||
        category === 'throttled' ||
        (category === 'conflict' && result.errorCode === 'IDEMPOTENCY_IN_PROGRESS');
      if (!retryable || RETRY_SECONDS <= 0 || performance.now() > retryUntil) return;
      const backoff = Math.min(2000, 100 * 2 ** Math.min(record.attempts, 5));
      await sleep(Math.max(backoff, Math.min(result.retryAfterS, 10) * 1000));
    }
  }

  async function worker() {
    while (!stop) {
      if (performance.now() >= deadline) break;
      if (MAX_REQUESTS > 0 && issued >= MAX_REQUESTS) break;
      issued += 1;
      await runLogical(WARMUP + issued);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  stop = true;
  clearInterval(sampler);
  const elapsedS = (performance.now() - startedAt) / 1000;

  const byCategory = {};
  const byStatus = {};
  const technicalCodes = {};
  const errorCodes = {};
  for (const a of attempts) {
    byCategory[a.category] = (byCategory[a.category] ?? 0) + 1;
    byStatus[a.status] = (byStatus[a.status] ?? 0) + 1;
    if (a.category === 'technical') {
      const code = a.errorCode ?? String(a.status);
      technicalCodes[code] = (technicalCodes[code] ?? 0) + 1;
    }
    if (a.category !== 'ok') {
      const code = `${a.status}:${a.errorCode ?? '-'}`;
      errorCodes[code] = (errorCodes[code] ?? 0) + 1;
    }
  }
  const served = attempts.filter((a) => a.category === 'ok' || a.category === 'business422');
  const outcomes = {};
  let keysWithDivergentExecution = 0;
  let logicalFinalTechnical = 0;
  let logicalFinalThrottled = 0;
  let logicalRetried = 0;
  for (const record of logical.values()) {
    if (record.outcome) outcomes[record.outcome] = (outcomes[record.outcome] ?? 0) + 1;
    if (record.executionIds.size > 1) keysWithDivergentExecution += 1;
    if (classify(record.finalStatus ?? 0) === 'technical') logicalFinalTechnical += 1;
    if (classify(record.finalStatus ?? 0) === 'throttled') logicalFinalThrottled += 1;
    if (record.attempts > 1) logicalRetried += 1;
  }

  // Serie por ventanas de 10 s: throughput servido y p95 de lo servido, para ver la caída y la vuelta.
  const windows = [];
  for (let w = 0; w * 10 < elapsedS; w += 1) {
    const slice = attempts.filter((a) => a.t >= w * 10 && a.t < (w + 1) * 10);
    const ok = slice.filter((a) => a.category === 'ok' || a.category === 'business422');
    windows.push({
      from: w * 10,
      servedPerS: Number((ok.length / 10).toFixed(1)),
      technical: slice.filter((a) => a.category === 'technical').length,
      throttled: slice.filter((a) => a.category === 'throttled').length,
      conflict: slice.filter((a) => a.category === 'conflict').length,
      p95: stats(ok.map((a) => a.ms)).p95,
    });
  }

  const rss = timeline.map((s) => s.rssMb).filter((v) => typeof v === 'number');
  const summary = {
    label: LABEL,
    baseUrl: BASE_URL,
    artifact: ARTIFACT,
    concurrency: CONCURRENCY,
    durationS: Number(elapsedS.toFixed(1)),
    warmup: WARMUP,
    keyPrefix: KEY_PREFIX,
    retrySeconds: RETRY_SECONDS,
    logicalRequests: logical.size,
    attempts: attempts.length,
    throughputServedPerS: Number((served.length / elapsedS).toFixed(1)),
    latencyServedMs: stats(served.map((a) => a.ms)),
    latencyOkMs: stats(attempts.filter((a) => a.category === 'ok').map((a) => a.ms)),
    latencyAllAttemptsMs: stats(attempts.map((a) => a.ms)),
    byCategory,
    byStatus,
    technicalCodes,
    errorCodes,
    outcomes,
    logicalRetried,
    logicalFinalTechnical,
    logicalFinalThrottled,
    keysWithDivergentExecution,
    process: rss.length
      ? {
          rssMbStart: rss[0],
          rssMbMax: Math.max(...rss),
          rssMbEnd: rss[rss.length - 1],
          cpuMaxPct: Math.max(...timeline.map((s) => s.cpu ?? 0)),
        }
      : null,
    poolSamples: timeline.filter((s) => s.pool).slice(-1)[0]?.pool ?? null,
    poolMaxWaiting: Math.max(
      0,
      ...timeline.flatMap((s) =>
        Object.entries(s.pool ?? {})
          .filter(([k]) => k.endsWith('.waiting'))
          .map(([, v]) => v),
      ),
    ),
    windows,
    timeline,
  };

  if (OUT) writeFileSync(OUT, `${JSON.stringify(summary, null, 2)}\n`);
  if (JSON_ONLY) {
    process.stdout.write(`${JSON.stringify(summary)}\n`);
    return;
  }
  const l = summary.latencyServedMs;
  console.log(
    [
      `== ${LABEL}: c=${CONCURRENCY} ${summary.durationS}s  lógicas=${logical.size} intentos=${attempts.length}`,
      `   servidas/s=${summary.throughputServedPerS}  p50=${l.p50} p95=${l.p95} p99=${l.p99} máx=${l.max} ms`,
      `   categorías=${JSON.stringify(byCategory)}  códigos=${JSON.stringify(errorCodes)}`,
      `   desenlaces=${JSON.stringify(outcomes)}  reintentadas=${logicalRetried}  finales-técnicas=${logicalFinalTechnical}  finales-429=${logicalFinalThrottled}  claves-con-2-ejecuciones=${keysWithDivergentExecution}`,
      summary.process
        ? `   RSS ${summary.process.rssMbStart}→${summary.process.rssMbEnd} MB (máx ${summary.process.rssMbMax}), CPU máx ${summary.process.cpuMaxPct}%`
        : '   (sin --pid: no se midió RSS/CPU)',
      `   pool: ${JSON.stringify(summary.poolSamples)} (máx en espera ${summary.poolMaxWaiting})`,
    ].join('\n'),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
