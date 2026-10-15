import { z } from 'zod';
import { booleanFromString, optionalUrl } from './helpers';

export const engineAndQaEnv = {
  // Fakers del servidor mock (AtlasExternalProvidersMock, `/mock/fakers`): de ahí salen los
  // datos realistas —nombre, carnet, celular, ingreso— de las corridas del QA Lab y de los
  // valores de prueba del simulador. Vacía = desactivados; si no responde, el lote sale del
  // generador local y la corrida lo archiva con su motivo (`fakers.source`).
  QA_FAKERS_BASE_URL: z.string().url().or(z.literal('')).default('http://127.0.0.1:4010/mock'),
  QA_FAKERS_TIMEOUT_MS: z.coerce.number().int().min(200).max(30_000).default(4_000),
  VARIABLE_BACKEND_URL: optionalUrl,
  VARIABLE_BACKEND_TIMEOUT_MS: z.coerce.number().int().min(100).max(30_000).default(1_500),
  AUDIT_HASH_SECRET: z.string().min(32),
  // Identifies the active signing secret. Bump it together with AUDIT_HASH_SECRET when
  // rotating, and move the old secret into AUDIT_HASH_PREVIOUS_SECRETS so historical
  // events stay verifiable.
  AUDIT_HASH_KEY_ID: z
    .string()
    .regex(/^[A-Za-z0-9_.-]{1,40}$/)
    .default('v1'),
  // JSON object of {keyId: secret} for retired keys, verification only.
  AUDIT_HASH_PREVIOUS_SECRETS: z.string().optional().or(z.literal('')),
  DEFAULT_ENVIRONMENT: z
    .string()
    .regex(/^[A-Z0-9_-]{2,40}$/)
    .default('PROD'),
  MAX_EXECUTION_STEPS: z.coerce.number().int().min(16).max(10_000).default(256),
  // Cuánto vale una decisión aprobada para conceder (`decisionValidUntil`). El motor no
  // reserva exposición: quien concede revalida, y no puede hacerlo con una decisión eterna.
  DECISION_VALIDITY_SECONDS: z.coerce.number().int().min(60).max(604_800).default(259_200),
  // Artefacto de ORIGINACIÓN en producción que no declara base habilitante: REVIEW (por
  // omisión, falla cerrado: sin base registrada va a revisión), BLOCK, o ALLOW_LEGACY (el
  // comportamiento anterior, sólo para volver atrás de forma explícita).
  ENABLING_BASIS_UNDECLARED_ORIGINATION: z
    .enum(['REVIEW', 'BLOCK', 'ALLOW_LEGACY'])
    .default('REVIEW'),
  // Variable CRÍTICA cuya frescura no se puede comprobar (sin sello o sin SLA positivo):
  // DEGRADE (por omisión: se decide, marcada), REJECT (NO_DECISION) o MEASURE (sólo anota).
  FRESHNESS_UNKNOWN_POLICY: z.enum(['REJECT', 'DEGRADE', 'MEASURE']).default('DEGRADE'),
  // El worker de corridas de prueba era el único trabajo de fondo sin interruptor: se
  // arrancaba en todo proceso que cargara el módulo, incluidas las réplicas de API.
  TEST_RUN_WORKER_ENABLED: booleanFromString.default(true),
  // Suelo del sondeo. Con el despertar por señal activo, una corrida encolada arranca al
  // commit y este valor solo gobierna la red de seguridad.
  TEST_RUN_WORKER_POLL_MS: z.coerce.number().int().min(50).max(10_000).default(500),
  // Techo del retroceso cuando la cola lleva rato vacía.
  TEST_RUN_WORKER_MAX_POLL_MS: z.coerce.number().int().min(500).max(600_000).default(30_000),
  // Cada cuánto se buscan corridas con el lease vencido. Un lease dura
  // TEST_RUN_LEASE_SECONDS, así que buscarlas más a menudo no puede encontrar nada nuevo.
  TEST_RUN_RECOVERY_INTERVAL_MS: z.coerce.number().int().min(1_000).max(600_000).default(30_000),
  TEST_RUN_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
  // Tope de intentos de una corrida de pruebas: una que mata al worker (OOM) en cada intento
  // deja de reencolarse y pasa a ERROR, en vez de tumbar el proceso cada TEST_RUN_LEASE_SECONDS.
  TEST_RUN_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  TEST_RUN_LEASE_SECONDS: z.coerce.number().int().min(30).max(3_600).default(300),
  TEST_CASE_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(4),
};
