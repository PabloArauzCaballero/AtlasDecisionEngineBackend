import { z } from 'zod';

/** Acepta únicamente `true`/`false` explícitos: un valor mal escrito debe fallar, no asumirse. */
function booleanFromEnvironment(defaultValue: boolean): z.ZodType<boolean, string | undefined> {
  return z
    .enum(['true', 'false'])
    .default(defaultValue ? 'true' : 'false')
    .transform((value) => value === 'true');
}

const databaseSslModeSchema = z.enum(['disable', 'require', 'no-verify']);

export type DatabaseSslMode = z.infer<typeof databaseSslModeSchema>;

export const semanticWorkerConfigSchema = z
  .object({
    databaseUrl: z.url(),
    databaseSslMode: databaseSslModeSchema.default('disable'),
    databasePoolMax: z.number().int().min(1).max(100).default(10),
    applicationName: z.string().trim().min(1).max(63).default('semantic-analysis-worker'),
    workerEnabled: z.boolean().default(false),
    queueName: z.string().trim().min(1).max(100).default('semantic-analysis'),
    deadLetterQueueName: z.string().trim().min(1).max(100).default('semantic-analysis-dead-letter'),
    deadLetterDrainEnabled: z.boolean().default(true),
    concurrency: z.number().int().min(1).max(100).default(5),
    maxRetries: z.number().int().min(0).max(20).default(3),
    retryDelaySeconds: z.number().int().min(1).max(3_600).default(30),
    retryBackoff: z.boolean().default(true),
    jobTimeoutSeconds: z.number().int().min(5).max(900).default(90),
    /**
     * Corta el análisis dentro del proceso. Debe ser estrictamente menor que `jobTimeoutSeconds`:
     * `pg-boss` expira el job pero no interrumpe el handler, así que sin este corte una llamada
     * colgada se ejecutaría en paralelo con su propio reintento.
     */
    analysisTimeoutSeconds: z.number().int().min(1).max(900).default(75),
    pollingIntervalSeconds: z.number().int().min(1).max(600).default(2),
    jobRetentionDays: z.number().int().min(1).max(365).default(7),
    shutdownTimeoutSeconds: z.number().int().min(1).max(300).default(30),
    candidateLimit: z.number().int().min(1).max(50).default(8),
    ambiguityMargin: z.number().min(0).max(0.5).default(0.08),
    healthPort: z.number().int().min(0).max(65_535).default(3001),

    /**
     * Vida de la caché de catálogo. Categorías y alias cambian con frecuencia mínima, pero cada
     * trabajo los consultaba de nuevo. `0` desactiva la caché.
     */
    catalogCacheTtlSeconds: z.number().int().min(0).max(3_600).default(60),

    /**
     * Vida de la caché de clasificación. Su clave incluye la firma del catálogo,
     * así que el TTL no protege contra datos obsoletos —de eso se encarga la
     * firma— sino que acota cuánta memoria retiene un proceso de vida larga.
     * `0` desactiva la caché.
     */
    classificationCacheTtlSeconds: z.number().int().min(0).max(86_400).default(3_600),
    /** Glosas distintas que se recuerdan a la vez. `0` desactiva la caché. */
    classificationCacheSize: z.number().int().min(0).max(1_000_000).default(5_000),

    /**
     * `lexical` conserva el comportamiento sin coste adicional. `hybrid` añade similitud por
     * embeddings, lo que mejora el recall cuando texto y categoría no comparten vocabulario, a
     * cambio de una llamada de embedding por análisis.
     */
    retrievalMode: z.enum(['lexical', 'hybrid']).default('lexical'),
    /** Peso de la similitud vectorial frente al solapamiento léxico en modo híbrido. */
    retrievalSemanticWeight: z.number().min(0).max(1).default(0.6),

    /** Retención de la auditoría. `0` desactiva la purga automática. */
    auditRetentionDays: z.number().int().min(0).max(3_650).default(90),
    /**
     * Plazo tras el cual el texto analizado se sustituye por su huella. Debe ser menor o igual que
     * la retención: minimizar después de borrar no tendría efecto.
     */
    auditMinimizeAfterDays: z.number().int().min(0).max(3_650).default(30),

    /** Máximo de análisis por tenant y ventana. `0` desactiva el límite. */
    tenantMaxAnalysesPerWindow: z.number().int().min(0).max(1_000_000).default(0),
    tenantBudgetWindowSeconds: z.number().int().min(60).max(2_592_000).default(3_600),
  })
  .superRefine((config, context) => {
    if (config.analysisTimeoutSeconds >= config.jobTimeoutSeconds) {
      context.addIssue({
        code: 'custom',
        path: ['analysisTimeoutSeconds'],
        message:
          'analysisTimeoutSeconds debe ser menor que jobTimeoutSeconds para cortar el análisis antes de que la cola reintente el job.',
      });
    }
    if (config.shutdownTimeoutSeconds < config.pollingIntervalSeconds) {
      context.addIssue({
        code: 'custom',
        path: ['shutdownTimeoutSeconds'],
        message:
          'shutdownTimeoutSeconds debe cubrir al menos un ciclo de sondeo para permitir un apagado limpio.',
      });
    }
    if (
      config.auditRetentionDays > 0 &&
      config.auditMinimizeAfterDays > config.auditRetentionDays
    ) {
      context.addIssue({
        code: 'custom',
        path: ['auditMinimizeAfterDays'],
        message:
          'auditMinimizeAfterDays debe ser menor o igual que auditRetentionDays: minimizar después de purgar no tiene efecto.',
      });
    }
  });

