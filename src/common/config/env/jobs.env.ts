import { z } from 'zod';
import { booleanFromString } from './helpers';

export const jobsEnv = {
  // ---------------------------------------------------------------------
  // Orquestación central de trabajos de fondo (common/jobs).
  //
  // El coste al ralentí del plano de fondo lo fijan estos valores, no cada trabajo por su
  // cuenta: un lote vacío multiplica su espera por JOB_BACKOFF_FACTOR hasta
  // JOB_MAX_IDLE_INTERVAL_MS, y el despertar por `pg_notify` la reinicia cuando de verdad
  // hay algo. Subir el techo abarata el ralentí sin tocar la latencia MIENTRAS la señal
  // funcione; con JOB_WAKE_ENABLED=false el techo pasa a ser la latencia del peor caso.
  // ---------------------------------------------------------------------
  JOB_SCHEDULER_ENABLED: booleanFromString.default(true),
  JOB_INITIAL_DELAY_MS: z.coerce.number().int().min(0).max(300_000).default(500),
  JOB_MIN_IDLE_INTERVAL_MS: z.coerce.number().int().min(50).max(600_000).default(1_000),
  JOB_MAX_IDLE_INTERVAL_MS: z.coerce.number().int().min(100).max(3_600_000).default(30_000),
  // 1 desactiva el retroceso y deja una cadencia fija en el mínimo: solo tiene sentido
  // para depurar, porque devuelve el coste plano que este mecanismo existe para eliminar.
  JOB_BACKOFF_FACTOR: z.coerce.number().min(1).max(10).default(2),
  JOB_ERROR_INTERVAL_MS: z.coerce.number().int().min(100).max(600_000).default(5_000),
  JOB_MAX_ERROR_INTERVAL_MS: z.coerce.number().int().min(1_000).max(3_600_000).default(120_000),
  // Despertar por LISTEN/NOTIFY. Desactívalo si la conexión pasa por un `pgbouncer` en
  // modo transacción o statement, que no propaga las notificaciones: el sistema sigue
  // siendo correcto, solo pierde latencia hasta el siguiente sondeo.
  JOB_WAKE_ENABLED: booleanFromString.default(true),
  JOB_WAKE_CHANNEL: z
    .string()
    .regex(/^[a-z0-9][a-z0-9_-]{0,62}$/)
    .default('atlas_jobs'),
};
