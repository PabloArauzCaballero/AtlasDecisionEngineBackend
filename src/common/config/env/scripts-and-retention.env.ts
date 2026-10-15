import { z } from 'zod';
import { booleanFromString } from './helpers';

export const scriptsAndRetentionEnv = {
  // Los escenarios de prueba son sintéticos, pero crean ejecuciones reales. En
  // producción están apagados para que no contaminen la operación.
  WORKERS_FIXTURES_ENABLED: booleanFromString.default(false),
  SCRIPT_NODES_ENABLED: booleanFromString.default(false),
  SCRIPT_RUNNER_MODE: z.enum(['IN_PROCESS', 'SIDECAR']).default('IN_PROCESS'),
  // Interpreter used by the in-process runner and the Code->Flow Python syntax checker.
  // The SIDECAR image ships only `python3`, so that container sets this explicitly; the
  // default matches the usual development install where the launcher is named `python`.
  /*
   * `python3` y no `python`: desde el fin de vida de Python 2 el nombre corto dejó de existir en
   * macOS y en la mayoría de distribuciones, y PEP 394 sólo garantiza `python3`. El defecto
   * anterior funcionaba en la máquina de quien lo escribió y fallaba en las demás con un
   * `SCRIPT_EXECUTION_FAILED` que hablaba del script, no del intérprete ausente.
   */
  PYTHON_EXECUTABLE: z.string().min(1).default('python3'),
  SCRIPT_RUNNER_SOCKET_PATH: z.string().min(1).default('/var/run/atlas-runner/runner.sock'),
  SCRIPT_NODE_TIMEOUT_MS: z.coerce.number().int().min(10).max(5_000).default(250),
  SCRIPT_NODE_MAX_SOURCE_BYTES: z.coerce.number().int().min(1).max(65_536).default(16_384),
  SCRIPT_NODE_MAX_OUTPUT_BYTES: z.coerce.number().int().min(1_024).max(1_048_576).default(65_536),
  /** Cota de memoria por proceso de script (§9.3): --max-old-space-size en JS, RLIMIT_AS en Python. */
  SCRIPT_NODE_MAX_MEMORY_MB: z.coerce.number().int().min(16).max(512).default(32),
  IDEMPOTENCY_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(24),
  // Short lease held while a decision is PROCESSING, so a crashed holder frees the key in
  // seconds instead of blocking it for the full response TTL. Must be declared here or the
  // schema strips it and IdempotencyService silently falls back to its 60s default.
  IDEMPOTENCY_LEASE_SECONDS: z.coerce.number().int().min(1).max(3_600).default(60),
  // Retention sweep for expired runtime idempotency rows. The table is the highest
  // volume in the system and every row already carries an expiry, so a background
  // purge keeps it from growing without bound. Disable only for tests that assert on
  // idempotency rows directly.
  RUNTIME_RETENTION_SWEEP_ENABLED: booleanFromString.default(true),
  RUNTIME_RETENTION_SWEEP_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(60_000)
    .max(86_400_000)
    .default(3_600_000),
  // Extra margin kept beyond expiry before a row is eligible for deletion, so an
  // in-flight replay racing expiry is never purged out from under itself.
  RUNTIME_IDEMPOTENCY_RETENTION_GRACE_HOURS: z.coerce.number().int().min(0).max(720).default(24),
  // Upper bound on rows deleted per statement, so a purge never holds a long lock.
  RUNTIME_RETENTION_SWEEP_BATCH: z.coerce.number().int().min(100).max(50_000).default(1_000),
  MAX_PAGE_SIZE: z.coerce.number().int().min(10).max(500).default(100),
  // Verification streams the append-only chain in bounded batches rather than loading a
  // tenant's full regulatory history into memory.
  AUDIT_VERIFY_BATCH_SIZE: z.coerce.number().int().min(10).max(10_000).default(500),
};
