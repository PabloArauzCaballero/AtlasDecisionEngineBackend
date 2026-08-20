#!/usr/bin/env node
/**
 * Mide el coste real de la instrumentación.
 *
 * Existe porque «la sobrecarga es aceptable» no es una afirmación que se pueda hacer sin
 * medirla. Compara escenarios contra el MISMO backend ya arrancado, así que lo que cambia
 * entre ejecuciones es la configuración de telemetría del proceso, no la máquina.
 *
 * Uso:
 *   node scripts/bench-telemetry.mjs --label "otel-off" --requests 500
 *
 * Salida: JSON por stdout con p50/p95/p99, throughput y errores, para pegarlo en
 * docs/observability/05-performance-results.md sin transcribir números a mano.
 */
const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
}

const BASE_URL = args.get('base-url') ?? process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const PATH = args.get('path') ?? process.env.BENCH_PATH ?? '/health';
const REQUESTS = Number(args.get('requests') ?? 500);
const WARMUP = Number(args.get('warmup') ?? 50);
const CONCURRENCY = Number(args.get('concurrency') ?? 8);
const LABEL = args.get('label') ?? 'sin-etiqueta';

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

async function hit() {
  const started = performance.now();
  try {
    const response = await fetch(`${BASE_URL}${PATH}`);
    // El cuerpo se consume siempre: dejarlo sin leer mantiene la conexión ocupada y falsea
    // las medidas siguientes con un coste que no es el de la instrumentación.
    await response.arrayBuffer();
    return { ms: performance.now() - started, ok: response.status < 500 };
  } catch {
    return { ms: performance.now() - started, ok: false };
  }
}

async function run(count) {
  const samples = [];
  let errors = 0;
  let issued = 0;
  const startedAt = performance.now();

  async function worker() {
    while (issued < count) {
      issued += 1;
      const result = await hit();
      samples.push(result.ms);
      if (!result.ok) errors += 1;
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return { samples, errors, wallMs: performance.now() - startedAt };
}

async function main() {
  // Calentamiento descartado: la primera petición paga la compilación JIT y la apertura del
  // pool, y mezclarla con la medida convertiría un coste de arranque en latencia de régimen.
  await run(WARMUP);

  const { samples, errors, wallMs } = await run(REQUESTS);
  const sorted = [...samples].sort((a, b) => a - b);
  const mean = samples.reduce((total, value) => total + value, 0) / samples.length;

  const report = {
    label: LABEL,
    target: `${BASE_URL}${PATH}`,
    requests: samples.length,
    concurrency: CONCURRENCY,
    errors,
    meanMs: Number(mean.toFixed(2)),
    p50Ms: Number(percentile(sorted, 50).toFixed(2)),
    p95Ms: Number(percentile(sorted, 95).toFixed(2)),
    p99Ms: Number(percentile(sorted, 99).toFixed(2)),
    maxMs: Number(sorted[sorted.length - 1].toFixed(2)),
    throughputPerSecond: Number(((samples.length / wallMs) * 1000).toFixed(1)),
  };

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack ?? error}\n`);
  process.exit(1);
});
