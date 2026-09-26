#!/usr/bin/env node
/** Comprueba la API pública y el SHA que sirve después del deploy. */
const base = process.env.SMOKE_BASE_URL;
const targetSha = process.env.TARGET_SHA;
const attempts = Number(process.env.SMOKE_ATTEMPTS ?? '12');

if (!base || !/^https?:\/\//.test(base))
  throw new Error('SMOKE_BASE_URL debe ser una URL HTTP(S) explícita.');
if (!/^[a-f0-9]{40}$/i.test(targetSha ?? ''))
  throw new Error('TARGET_SHA debe ser un SHA Git de 40 caracteres.');
if (!Number.isInteger(attempts) || attempts < 1 || attempts > 60)
  throw new Error('SMOKE_ATTEMPTS inválido.');

const origin = new URL(base);
if (origin.username || origin.password || origin.search || origin.hash)
  throw new Error('SMOKE_BASE_URL no debe contener credenciales ni query.');
const endpoint = (path) => new URL(`${origin.pathname.replace(/\/$/, '')}${path}`, origin);

async function get(path) {
  const response = await fetch(endpoint(path), {
    signal: AbortSignal.timeout(5000),
    redirect: 'error',
  });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}

let live;
let lastError;
for (let attempt = 1; attempt <= attempts; attempt++) {
  try {
    live = await get('/health/live');
    if (
      live?.status !== 'ok' ||
      live?.service !== 'atlas-decision-engine-backend' ||
      live?.role !== 'API'
    ) {
      throw new Error('Liveness no identifica una API sana del motor.');
    }
    const readiness = await get('/health/ready');
    if (
      readiness?.status !== 'ready' ||
      readiness?.checks?.database !== 'ok' ||
      readiness?.checks?.cache !== 'redis'
    ) {
      throw new Error('Readiness no confirma PostgreSQL y Redis.');
    }
    lastError = null;
    break;
  } catch (error) {
    lastError = error;
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}
if (lastError) throw lastError;
if (!live?.version || live.version === 'unknown')
  throw new Error('La versión del motor es desconocida.');
if (live?.commit !== targetSha)
  throw new Error(
    `SHA servido ${live?.commit ?? '(vacío)'} difiere del SHA validado ${targetSha}.`,
  );
console.log(
  `Smoke OK: ${live.service} ${live.version} commit ${live.commit}; PostgreSQL y Redis sanos.`,
);
