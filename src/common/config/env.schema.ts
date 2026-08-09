import { z } from 'zod';
import { WORKER_ROLES } from './worker-role';

const booleanFromString = z.preprocess((value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return value;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
  if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
  return value;
}, z.boolean());

const optionalUrl = z.string().url().optional().or(z.literal(''));
const optionalSecret = z.string().min(24).optional().or(z.literal(''));

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    BUILD_VERSION: z.string().max(80).default('2.0.0'),
    COMMIT_SHA: z.string().max(80).default('local'),
    // The published API contract version, deliberately separate from BUILD_VERSION: the build
    // changes on every release, the contract only on a breaking change. Consumers pin to this.
    API_VERSION: z
      .string()
      .regex(/^v[0-9]+$/)
      .default('v1'),

    // Reparto de responsabilidades entre procesos; ver common/config/worker-role.ts.
    // `ALL` conserva el comportamiento de un solo contenedor que sirve y procesa.
    WORKER_ROLE: z.enum(WORKER_ROLES).default('ALL'),
    // Puerto de sondas del proceso WORKER, que no sirve tráfico de negocio pero sí debe
    // poder declararse vivo y listo ante el orquestador. También sirve `/metrics`.
    WORKER_HEALTH_PORT: z.coerce.number().int().min(1).max(65_535).default(3001),

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

    // URL pública desde la que los consumidores alcanzan esta API. Se publica en el
    // contrato OpenAPI; sin ella solo se declara el servidor relativo, que es preferible a
    // publicar la URL de otro ambiente y que un cliente generado apunte al sitio equivocado.
    API_PUBLIC_URL: optionalUrl,

    DATABASE_URL: z.string().min(1),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(15),
    DATABASE_CONNECTION_TIMEOUT_MS: z.coerce.number().int().min(250).max(60_000).default(5_000),
    DATABASE_IDLE_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(600_000).default(30_000),
    DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(300_000).default(30_000),

    // ---------------------------------------------------------------------
    // Separación de rutas de datos (ADR-0029).
    //
    // Vacías, las tres rutas son la misma conexión y el comportamiento es idéntico al
    // anterior: DATABASE_URL sigue siendo la única variable obligatoria. Declarar
    // DATABASE_READ_URL con el rol lector separa lectura y escritura por credencial;
    // apuntarla a otro host la separa por servidor (réplica). El registro reutiliza el
    // pool cuando las huellas coinciden, así que declarar la misma URL no duplica nada.
    // ---------------------------------------------------------------------
    DATABASE_WRITE_URL: z.string().optional().or(z.literal('')),
    DATABASE_READ_URL: z.string().optional().or(z.literal('')),
    /** Pool de la ruta de lectura; sin valor hereda DATABASE_POOL_MAX. */
    DATABASE_READ_POOL_MAX: z.coerce.number().int().min(1).max(100).optional(),
    /**
     * Interruptor de la separación de rutas. Apagado, toda lectura vuelve al primario y el
     * sistema se comporta exactamente como antes: es el rollback de esta migración sin
     * desplegar nada. Se enciende cuando la conexión de lectura está aprovisionada.
     */
    DATA_READ_ROUTING_ENABLED: booleanFromString.default(false),
    /**
     * Ante una conexión de lectura no disponible, servir desde el primario. Nunca es
     * silencioso: cada degradación deja log estructurado y `atlas_database_fallback_total`.
     */
    ENABLE_PRIMARY_READ_FALLBACK: booleanFromString.default(true),
    /**
     * Reglas de enrutamiento por módulo, en JSON. Se fusionan sobre las reglas base de
     * `persistence/routing/routing-rules.ts`; un JSON inválido impide arrancar.
     * Ejemplo: {"views":{"read":"postgres-read","consistency":"eventual"}}
     */
    DATA_ROUTING_RULES: z.string().max(8_000).optional().or(z.literal('')),

    REDIS_URL: optionalUrl,
    REDIS_PREFIX: z
      .string()
      .regex(/^[a-zA-Z0-9:_-]{1,80}$/)
      .default('atlas:decision'),
    REQUIRE_REDIS_IN_PRODUCTION: booleanFromString.default(true),

    AUTH_MODE: z
      .enum(['API_KEY', 'JWT', 'HYBRID', 'IDENTITY_PROVIDER', 'IDENTITY_HYBRID'])
      .default('API_KEY'),
    MANAGEMENT_API_KEY: optionalSecret,
    RUNTIME_API_KEY: optionalSecret,
    JWT_JWKS_URL: optionalUrl,
    JWT_ISSUER: z.string().max(500).optional().or(z.literal('')),
    JWT_MANAGEMENT_AUDIENCE: z.string().max(200).default('atlas-decision-management'),
    JWT_RUNTIME_AUDIENCE: z.string().max(200).default('atlas-decision-runtime'),
    JWT_TENANT_CLAIM: z.string().max(120).default('tenant_id'),
    JWT_ROLES_CLAIM: z.string().max(120).default('roles'),
    JWT_JWKS_CACHE_SECONDS: z.coerce.number().int().min(30).max(86_400).default(900),
    JWT_JWKS_TIMEOUT_MS: z.coerce.number().int().min(250).max(15_000).default(3_000),
    JWT_CLOCK_SKEW_SECONDS: z.coerce.number().int().min(0).max(300).default(30),
    IDENTITY_PROVIDER_URL: optionalUrl,
    IDENTITY_PROVIDER_TIMEOUT_MS: z.coerce.number().int().min(250).max(15_000).default(3_000),
    // Retries only for transient failures (network error / timeout / 502-503-504), never for a
    // rejected credential. Shields login from the brief window where the provider dev server is
    // restarting (build-and-watch). 0 disables retries.
    IDENTITY_PROVIDER_RETRY_ATTEMPTS: z.coerce.number().int().min(0).max(5).default(2),
    IDENTITY_PROVIDER_RETRY_BACKOFF_MS: z.coerce.number().int().min(0).max(5_000).default(300),
    IDENTITY_REFRESH_COOKIE_NAME: z
      .string()
      .regex(/^[A-Za-z0-9_-]{3,80}$/)
      .default('atlas_refresh'),
    IDENTITY_REFRESH_COOKIE_MAX_AGE_SECONDS: z.coerce
      .number()
      .int()
      .min(300)
      .max(7_776_000)
      .default(2_592_000),
    IDENTITY_SESSION_RATE_LIMIT: z.coerce.number().int().min(1).max(1_000).default(20),

    CORS_ALLOWED_ORIGINS: z.string().default(''),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(1),
    BODY_LIMIT_BYTES: z.coerce.number().int().min(1_024).max(10_485_760).default(1_048_576),
    REQUEST_TIMEOUT_MS: z.coerce.number().int().min(500).max(120_000).default(15_000),
    // Plazo total del apagado ordenado. El 80 % acota el drenaje de lotes en vuelo del
    // orquestador de trabajos y el resto queda para cerrar los pools y vaciar las trazas;
    // agotado el plazo, el proceso fuerza la salida. Debe quedar POR DEBAJO del
    // terminationGracePeriodSeconds del orquestador: si lo supera, el SIGKILL llega antes que
    // el vigilante y se pierde el motivo del apagado, que es justo lo que se quería salvar.
    SHUTDOWN_GRACE_MS: z.coerce.number().int().min(1_000).max(120_000).default(20_000),

    RATE_LIMIT_ENABLED: booleanFromString.default(true),
    RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(1).max(3_600).default(60),
    RATE_LIMIT_MANAGEMENT_REQUESTS: z.coerce.number().int().min(1).max(100_000).default(300),
    RATE_LIMIT_RUNTIME_REQUESTS: z.coerce.number().int().min(1).max(100_000).default(1_500),
    AUTH_FAILURE_RATE_LIMIT: z.coerce.number().int().min(1).max(10_000).default(20),

    SWAGGER_ENABLED: booleanFromString.default(false),
    METRICS_ENABLED: booleanFromString.default(true),
    METRICS_TOKEN: optionalSecret,
    LOG_LEVEL: z.enum(['error', 'warn', 'log', 'debug', 'verbose']).default('log'),
    // Containers run with a read-only root filesystem, so writing a log file must be an
    // explicit opt-in backed by a mounted volume.
    LOG_OUTPUT: z.enum(['stdout', 'stdout_and_file']).default('stdout'),
    LOG_FILE_PATH: z.string().min(1).default('logs/atlas-decision-engine.log'),
    ACCESS_AUDIT_ENABLED: booleanFromString.default(true),
    // Authentication denials are buffered only long enough to bridge a transient database
    // outage. Bounds prevent an attacker from turning the safety net into unbounded memory.
    ACCESS_AUDIT_QUEUE_MAX: z.coerce.number().int().min(10).max(100_000).default(1_000),
    ACCESS_AUDIT_RETRY_SECONDS: z.coerce.number().int().min(1).max(3_600).default(15),

    // Distributed tracing. Read directly from process.env by observability/tracing.ts (it runs
    // before the Nest container exists); declared here so the values are still validated and
    // documented rather than being undeclared magic strings.
    OTEL_ENABLED: booleanFromString.default(false),
    OTEL_SERVICE_NAME: z.string().max(120).default('atlas-decision-engine'),
    // Agrupa API y worker bajo el mismo producto en el grafo de servicios de Jaeger.
    OTEL_SERVICE_NAMESPACE: z.string().max(120).default('atlas'),
    // Por defecto se toma BUILD_VERSION; esta variable sólo existe para despliegues que
    // versionan la telemetría por separado del artefacto.
    OTEL_SERVICE_VERSION: z.string().max(60).optional(),
    OTEL_DEPLOYMENT_ENVIRONMENT: z.string().max(60).optional(),
    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: optionalUrl,
    OTEL_EXPORT_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(10_000),
    // Muestreo basado en el padre: se respeta la decisión de un servicio aguas arriba, porque
    // media traza no sirve para nada. La proporción sólo gobierna las trazas que nacen aquí.
    OTEL_TRACES_SAMPLER: z.string().max(60).default('parentbased_traceidratio'),
    OTEL_TRACES_SAMPLER_ARG: z.coerce.number().min(0).max(1).default(1),
    OTEL_PROPAGATORS: z.string().max(120).default('tracecontext,baggage'),
    OTEL_DIAG_LOG_LEVEL: z
      .enum(['NONE', 'ERROR', 'WARN', 'INFO', 'DEBUG', 'VERBOSE', 'ALL'])
      .default('ERROR'),

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
    TEST_RUN_LEASE_SECONDS: z.coerce.number().int().min(30).max(3_600).default(300),
    TEST_CASE_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(4),

    // --- Workers adicionales (ADR-0026) -------------------------------------
    // Los dos vienen APAGADOS por defecto, al revés que los trabajos nativos: un
    // despliegue que se actualice no debe empezar a consumir cuota de un
    // proveedor de modelos ni a cargar `pdfjs-dist` sin que nadie lo haya pedido.
    SEMANTIC_ANALYSIS_WORKER_ENABLED: booleanFromString.default(false),
    SEMANTIC_ANALYSIS_WORKER_POLL_MS: z.coerce.number().int().min(50).max(10_000).default(500),
    SEMANTIC_ANALYSIS_WORKER_MAX_POLL_MS: z.coerce
      .number()
      .int()
      .min(500)
      .max(600_000)
      .default(30_000),
    SEMANTIC_ANALYSIS_RECOVERY_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(600_000)
      .default(30_000),
    SEMANTIC_ANALYSIS_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(4),
    SEMANTIC_ANALYSIS_LEASE_SECONDS: z.coerce.number().int().min(30).max(3_600).default(120),
    // Agotados los intentos la ejecución queda FAILED en vez de volver a la cola:
    // reintentar sin cota convierte un fallo permanente en gasto perpetuo.
    SEMANTIC_ANALYSIS_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
    SEMANTIC_ANALYSIS_MAX_TEXT_LENGTH: z.coerce.number().int().min(100).max(100_000).default(8_000),
    // Vacío ⇒ el worker NO se registra, y lo dice en el log. Es preferible a
    // arrancar y fallar en cada job por falta de credenciales.
    SEMANTIC_ANALYSIS_PROVIDER: z.enum(['', 'openai', 'transformer']).default(''),
    /**
     * Reconocimiento explícito de que el texto analizado SALE del país.
     *
     * El proveedor `openai` envía a `api.openai.com` el texto que se le pide clasificar, y ese
     * texto viene de extractos y descripciones de movimientos: dato personal. Eso es una
     * transferencia internacional, con obligaciones propias —LGPD art. 33 y las cláusulas
     * estándar de la Res. CD/ANPD 19/2024; y, para una institución financiera brasileña, la
     * notificación previa a BACEN que exige la Res. 4.658 arts. 11-15 para procesar datos en
     * el exterior—.
     *
     * Se exige el reconocimiento en producción por el mismo motivo que `SCRIPT_RUNNER_MODE`
     * no admite el runner en proceso: es una decisión con consecuencia legal que nadie debe
     * tomar por omisión, heredando un valor por defecto. Fuera de producción no estorba.
     */
    SEMANTIC_ALLOW_INTERNATIONAL_TRANSFER: booleanFromString.default(false),
    SEMANTIC_ANALYSIS_BUDGET_WINDOW_SECONDS: z.coerce
      .number()
      .int()
      .min(60)
      .max(86_400)
      .default(3_600),
    SEMANTIC_ANALYSIS_BUDGET_MAX_ANALYSES: z.coerce
      .number()
      .int()
      .min(1)
      .max(1_000_000)
      .default(1_000),
    // --- Retención del texto analizado ---
    // El texto que se clasifica se persiste íntegro para poder explicar la
    // decisión, y en el caso de un proveedor alojado ya salió del perímetro una
    // vez. Retenerlo indefinidamente añade una segunda copia permanente que
    // nadie pidió, así que la barrida lo minimiza (lo sustituye por su huella) y
    // más tarde purga la fila entera.
    SEMANTIC_ANALYSIS_MINIMIZE_AFTER_DAYS: z.coerce.number().int().min(0).max(3_650).default(30),
    SEMANTIC_ANALYSIS_AUDIT_RETENTION_DAYS: z.coerce.number().int().min(0).max(3_650).default(90),
    SEMANTIC_ANALYSIS_RETENTION_SWEEP_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(60_000)
      .max(86_400_000)
      .default(3_600_000),

    BANK_STATEMENT_WORKER_ENABLED: booleanFromString.default(false),
    BANK_STATEMENT_WORKER_POLL_MS: z.coerce.number().int().min(50).max(10_000).default(500),
    BANK_STATEMENT_WORKER_MAX_POLL_MS: z.coerce
      .number()
      .int()
      .min(500)
      .max(600_000)
      .default(30_000),
    BANK_STATEMENT_RECOVERY_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(600_000)
      .default(30_000),
    // Menor que la del semántico: cada job carga un PDF entero en memoria.
    BANK_STATEMENT_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),
    BANK_STATEMENT_LEASE_SECONDS: z.coerce.number().int().min(30).max(3_600).default(300),
    BANK_STATEMENT_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
    // 10 MiB. Acota a la vez la memoria del worker y el tamaño de la fila, porque
    // el documento se guarda en la propia base (ADR-0026).
    BANK_STATEMENT_MAX_UPLOAD_BYTES: z.coerce
      .number()
      .int()
      .min(1_024)
      .max(52_428_800)
      .default(10_485_760),
    // Un PDF hostil puede hacer trabajar al lector indefinidamente. El presupuesto
    // corta el job, no el proceso.
    BANK_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(600_000).default(60_000),

    // Los escenarios de prueba son sintéticos, pero crean ejecuciones reales. En
    // producción están apagados para que no contaminen la operación.
    WORKERS_FIXTURES_ENABLED: booleanFromString.default(false),
    SCRIPT_NODES_ENABLED: booleanFromString.default(false),
    SCRIPT_RUNNER_MODE: z.enum(['IN_PROCESS', 'SIDECAR']).default('IN_PROCESS'),
    // Interpreter used by the in-process runner and the Code->Flow Python syntax checker.
    // The SIDECAR image ships only `python3`, so that container sets this explicitly; the
    // default matches the usual development install where the launcher is named `python`.
    PYTHON_EXECUTABLE: z.string().min(1).default('python'),
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

    // ---------------------------------------------------------------------
    // Nested decision trees (Fase 7), Code->Flow import (Fase 5), live
    // execution stream (Fase 8).
    // ---------------------------------------------------------------------
    NESTED_TREE_MAX_DEPTH: z.coerce.number().int().min(1).max(20).default(5),
    NESTED_TREE_DEFAULT_TIMEOUT_MS: z.coerce.number().int().min(50).max(60_000).default(2_000),
    /** Cota de aristas de la vista de dependencias; por encima se recorta y se declara. */
    NESTED_TREE_GRAPH_MAX_EDGES: z.coerce.number().int().min(10).max(50_000).default(2_000),
    NESTED_TREE_MAX_ARTIFACTS: z.coerce.number().int().min(1).max(500).default(25),
    NESTED_TREE_MAX_TOTAL_MS: z.coerce.number().int().min(100).max(120_000).default(10_000),
    NESTED_TREE_MAX_RESULT_BYTES: z.coerce
      .number()
      .int()
      .min(1_024)
      .max(10_485_760)
      .default(262_144),
    /** Bytes acumulados de resultados intermedios que puede retener una cadena (§9.3). */
    NESTED_TREE_MAX_RETAINED_BYTES: z.coerce
      .number()
      .int()
      .min(4_096)
      .max(67_108_864)
      .default(1_048_576),
    CODE_IMPORT_MAX_SOURCE_BYTES: z.coerce
      .number()
      .int()
      .min(1_024)
      .max(1_048_576)
      .default(131_072),
    CODE_IMPORT_ANALYSIS_TIMEOUT_MS: z.coerce.number().int().min(100).max(10_000).default(2_000),
    // Live preview is opt-in: it executes real non-PROD graphs but intentionally writes no
    // decision/audit/outbox record. Heartbeats keep proxies and the global timeout alive.
    LIVE_EXECUTION_STREAM_ENABLED: booleanFromString.default(false),
    LIVE_EXECUTION_STREAM_HEARTBEAT_MS: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(60_000)
      .default(15_000),

    // Transactional outbox relay (event-driven backbone). The relay claims PENDING events
    // with a short lease and dispatches them to the in-process bus; disable only in tests
    // that drive dispatch manually or in replicas that must not run background workers.
    OUTBOX_RELAY_ENABLED: booleanFromString.default(true),
    // Suelo del sondeo del relay y base del backoff por evento fallido.
    OUTBOX_RELAY_INTERVAL_MS: z.coerce.number().int().min(100).max(60_000).default(1_000),
    // Techo del retroceso con el outbox vacío. El productor anuncia cada fila con
    // `pg_notify` al confirmar, así que subir este techo no retrasa el reparto real.
    OUTBOX_RELAY_MAX_INTERVAL_MS: z.coerce.number().int().min(500).max(600_000).default(30_000),
    // Cada cuánto se cuenta la profundidad del outbox para el gauge. Contarla en cada ciclo
    // hacía que medir el backlog costara más que repartirlo.
    OUTBOX_BACKLOG_SAMPLE_MS: z.coerce.number().int().min(1_000).max(600_000).default(30_000),
    OUTBOX_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(25),
    // Failed dispatches back off exponentially via available_at; after this many attempts
    // the event is dead-lettered (status DEAD) for operator attention.
    OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(50).default(8),
    // Claim lease: a relay replica that dies mid-batch frees its rows after this lapse.
    OUTBOX_LEASE_MS: z.coerce.number().int().min(1_000).max(600_000).default(30_000),
    // Idempotently injects bootstrap seeds (every environment) and mockup/demo seeds
    // (development only) at application startup. Left unset it is on everywhere except
    // `test`, where suites provision their own fixtures. Set explicitly to force either way.
    // Solo surte efecto donde corren los trabajos de fondo (WORKER_ROLE ∈ ALL, WORKER): una
    // réplica de API nunca siembra, aunque esto esté en `true`.
    STARTUP_SEED_ENABLED: booleanFromString.optional(),
    // Decide si la corrida incluye los datos de DEMOSTRACIÓN (artefactos de ejemplo con
    // despliegues ACTIVOS). Lo resuelve `seeding/mockup-policy.ts`, compartido con
    // `prisma db seed`; se declara aquí para que exista en la documentación del entorno y
    // no como una variable mágica. Sin declarar, se deduce de NODE_ENV.
    // OJO: `NODE_ENV` NO basta como guarda de producción —la imagen del migrador lo fija en
    // `production` también en un portátil—, por eso `docker-compose.prod.yml` la pone en
    // `false` de forma explícita.
    SEED_INCLUDE_MOCKUP: booleanFromString.optional(),
    // Bootstrap integration clients. Read straight from process.env by the seed helpers
    // (they stay framework-free so `prisma db seed` can run them without Nest); declared
    // here so the values are validated and documented instead of being magic strings.
    //
    // El tenant de TODO lo que siembra el módulo, no sólo de estos clientes: lo resuelve
    // `seeding/data/helpers.ts`. `[1-9][0-9]*` y no `[0-9]+` para que las dos validaciones
    // digan lo mismo — el `0` pasaba aquí y el resolutor lo rechaza, así que un despliegue
    // arrancaba y la siembra moría después, que es el peor sitio para enterarse.
    BOOTSTRAP_TENANT_ID: z
      .string()
      .regex(/^[1-9][0-9]*$/)
      .default('1'),
    // Sinónimo histórico, el que usan los guiones de `prisma/dev-seeds/`. Se declara para
    // que valide igual; si están las dos, manda BOOTSTRAP_TENANT_ID.
    SEED_TENANT_ID: z
      .string()
      .regex(/^[1-9][0-9]*$/)
      .optional(),
    BOOTSTRAP_MANAGEMENT_ROLES: z.string().default(''),
    BOOTSTRAP_RUNTIME_ROLES: z.string().default(''),
  })
  .superRefine((value, ctx) => {
    // El lease de idempotencia tiene que sobrevivir a la decisión más larga que la
    // configuración permite. Si vence antes, otra petición reclama legítimamente la clave
    // mientras el titular sigue trabajando: la respuesta del titular ya no se cachea (la
    // guardia de propiedad de `IdempotencyService` la descarta) y el reintento vuelve a
    // ejecutar la decisión. Cada cota se comprobaba por separado y nadie comparaba las tres,
    // así que `NESTED_TREE_MAX_TOTAL_MS=120000` con el lease por defecto de 60 s era una
    // combinación aceptada que rompía la idempotencia en silencio.
    const leaseMs = value.IDEMPOTENCY_LEASE_SECONDS * 1_000;
    const longestDecisionMs = Math.max(value.REQUEST_TIMEOUT_MS, value.NESTED_TREE_MAX_TOTAL_MS);
    if (leaseMs <= longestDecisionMs) {
      ctx.addIssue({
        code: 'custom',
        path: ['IDEMPOTENCY_LEASE_SECONDS'],
        message:
          `El lease (${leaseMs} ms) debe superar la decisión más larga admisible ` +
          `(${longestDecisionMs} ms = máx. de REQUEST_TIMEOUT_MS y NESTED_TREE_MAX_TOTAL_MS); ` +
          'si no, una petición puede reclamar una clave que su titular sigue ejecutando',
      });
    }

    if (value.AUDIT_HASH_PREVIOUS_SECRETS) {
      try {
        const retired = JSON.parse(value.AUDIT_HASH_PREVIOUS_SECRETS) as unknown;
        const valid =
          retired !== null &&
          typeof retired === 'object' &&
          !Array.isArray(retired) &&
          Object.entries(retired).every(
            ([keyId, secret]) =>
              /^[A-Za-z0-9_.-]{1,40}$/.test(keyId) &&
              typeof secret === 'string' &&
              secret.length >= 32,
          );
        if (!valid) throw new Error('invalid retired key map');
      } catch {
        ctx.addIssue({
          code: 'custom',
          path: ['AUDIT_HASH_PREVIOUS_SECRETS'],
          message: 'Must be a JSON object of {keyId: secret}, with secrets at least 32 characters',
        });
      }
    }

    // Solo la sintaxis: la forma de las reglas y la existencia de cada conexión las valida
    // el router al construirse, que es quien conoce el registro. Comprobar aquí el JSON
    // convierte un error de tecleo en un fallo de arranque con el nombre de la variable.
    if (value.DATA_ROUTING_RULES) {
      try {
        const parsed: unknown = JSON.parse(value.DATA_ROUTING_RULES);
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('not an object');
        }
      } catch {
        ctx.addIssue({
          code: 'custom',
          path: ['DATA_ROUTING_RULES'],
          message: 'Must be a JSON object mapping module names to routing rules',
        });
      }
    }

    const requiresApiKeys =
      value.AUTH_MODE === 'API_KEY' ||
      value.AUTH_MODE === 'HYBRID' ||
      value.AUTH_MODE === 'IDENTITY_HYBRID';
    const requiresJwt = value.AUTH_MODE === 'JWT' || value.AUTH_MODE === 'HYBRID';
    const requiresIdentityProvider =
      value.AUTH_MODE === 'IDENTITY_PROVIDER' || value.AUTH_MODE === 'IDENTITY_HYBRID';

    if (requiresApiKeys) {
      if (!value.MANAGEMENT_API_KEY) {
        ctx.addIssue({
          code: 'custom',
          path: ['MANAGEMENT_API_KEY'],
          message: 'Required for API_KEY or HYBRID authentication',
        });
      }
      if (!value.RUNTIME_API_KEY) {
        ctx.addIssue({
          code: 'custom',
          path: ['RUNTIME_API_KEY'],
          message: 'Required for API_KEY or HYBRID authentication',
        });
      }
      if (
        value.MANAGEMENT_API_KEY &&
        value.RUNTIME_API_KEY &&
        value.MANAGEMENT_API_KEY === value.RUNTIME_API_KEY
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['RUNTIME_API_KEY'],
          message: 'Management and runtime API keys must be different',
        });
      }
    }

    if (requiresJwt) {
      if (!value.JWT_JWKS_URL) {
        ctx.addIssue({
          code: 'custom',
          path: ['JWT_JWKS_URL'],
          message: 'Required for JWT or HYBRID authentication',
        });
      }
      if (!value.JWT_ISSUER) {
        ctx.addIssue({
          code: 'custom',
          path: ['JWT_ISSUER'],
          message: 'Required for JWT or HYBRID authentication',
        });
      }
    }

    if (requiresIdentityProvider && !value.IDENTITY_PROVIDER_URL) {
      ctx.addIssue({
        code: 'custom',
        path: ['IDENTITY_PROVIDER_URL'],
        message: 'Required for identity provider authentication',
      });
    }

    if (value.NODE_ENV === 'production') {
      // Transferencia internacional de datos personales.
      //
      // El proveedor `openai` manda a `api.openai.com` el texto que clasifica, y ese texto
      // sale de extractos y descripciones de movimientos. Es un dato personal cruzando la
      // frontera, con obligaciones propias (LGPD art. 33 + Res. CD/ANPD 19/2024; y para una
      // institución financiera brasileña, la notificación previa a BACEN de la Res. 4.658
      // arts. 11-15). El proveedor por defecto de la fábrica es `openai`, así que sin esta
      // guarda un despliegue que solo encendiera el worker transferiría datos al exterior
      // sin que nadie hubiera decidido hacerlo. `transformer` corre dentro del perímetro y
      // no la necesita.
      if (
        value.SEMANTIC_ANALYSIS_WORKER_ENABLED &&
        value.SEMANTIC_ANALYSIS_PROVIDER !== 'transformer' &&
        !value.SEMANTIC_ALLOW_INTERNATIONAL_TRANSFER
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['SEMANTIC_ALLOW_INTERNATIONAL_TRANSFER'],
          message:
            'El worker semántico con un proveedor alojado envía el texto analizado fuera del ' +
            'país. Declara SEMANTIC_ALLOW_INTERNATIONAL_TRANSFER=true una vez cubiertas las ' +
            'obligaciones de transferencia internacional, o usa SEMANTIC_ANALYSIS_PROVIDER=' +
            'transformer, que se ejecuta dentro del perímetro.',
        });
      }
      if (value.SCRIPT_NODES_ENABLED && value.SCRIPT_RUNNER_MODE !== 'SIDECAR') {
        ctx.addIssue({
          code: 'custom',
          path: ['SCRIPT_NODES_ENABLED'],
          message:
            'The in-process script runner is not an OS security boundary and cannot be enabled in production. Set SCRIPT_RUNNER_MODE=SIDECAR and deploy the isolated runner container.',
        });
      }
      if (value.REQUIRE_REDIS_IN_PRODUCTION && !value.REDIS_URL) {
        ctx.addIssue({
          code: 'custom',
          path: ['REDIS_URL'],
          message: 'Redis is required in production',
        });
      }
      if (value.METRICS_ENABLED && !value.METRICS_TOKEN) {
        ctx.addIssue({
          code: 'custom',
          path: ['METRICS_TOKEN'],
          message: 'A metrics token is required in production',
        });
      }
      if (value.AUTH_MODE === 'API_KEY') {
        ctx.addIssue({
          code: 'custom',
          path: ['AUTH_MODE'],
          message: 'Production must use JWT, HYBRID or identity provider authentication',
        });
      }
      if (value.JWT_JWKS_URL && !value.JWT_JWKS_URL.startsWith('https://')) {
        ctx.addIssue({
          code: 'custom',
          path: ['JWT_JWKS_URL'],
          message: 'JWKS URL must use HTTPS in production',
        });
      }
      if (value.IDENTITY_PROVIDER_URL && !value.IDENTITY_PROVIDER_URL.startsWith('https://')) {
        ctx.addIssue({
          code: 'custom',
          path: ['IDENTITY_PROVIDER_URL'],
          message: 'Identity provider URL must use HTTPS in production',
        });
      }
      if (value.VARIABLE_BACKEND_URL && !value.VARIABLE_BACKEND_URL.startsWith('https://')) {
        ctx.addIssue({
          code: 'custom',
          path: ['VARIABLE_BACKEND_URL'],
          message: 'Variable backend URL must use HTTPS in production',
        });
      }
      if (value.SWAGGER_ENABLED) {
        ctx.addIssue({
          code: 'custom',
          path: ['SWAGGER_ENABLED'],
          message: 'Swagger must be disabled in production',
        });
      }
      if (value.LOG_LEVEL === 'debug' || value.LOG_LEVEL === 'verbose') {
        ctx.addIssue({
          code: 'custom',
          path: ['LOG_LEVEL'],
          message: 'LOG_LEVEL must not be debug or verbose in production',
        });
      }
      const forbiddenExamplePrefixes: Array<[keyof AppEnv, string]> = [
        ['MANAGEMENT_API_KEY', 'change-me-management'],
        ['RUNTIME_API_KEY', 'change-me-runtime'],
        ['AUDIT_HASH_SECRET', 'replace-with-a-long-random-secret'],
        ['METRICS_TOKEN', 'change-me-metrics-token'],
      ];
      for (const [key, examplePrefix] of forbiddenExamplePrefixes) {
        const configured = value[key];
        if (typeof configured === 'string' && configured.startsWith(examplePrefix)) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: `${key} cannot use an example value in production`,
          });
        }
      }
    }
  });

export type AppEnv = z.infer<typeof envSchema>;

/** Parses, normalizes and validates the complete application environment. */
export function validateEnvironment(input: Record<string, unknown>): AppEnv {
  return envSchema.parse(input);
}