export type SemanticWorkerConfig = z.infer<typeof semanticWorkerConfigSchema>;

const environmentSchema = z.object({
  DATABASE_URL: z.url(),
  DATABASE_SSL_MODE: databaseSslModeSchema.default('disable'),
  DATABASE_POOL_MAX: z.coerce.number().int().default(10),
  SEMANTIC_APPLICATION_NAME: z.string().default('semantic-analysis-worker'),
  SEMANTIC_WORKER_ENABLED: booleanFromEnvironment(false),
  SEMANTIC_QUEUE_NAME: z.string().default('semantic-analysis'),
  SEMANTIC_DEAD_LETTER_QUEUE_NAME: z.string().default('semantic-analysis-dead-letter'),
  SEMANTIC_DEAD_LETTER_DRAIN_ENABLED: booleanFromEnvironment(true),
  SEMANTIC_WORKER_CONCURRENCY: z.coerce.number().int().default(5),
  SEMANTIC_WORKER_MAX_RETRIES: z.coerce.number().int().default(3),
  SEMANTIC_WORKER_RETRY_DELAY_SECONDS: z.coerce.number().int().default(30),
  SEMANTIC_WORKER_RETRY_BACKOFF: booleanFromEnvironment(true),
  SEMANTIC_WORKER_JOB_TIMEOUT_SECONDS: z.coerce.number().int().default(90),
  SEMANTIC_WORKER_ANALYSIS_TIMEOUT_SECONDS: z.coerce.number().int().default(75),
  SEMANTIC_WORKER_POLLING_INTERVAL_SECONDS: z.coerce.number().int().default(2),
  SEMANTIC_WORKER_JOB_RETENTION_DAYS: z.coerce.number().int().default(7),
  SEMANTIC_WORKER_SHUTDOWN_TIMEOUT_SECONDS: z.coerce.number().int().default(30),
  SEMANTIC_CANDIDATE_LIMIT: z.coerce.number().int().default(8),
  SEMANTIC_AMBIGUITY_MARGIN: z.coerce.number().default(0.08),
  SEMANTIC_HEALTH_PORT: z.coerce.number().int().default(3001),
  SEMANTIC_CATALOG_CACHE_TTL_SECONDS: z.coerce.number().int().default(60),
  SEMANTIC_CLASSIFICATION_CACHE_TTL_SECONDS: z.coerce.number().int().default(3_600),
  SEMANTIC_CLASSIFICATION_CACHE_SIZE: z.coerce.number().int().default(5_000),
  SEMANTIC_RETRIEVAL_MODE: z.enum(['lexical', 'hybrid']).default('lexical'),
  SEMANTIC_RETRIEVAL_SEMANTIC_WEIGHT: z.coerce.number().default(0.6),
  SEMANTIC_AUDIT_RETENTION_DAYS: z.coerce.number().int().default(90),
  SEMANTIC_AUDIT_MINIMIZE_AFTER_DAYS: z.coerce.number().int().default(30),
  SEMANTIC_TENANT_MAX_ANALYSES_PER_WINDOW: z.coerce.number().int().default(0),
  SEMANTIC_TENANT_BUDGET_WINDOW_SECONDS: z.coerce.number().int().default(3_600),
});

