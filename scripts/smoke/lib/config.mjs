/**
 * Configuración compartida por los tres smokes.
 *
 * Las credenciales nunca se inventan por defecto: una clave adivinada autentica como
 * nadie y produce un fallo falso que parece un defecto del producto. Si falta algo, el
 * smoke se detiene diciendo exactamente qué variable falta.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const OUT_DIR = join(REPO_ROOT, 'smoke', 'out');

function loadDotEnv(file) {
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    // Sin .env se depende de las variables ya exportadas: es el caso de CI.
    return;
  }
  for (const line of raw.split(/\r?\n/)) {
    if (/^\s*(#|$)/.test(line)) continue;
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, value] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = value.trim().replace(/^(['"])([\s\S]*)\1$/, '$2');
  }
}

loadDotEnv(join(REPO_ROOT, '.env'));

function env(name, fallback) {
  const value = process.env[name]?.trim();
  return value || fallback;
}

export const config = {
  baseUrl: env('SMOKE_BASE_URL') ?? env('BASE_URL') ?? `http://127.0.0.1:${env('PORT', '3000')}`,
  tenantId: env('SMOKE_TENANT_ID') ?? env('BOOTSTRAP_TENANT_ID', '1'),
  databaseUrl: env('DATABASE_URL'),
  /** Ambiente no productivo donde el smoke despliega y simula. PROD queda fuera a propósito. */
  environmentCode: env('SMOKE_ENVIRONMENT_CODE', 'SANDBOX'),
  /** El origen que `SessionOriginService` acepta; sólo lo usa el camino JWT. */
  sessionOrigin: env('SMOKE_SESSION_ORIGIN') ?? env('CORS_ALLOWED_ORIGINS', '').split(',')[0]?.trim(),
  /** Etiqueta única por corrida: evita chocar con datos de corridas anteriores. */
  runTag: env('SMOKE_RUN_TAG') ?? `${Date.now()}`,
  requestTimeoutMs: Number(env('SMOKE_REQUEST_TIMEOUT_MS', '30000')),
  /** Tope de espera para lo asíncrono (corridas de pruebas, workers). */
  pollTimeoutMs: Number(env('SMOKE_POLL_TIMEOUT_MS', '90000')),
};

export function requireConfig(name) {
  const value = config[name];
  if (!value) {
    throw new Error(
      `Falta la configuración "${name}". Defínela en .env o expórtala antes de correr el smoke.`,
    );
  }
  return value;
}