/**
 * Convierte variables de entorno en configuración validada del worker.
 *
 * @param environment - Variables disponibles para el proceso.
 * @returns Configuración inmutable y validada.
 */
export function loadSemanticWorkerConfig(
  environment: NodeJS.ProcessEnv = process.env,
): SemanticWorkerConfig {
  const parsed = environmentSchema.parse(environment);

  return semanticWorkerConfigSchema.parse({
    databaseUrl: parsed.DATABASE_URL,
    databaseSslMode: parsed.DATABASE_SSL_MODE,
    databasePoolMax: parsed.DATABASE_POOL_MAX,
    applicationName: parsed.SEMANTIC_APPLICATION_NAME,
    workerEnabled: parsed.SEMANTIC_WORKER_ENABLED,
    queueName: parsed.SEMANTIC_QUEUE_NAME,
    deadLetterQueueName: parsed.SEMANTIC_DEAD_LETTER_QUEUE_NAME,
    deadLetterDrainEnabled: parsed.SEMANTIC_DEAD_LETTER_DRAIN_ENABLED,
    concurrency: parsed.SEMANTIC_WORKER_CONCURRENCY,
    maxRetries: parsed.SEMANTIC_WORKER_MAX_RETRIES,
    retryDelaySeconds: parsed.SEMANTIC_WORKER_RETRY_DELAY_SECONDS,
    retryBackoff: parsed.SEMANTIC_WORKER_RETRY_BACKOFF,
    jobTimeoutSeconds: parsed.SEMANTIC_WORKER_JOB_TIMEOUT_SECONDS,
    analysisTimeoutSeconds: parsed.SEMANTIC_WORKER_ANALYSIS_TIMEOUT_SECONDS,
    pollingIntervalSeconds: parsed.SEMANTIC_WORKER_POLLING_INTERVAL_SECONDS,
    jobRetentionDays: parsed.SEMANTIC_WORKER_JOB_RETENTION_DAYS,
    shutdownTimeoutSeconds: parsed.SEMANTIC_WORKER_SHUTDOWN_TIMEOUT_SECONDS,
    candidateLimit: parsed.SEMANTIC_CANDIDATE_LIMIT,
    ambiguityMargin: parsed.SEMANTIC_AMBIGUITY_MARGIN,
    healthPort: parsed.SEMANTIC_HEALTH_PORT,
    catalogCacheTtlSeconds: parsed.SEMANTIC_CATALOG_CACHE_TTL_SECONDS,
    classificationCacheTtlSeconds: parsed.SEMANTIC_CLASSIFICATION_CACHE_TTL_SECONDS,
    classificationCacheSize: parsed.SEMANTIC_CLASSIFICATION_CACHE_SIZE,
    retrievalMode: parsed.SEMANTIC_RETRIEVAL_MODE,
    retrievalSemanticWeight: parsed.SEMANTIC_RETRIEVAL_SEMANTIC_WEIGHT,
    auditRetentionDays: parsed.SEMANTIC_AUDIT_RETENTION_DAYS,
    auditMinimizeAfterDays: parsed.SEMANTIC_AUDIT_MINIMIZE_AFTER_DAYS,
    tenantMaxAnalysesPerWindow: parsed.SEMANTIC_TENANT_MAX_ANALYSES_PER_WINDOW,
    tenantBudgetWindowSeconds: parsed.SEMANTIC_TENANT_BUDGET_WINDOW_SECONDS,
  });
}

/**
 * Traduce el modo SSL declarado a la configuración que esperan `pg` y `pg-boss`.
 *
 * `no-verify` es el compromiso habitual con Postgres gestionado que presenta un certificado
 * autofirmado; nunca debe usarse cuando la autoridad certificadora es verificable.
 */
export function resolveSslOptions(
  mode: DatabaseSslMode,
): false | { readonly rejectUnauthorized: boolean } {
  switch (mode) {
    case 'require':
      return { rejectUnauthorized: true };
    case 'no-verify':
      return { rejectUnauthorized: false };
    default:
      return false;
  }
}

const SECRET_PATTERN = /^(.*:)([^:@/]+)(@.*)$/u;

/**
 * Elimina la contraseña de una URL de conexión para poder registrarla sin filtrar credenciales.
 */
export function redactConnectionString(connectionString: string): string {
  return connectionString.replace(SECRET_PATTERN, '$1***$3');
}
