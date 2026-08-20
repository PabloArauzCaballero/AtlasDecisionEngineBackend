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
    /*
     * Login gets its own, longer budget because it does more work than a read: it hashes the
     * password and, with the second factor on, issues a PIN and hands it to the mail channel.
     * Measured against the local provider, that takes ~4,7 s — above the 3 s used for every
     * other call — so login timed out on the caller's side while the provider was finishing
     * the job. What the operator saw was two PIN mails, the first one already dead.
     */
    IDENTITY_PROVIDER_LOGIN_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(30_000)
      .default(12_000),
    // Retries only for transient failures (connection refused / 502-503-504), never for a
    // rejected credential and never for a timeout, which does not prove the request failed to
    // arrive. Shields login from the brief window where the provider dev server is restarting
    // (build-and-watch). 0 disables retries.
    IDENTITY_PROVIDER_RETRY_ATTEMPTS: z.coerce.number().int().min(0).max(5).default(2),
    IDENTITY_PROVIDER_RETRY_BACKOFF_MS: z.coerce.number().int().min(0).max(5_000).default(300),
    /*
     * How long a verified access token is trusted without asking the provider again.
     *
     * Every protected request used to call `/internal/auth/me`, so one screen that
     * fires a dozen requests fired a dozen validations. Under any real burst — the
     * portal classifying a bank statement, a route sweep — the provider hit its
     * timeout and the engine answered 503 on random requests, which the portal
     * showed as features failing for no reason.
     *
     * The window is deliberately small because it is also the revocation lag: a
     * disabled account, or a role that was taken away, keeps working for at most
     * this long. Ten seconds removes the stampede while keeping that lag shorter
     * than a person can act on. 0 disables the cache and restores per-request
     * validation.
     */
    /*
     * Umbrales de la bandeja de valores sin clasificar (ADR de clasificación
     * no resuelta). No se fijan en el código porque «suficiente confianza»
     * depende de lo que cueste equivocarse, y eso lo decide quien opera el
     * motor: en una cartera de consumo un 0,85 puede bastar; en una de crédito
     * corporativo, no.
     *
     * Por encima de HIGH el motor PODRIA resolver solo, y sólo si
     * AUTO_RESOLVE_ENABLED lo permite: la política por defecto es que no, porque
     * clasificar sin que nadie lo mire es justo lo que este mecanismo evita.
     * Entre MEDIUM y HIGH se muestra la recomendación; por debajo se pide
     * clasificación manual.
     */
    UNRESOLVED_HIGH_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.9),
    UNRESOLVED_MEDIUM_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.6),
    /*
     * Confianza mínima para que la REEVALUACIÓN cierre un pendiente sin que nadie
     * mire. Por debajo de HIGH a propósito: una decisión por regla de instrumento
     * —traspaso, QR, retiro de efectivo— es determinista y no necesita el listón
     * que se le pide a una similitud. Los cajones «Otros» no se cierran nunca,
     * sea cual sea este valor: son justo los que necesitan a una persona.
     */
    UNRESOLVED_AUTO_CLOSE_FLOOR: z.coerce.number().min(0).max(1).default(0.75),
    UNRESOLVED_AUTO_RESOLVE_ENABLED: booleanFromString.default(false),
    IDENTITY_PROVIDER_CACHE_TTL_SECONDS: z.coerce.number().int().min(0).max(300).default(10),
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

    /*
     * Las dos garantías de que una glosa no se quede sin categoría. Encendidas
     * por defecto; se apagan sólo para medir al modelo por su cuenta.
     */
    SEMANTIC_ANALYSIS_RULE_FAST_PATH_ENABLED: booleanFromString.default(true),
    SEMANTIC_ANALYSIS_TIMEOUT_RESCUE_ENABLED: booleanFromString.default(true),
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
    /*
     * Techo de una verificación de identidad invocada DESDE UN NODO de decisión.
     *
     * Holgado a propósito: el worker lee el documento, detecta dos rostros y los
     * compara, todo en el mismo proceso. Un tope corto convertiría un teléfono
     * lento en un rechazo. No gobierna la cola —esa tiene su propio lease
     * (`IDENTITY_LEASE_SECONDS`)—, sólo la llamada en línea.
     */
    IDENTITY_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(600_000).default(90_000),
    /*
     * Las TRES fronteras del triage, configurables porque son lo primero que hay
     * que recalibrar con documentos reales y hacerlo no puede exigir recompilar.
     * Están aquí y no en un componente del portal a propósito: una regla de
     * negocio escrita en el frontend no gobierna a quien llama la API sin pasar
     * por él, que es cualquiera con credencial.
     *
     * Las dos primeras miden si el documento ES un extracto: desde ACCEPT se
     * procesa, desde REVIEW se pregunta a una persona, y por debajo se rechaza.
     * `normalizeThresholds` ordena el par, así que un ACCEPT por debajo del
     * REVIEW no abre una franja vacía en silencio.
     */
    BANK_STATEMENT_DOCUMENT_ACCEPT_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.55),
    BANK_STATEMENT_DOCUMENT_REVIEW_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.3),
    /*
     * La tercera mide la EXTRACCIÓN, no la clasificación, y por eso es otra
     * frontera: 0.5 es donde la banda publicada pasa a `NO_CONFIABLE`. Entre 0.5
     * y 0.75 el resultado se entrega con advertencias —hay dato y se dice que
     * mirarlo—; por debajo no hay nada utilizable que entregar y la única salida
     * honesta es una persona.
     */
    BANK_STATEMENT_REVIEW_EXTRACTION_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.5),
    /*
     * La cuarta no es un umbral: es una EXIGENCIA sobre quién emitió el
     * documento. Con `true`, un extracto que no se atribuye a ninguna entidad
     * con licencia de ASFI no se procesa —se rechaza si además no queda ninguna
     * señal financiera en la carátula, o se manda a una persona si queda alguna—.
     *
     * Existe el `false` porque encender una exigencia nueva sobre un motor en
     * marcha rechaza documentos que ayer pasaban, y esa decisión es de quien
     * opera el sistema. En modo de medición la compuerta sigue evaluando y
     * dejando constancia del veredicto real: se puede ver cuánto rechazaría
     * antes de dejar que rechace.
     */
    BANK_STATEMENT_REQUIRE_LICENSED_ISSUER: booleanFromString.default(true),
    /*
     * Cuánto puede esperar un documento en la cola antes de derivarse solo.
     * Cubre el caso que el presupuesto de procesamiento no ve: el worker apagado
     * o saturado, donde nadie llega a empezar el trabajo y por tanto ningún reloj
     * de procesamiento corre. Sin esto, «tarda mucho» y «no lo va a tomar nadie»
     * se ven igual desde la pantalla: en cola, para siempre.
     */
    BANK_STATEMENT_QUEUE_WAIT_BUDGET_MS: z.coerce
      .number()
      .int()
      .min(10_000)
      .max(3_600_000)
      .default(180_000),

    // --- Worker C: verificación de identidad (ADR-0026) ---------------------
    IDENTITY_VERIFICATION_WORKER_ENABLED: booleanFromString.default(false),
    IDENTITY_WORKER_POLL_MS: z.coerce.number().int().min(50).max(10_000).default(500),
    IDENTITY_WORKER_MAX_POLL_MS: z.coerce.number().int().min(500).max(600_000).default(30_000),
    IDENTITY_RECOVERY_INTERVAL_MS: z.coerce.number().int().min(1_000).max(600_000).default(30_000),
    // Cada job carga tres imágenes en memoria y las remuestrea con `sharp`, que
    // reserva su propio búfer: la misma cota que el worker de extractos.
    IDENTITY_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),
    IDENTITY_LEASE_SECONDS: z.coerce.number().int().min(30).max(3_600).default(300),
    IDENTITY_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
    // Por IMAGEN, no por petición: 10 MiB es lo que pesa una foto de un móvil
    // moderno sin recortar.
    IDENTITY_MAX_UPLOAD_BYTES: z.coerce
      .number()
      .int()
      .min(1_024)
      .max(52_428_800)
      .default(10_485_760),
    IDENTITY_DEFAULT_DOCUMENT_COUNTRY: z.string().length(2).default('BO'),

    /*
     * La puerta de documentos del worker de identidad.
     *
     * `IDENTITY_ACCEPTED_DOCUMENT_TYPES` es la lista, separada por comas, de lo
     * que este despliegue admite. Por omisión sólo el carnet boliviano: es el
     * único con analizador verificado, y abrir la puerta a un pasaporte sin su
     * analizador no lo verifica mejor, sólo lo acepta peor.
     *
     * Las dos confianzas separan rechazar de preguntar. Se recalibran con
     * documentos reales y son lo primero que hay que mover al abrir el flujo a
     * otro país.
     *
     * `IDENTITY_ARBITRATION_MODE` elige QUIÉN resuelve la franja de duda. Hoy
     * `HUMAN`, que la manda a la bandeja del portal; `AI` queda declarado para
     * que enchufar un modelo sea cambiar esta variable.
     */
    IDENTITY_ACCEPTED_DOCUMENT_TYPES: z.string().default('BOLIVIA_CI'),
    IDENTITY_DOCUMENT_ACCEPT_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.55),
    IDENTITY_DOCUMENT_REVIEW_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.25),
    IDENTITY_ARBITRATION_MODE: z.enum(['HUMAN', 'AI']).default('HUMAN'),
    /*
     * Umbrales de la comparación biométrica. **Sin valor por omisión y
     * acoplados**: o se configuran los dos, o el motor de decisión devuelve
     * `REVIEW_REQUIRED` con `THRESHOLD_PROFILE_MISSING`.
     *
     * Es la decisión del paquete original y se conserva tal cual. Un umbral por
     * omisión decidiría sobre la identidad de una persona con una cifra que
     * nadie midió contra un corpus etiquetado, y lo haría en silencio; que haya
     * que declararlos —junto al nombre del perfil del que salieron— convierte
     * esa calibración en algo que alguien firmó.
     */
    IDENTITY_MATCH_THRESHOLD: z.coerce.number().min(0).max(1).optional(),
    IDENTITY_REVIEW_THRESHOLD: z.coerce.number().min(0).max(1).optional(),
    IDENTITY_THRESHOLD_PROFILE_VERSION: z.string().min(1).max(128).default('unconfigured'),
    IDENTITY_MIN_DOCUMENT_QUALITY: z.coerce.number().min(0).max(1).default(0.5),
    IDENTITY_MIN_SELFIE_QUALITY: z.coerce.number().min(0).max(1).default(0.5),
    IDENTITY_MIN_FACE_AREA_RATIO: z.coerce.number().min(0.002).max(0.8).default(0.012),
    IDENTITY_DOCUMENT_EXPIRY_GRACE_DAYS: z.coerce.number().int().min(0).max(365).default(0),
    IDENTITY_MAX_IMAGE_PIXELS: z.coerce
      .number()
      .int()
      .positive()
      .max(80_000_000)
      .default(25_000_000),
    IDENTITY_MIN_IMAGE_WIDTH: z.coerce.number().int().min(160).max(10_000).default(480),
    IDENTITY_MIN_IMAGE_HEIGHT: z.coerce.number().int().min(120).max(10_000).default(480),
    IDENTITY_MIN_IMAGE_PIXELS: z.coerce.number().int().min(10_000).max(20_000_000).default(230_400),
    /*
     * El suelo por debajo del cual no se intenta leer, POR EJE.
     *
     * Los tres de arriba sólo emiten el aviso `LOW_RESOLUTION`; éstos son los
     * que rechazan. Van por eje largo y eje corto —y no como `WIDTH`/`HEIGHT`—
     * porque una cédula es apaisada: pedirle el mismo mínimo a lo alto que a lo
     * ancho exige de hecho un ancho mucho mayor del que hace falta. Los valores
     * salen de medir dónde deja de leerse algo, no de una estimación:
     * `scripts/medir-resolucion-identidad.ts`.
     */
    IDENTITY_MIN_READABLE_LONG_EDGE: z.coerce.number().int().min(120).max(4_000).default(240),
    IDENTITY_MIN_READABLE_SHORT_EDGE: z.coerce.number().int().min(80).max(4_000).default(150),
    IDENTITY_FACE_CROP_PADDING_RATIO: z.coerce.number().min(0).max(1).default(0.25),
    IDENTITY_MIN_DOCUMENT_FACE_PX: z.coerce.number().int().min(40).max(2_000).default(80),
    IDENTITY_LIVENESS_ENABLED: booleanFromString.default(true),
    /*
     * Cortes de la prueba de vida, sobre el mínimo de las dos redes.
     *
     * Por encima de PASS se da por superada; por debajo de FAIL se rechaza; en
     * medio queda NO CONCLUYENTE, que el motor de decisión trata como aviso y
     * manda a revisión humana. La franja del medio existe a propósito: una
     * prueba pasiva sobre una imagen fija acierta mucho y no siempre, y forzarla
     * a un sí o un no convertiría cada duda en un rechazo silencioso.
     */
    IDENTITY_LIVENESS_PASS_SCORE: z.coerce.number().min(0).max(1).default(0.55),
    IDENTITY_LIVENESS_FAIL_SCORE: z.coerce.number().min(0).max(1).default(0.35),
    /*
     * Aceptación EXPLÍCITA del riesgo de no tener prueba de vida.
     *
     * Sin ella, una foto impresa del documento junto a una foto impresa de su
     * titular pasa una comparación 1:1. Que apagarla en producción obligue a
     * declarar esto convierte un descuido de configuración en una decisión que
     * alguien firma. Se conserva del paquete original.
     */
    IDENTITY_ACCEPT_NO_LIVENESS_RISK: booleanFromString.default(false),
    IDENTITY_DOCUMENT_CLASSIFICATION_ENABLED: booleanFromString.default(true),
    /*
     * Proveedores. Los tres son REALES y los tres corren en esta máquina.
     *
     * La LECTURA del documento es Tesseract sobre WebAssembly, con los datos del
     * idioma como paquete de npm. La BIOMETRÍA —detección, descriptor de 1024
     * dimensiones para comparar 1:1, antispoof y prueba de vida— es
     * `@vladmandic/human`, que trae sus cinco redes dentro del paquete y también
     * se ejecuta sobre WebAssembly.
     *
     * Ninguno necesita credenciales, ninguno sale a la red y ninguno cobra por
     * verificación. Eso es lo que hace que se pueda desplegar igual aquí y en el
     * servidor: no hay un proveedor externo del que dependa el servicio ni una
     * factura que crezca con el uso.
     *
     * Ya NO hay opción simulada. La había, y era el motivo de que un
     * «VERIFICADO» sólo pudiera afirmar que se había leído un documento válido:
     * el comparador devolvía una cifra fija elegida por el nombre del escenario.
     * Quitarla del enum es lo que impide que vuelva por una variable de entorno.
     */
    IDENTITY_OCR_PROVIDER: z.enum(['tesseract']).default('tesseract'),
    IDENTITY_FACE_PROVIDER: z.enum(['human']).default('human'),
    IDENTITY_LIVENESS_PROVIDER: z.enum(['disabled', 'human']).default('human'),

    // --- Worker D: locución (ADR-0026) --------------------------------------
    //
    // El único de los cuatro que puede COSTAR DINERO por ejecución, y eso marca
    // casi todas las variables que siguen: hay un presupuesto mensual, un techo
    // por persona y día, y una puerta aparte para permitir generar bajo demanda.
    AUDIO_TTS_WORKER_ENABLED: booleanFromString.default(false),
    /*
     * `disabled` ⇒ el worker no se declara disponible aunque esté encendido.
     * Mismo trato que `SEMANTIC_ANALYSIS_PROVIDER`: es preferible una pantalla
     * que lo explica a una cola de errores.
     *
     * `fake` sintetiza un MP3 determinista sin salir a la red y sin coste. Sirve
     * para recorrer la pantalla y para las pruebas; está PROHIBIDO en producción
     * más abajo, porque un audio de prueba servido a una persona real es peor
     * que no servir ninguno.
     */
    AUDIO_TTS_PROVIDER: z.enum(['disabled', 'fake', 'elevenlabs']).default('disabled'),
    /*
     * Permiso para generar audio NUEVO durante la operación.
     *
     * Apagado, el worker sólo sirve lo que ya está en caché. No es lo mismo que
     * apagar el worker: un despliegue puede querer servir su catálogo ya
     * locutado sin que nadie pueda encargar síntesis nuevas —y por tanto sin
     * que nadie pueda gastar—.
     */
    AUDIO_TTS_ALLOW_RUNTIME_GENERATION: booleanFromString.default(false),
    /*
     * Confirmación EXPLÍCITA de que hay licencia de uso de la voz en producción.
     *
     * Se conserva del paquete original y por su mismo motivo: la voz sintética
     * de un proveedor se licencia, y usarla en producción sin haberlo mirado es
     * una decisión legal que nadie debe tomar heredando un valor por omisión.
     */
    AUDIO_TTS_PROD_LICENSE_CONFIRMED: booleanFromString.default(false),

    AUDIO_TTS_DEFAULT_LANGUAGE: z.string().min(2).max(20).default('es-419'),
    AUDIO_TTS_DEFAULT_FORMAT: z.string().min(3).max(64).default('mp3_44100_128'),
    AUDIO_TTS_SAMPLE_RATE: z.coerce.number().int().min(8_000).max(192_000).default(44_100),
    AUDIO_TTS_VOICE_PROFILE: z.string().min(1).max(100).default('brand_es_latam_v1'),
    AUDIO_TTS_VOICE_VERSION: z.coerce.number().int().min(1).max(100_000).default(1),
    AUDIO_TTS_MODEL: z.string().min(1).max(128).default('eleven_v3'),
    AUDIO_TTS_GLOBAL_FALLBACK_TEMPLATE: z
      .string()
      .min(1)
      .max(160)
      .default('onboarding.fallback.generic'),
    AUDIO_TTS_MAX_TEXT_LENGTH: z.coerce.number().int().min(16).max(20_000).default(5_000),

    // Presupuesto. Un 0 en el límite por actor significa BLOQUEADO, no
    // ilimitado: un valor por omisión inseguro nunca debe abrir la puerta.
    AUDIO_TTS_MONTHLY_BUDGET_UNITS: z.coerce
      .number()
      .int()
      .min(0)
      .max(1_000_000_000)
      .default(10_000),
    AUDIO_TTS_SAFETY_RESERVE_UNITS: z.coerce
      .number()
      .int()
      .min(0)
      .max(1_000_000_000)
      .default(1_000),
    AUDIO_TTS_RUNTIME_GENERATIONS_PER_ACTOR_DAY: z.coerce
      .number()
      .int()
      .min(0)
      .max(10_000)
      .default(3),
    AUDIO_TTS_ACTOR_LIMIT_UNLIMITED: booleanFromString.default(false),

    // Red y resiliencia frente al proveedor.
    AUDIO_TTS_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(10_000),
    AUDIO_TTS_MAX_RESPONSE_BYTES: z.coerce
      .number()
      .int()
      .min(1_024)
      .max(268_435_456)
      .default(10_485_760),
    AUDIO_TTS_MIN_RESPONSE_BYTES: z.coerce.number().int().min(16).max(1_048_576).default(256),
    AUDIO_TTS_HTTP_MAX_RETRIES: z.coerce.number().int().min(0).max(2).default(0),
    AUDIO_TTS_RETRY_BASE_MS: z.coerce.number().int().min(100).max(10_000).default(500),
    AUDIO_TTS_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(2),
    AUDIO_TTS_MAX_REQUESTS_PER_SECOND: z.coerce.number().positive().max(100).default(2),
    AUDIO_TTS_REPLICA_COUNT: z.coerce.number().int().min(1).max(512).default(1),
    AUDIO_TTS_BULKHEAD_QUEUE_SIZE: z.coerce.number().int().min(0).max(1_024).default(16),
    AUDIO_TTS_BULKHEAD_WAIT_MS: z.coerce.number().int().min(0).max(120_000).default(15_000),
    AUDIO_TTS_CB_FAILURE_THRESHOLD: z.coerce.number().int().min(2).max(50).default(5),
    AUDIO_TTS_CB_OPEN_MS: z.coerce.number().int().min(1_000).max(300_000).default(30_000),

    /*
     * Cifrado del texto locutado. El texto lleva dentro las variables —el nombre
     * de una persona en la plantilla dinámica— y su única copia vive en la
     * caché, así que se guarda cifrado con AES-256-GCM. Vacío sólo se tolera con
     * el worker apagado; ver la comprobación cruzada.
     */
    AUDIO_TTS_DATA_KEY: z.string().default(''),
    AUDIO_TTS_DATA_KEY_ID: z
      .string()
      .min(1)
      .max(32)
      .regex(/^[a-z0-9_-]+$/u)
      .default('k1'),
    /** `id:secreto[,id:secreto]` — claves anteriores, para descifrar durante una rotación. */
    AUDIO_TTS_DATA_KEYS_PREVIOUS: z.string().default(''),

    ELEVENLABS_API_KEY: z.string().default(''),
    ELEVENLABS_BASE_URL: z.string().url().default('https://api.elevenlabs.io'),
    ELEVENLABS_VOICE_ID: z.string().default(''),
    ELEVENLABS_MODEL_ID: z.string().default(''),
    ELEVENLABS_OUTPUT_FORMAT: z.string().default(''),
    /*
     * Los `voice_settings` del proveedor: CÓMO habla la voz elegida.
     *
     * Por omisión, los valores documentados por ElevenLabs. Cablear el control
     * no cambia por sorpresa cómo suena la marca; sólo permite cambiarlo, que
     * hasta ahora no se podía ni tocando el `.env`. `stability` es la palanca
     * contra la locución plana —bajarla da más entonación— y los cuatro entran
     * en la clave de caché, así que ajustarlos regenera el audio en vez de
     * seguir sirviendo el de antes.
     */
    ELEVENLABS_VOICE_STABILITY: z.coerce.number().min(0).max(1).default(0.5),
    ELEVENLABS_VOICE_SIMILARITY_BOOST: z.coerce.number().min(0).max(1).default(0.75),
    ELEVENLABS_VOICE_STYLE: z.coerce.number().min(0).max(1).default(0),
    ELEVENLABS_VOICE_SPEAKER_BOOST: booleanFromString.default(true),

    // Ciclo de vida del trabajo, con la misma forma que los otros tres workers.
    AUDIO_TTS_WORKER_POLL_MS: z.coerce.number().int().min(50).max(10_000).default(500),
    AUDIO_TTS_WORKER_MAX_POLL_MS: z.coerce.number().int().min(500).max(600_000).default(30_000),
    AUDIO_TTS_RECOVERY_INTERVAL_MS: z.coerce.number().int().min(1_000).max(600_000).default(30_000),
    // Más baja que la de los otros workers: lo que limita aquí no es la memoria
    // del motor sino las peticiones por segundo que admite el proveedor.
    AUDIO_TTS_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),
    AUDIO_TTS_LEASE_SECONDS: z.coerce.number().int().min(30).max(3_600).default(300),
    AUDIO_TTS_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),

    // `database` guarda los bytes en la propia base, como el resto de workers
    // guarda su carga útil; `local` es el adaptador de disco del paquete, para
    // desarrollo. El adaptador S3 del paquete no se absorbió.
    AUDIO_STORAGE_DRIVER: z.enum(['database', 'local']).default('database'),
    AUDIO_LOCAL_STORAGE_PATH: z.string().min(1).default('.local/audio-assets'),
    /*
     * Generar por SEGMENTOS cacheados: los tramos fijos de una plantilla se
     * pagan al proveedor una vez, y una frase nueva sólo paga sus variables.
     * Apagado por omisión porque tiene un precio de calidad —la prosodia de
     * las costuras del audio cosido— y aceptarlo es una decisión, no un valor
     * de serie.
     */
    AUDIO_SEGMENT_CACHE_ENABLED: booleanFromString.default(false),

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

    /*
     * Umbrales biométricos: coherentes en CUALQUIER entorno.
     *
     * Un par a medias no es una configuración incompleta, es una contradicción:
     * el motor de decisión sólo puede comparar si tiene los dos, y con uno
     * suelto se comporta como si no hubiera ninguno —toda verificación a
     * revisión— sin que el que lo configuró entienda por qué. Se falla al
     * arrancar, que es donde se puede leer el mensaje, y no en la primera
     * verificación.
     */
    const tieneMatch = value.IDENTITY_MATCH_THRESHOLD !== undefined;
    const tieneReview = value.IDENTITY_REVIEW_THRESHOLD !== undefined;
    if (tieneMatch !== tieneReview) {
      ctx.addIssue({
        code: 'custom',
        path: [tieneMatch ? 'IDENTITY_REVIEW_THRESHOLD' : 'IDENTITY_MATCH_THRESHOLD'],
        message:
          'IDENTITY_MATCH_THRESHOLD e IDENTITY_REVIEW_THRESHOLD se configuran juntos o no se ' +
          'configura ninguno: con uno suelto el motor de decisión no puede decidir y manda ' +
          'todo a revisión manual.',
      });
    }
    if (
      tieneMatch &&
      tieneReview &&
      value.IDENTITY_REVIEW_THRESHOLD! >= value.IDENTITY_MATCH_THRESHOLD!
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['IDENTITY_REVIEW_THRESHOLD'],
        message:
          'IDENTITY_REVIEW_THRESHOLD tiene que ser MENOR que IDENTITY_MATCH_THRESHOLD: entre ' +
          'los dos está la franja ambigua que se manda a una persona, y al revés esa franja ' +
          'no existe.',
      });
    }
    /*
     * Los dos cortes de la prueba de vida, en el orden que tiene sentido.
     *
     * Al revés —fallar por encima de aprobar— no deja franja de duda: deja una
     * banda donde el mismo resultado supera Y falla a la vez, y gana el que se
     * evalúe primero. Es el mismo razonamiento que el par de umbrales de arriba.
     */
    if (value.IDENTITY_LIVENESS_FAIL_SCORE >= value.IDENTITY_LIVENESS_PASS_SCORE) {
      ctx.addIssue({
        code: 'custom',
        path: ['IDENTITY_LIVENESS_FAIL_SCORE'],
        message:
          'IDENTITY_LIVENESS_FAIL_SCORE tiene que ser MENOR que IDENTITY_LIVENESS_PASS_SCORE: ' +
          'entre los dos queda la franja no concluyente que se manda a una persona.',
      });
    }
    // Encender la prueba de vida y dejar el proveedor en `disabled` es pedir una
    // comprobación y a la vez apagarla; el resultado sería `NOT_RUN` para siempre.
    if (value.IDENTITY_LIVENESS_ENABLED && value.IDENTITY_LIVENESS_PROVIDER === 'disabled') {
      ctx.addIssue({
        code: 'custom',
        path: ['IDENTITY_LIVENESS_PROVIDER'],
        message:
          'IDENTITY_LIVENESS_PROVIDER no puede ser «disabled» con IDENTITY_LIVENESS_ENABLED=true.',
      });
    }

    /*
     * Locución: coherencia que vale en TODOS los entornos.
     *
     * Estas cuatro vienen del esquema del paquete original y se conservan
     * porque describen combinaciones que no funcionan, no políticas: con ellas
     * mal puestas el worker arranca y falla en cada locución, que es la peor
     * forma de descubrirlo.
     */
    if (value.AUDIO_TTS_WORKER_ENABLED) {
      if (value.AUDIO_TTS_PROVIDER === 'elevenlabs' && !value.ELEVENLABS_API_KEY) {
        ctx.addIssue({
          code: 'custom',
          path: ['ELEVENLABS_API_KEY'],
          message: 'ELEVENLABS_API_KEY es obligatoria con AUDIO_TTS_PROVIDER=elevenlabs.',
        });
      }
      if (value.AUDIO_TTS_PROVIDER === 'elevenlabs' && !value.ELEVENLABS_VOICE_ID) {
        ctx.addIssue({
          code: 'custom',
          path: ['ELEVENLABS_VOICE_ID'],
          message:
            'ELEVENLABS_VOICE_ID es obligatoria con AUDIO_TTS_PROVIDER=elevenlabs: la voz ' +
            'forma parte de la identidad del audio, no es un valor por omisión.',
        });
      }
      /*
       * La clave de cifrado se exige en cuanto el worker está encendido, salvo
       * en pruebas. No es ceremonia: el texto locutado lleva dentro las
       * variables —el nombre de una persona— y su única copia vive en la caché.
       * Sin clave no hay dónde guardarlo cifrado.
       */
      if (value.NODE_ENV !== 'test' && value.AUDIO_TTS_DATA_KEY.length < 32) {
        ctx.addIssue({
          code: 'custom',
          path: ['AUDIO_TTS_DATA_KEY'],
          message:
            'AUDIO_TTS_DATA_KEY debe tener al menos 32 caracteres con el worker de locución ' +
            'encendido: cifra el texto que se pone en boca de la marca, que lleva dentro las ' +
            'variables de cada locución.',
        });
      }
    }
    /*
     * El arrendamiento tiene que sobrevivir a la petición más lenta al
     * proveedor. Si no, otra réplica recupera el trabajo mientras el primero
     * todavía está esperando el audio, y se paga dos veces por la misma frase.
     */
    if (value.AUDIO_TTS_LEASE_SECONDS * 1_000 <= value.AUDIO_TTS_REQUEST_TIMEOUT_MS) {
      ctx.addIssue({
        code: 'custom',
        path: ['AUDIO_TTS_LEASE_SECONDS'],
        message:
          'AUDIO_TTS_LEASE_SECONDS debe superar AUDIO_TTS_REQUEST_TIMEOUT_MS: un arrendamiento ' +
          'más corto que la petición al proveedor deja que otra réplica pague la misma locución.',
      });
    }
    if (value.AUDIO_TTS_SAFETY_RESERVE_UNITS > value.AUDIO_TTS_MONTHLY_BUDGET_UNITS) {
      ctx.addIssue({
        code: 'custom',
        path: ['AUDIO_TTS_SAFETY_RESERVE_UNITS'],
        message:
          'AUDIO_TTS_SAFETY_RESERVE_UNITS no puede superar AUDIO_TTS_MONTHLY_BUDGET_UNITS: ' +
          'dejaría el presupuesto utilizable en cero y ninguna locución llegaría a generarse.',
      });
    }
    if (value.AUDIO_TTS_MIN_RESPONSE_BYTES >= value.AUDIO_TTS_MAX_RESPONSE_BYTES) {
      ctx.addIssue({
        code: 'custom',
        path: ['AUDIO_TTS_MIN_RESPONSE_BYTES'],
        message: 'AUDIO_TTS_MIN_RESPONSE_BYTES debe ser menor que AUDIO_TTS_MAX_RESPONSE_BYTES.',
      });
    }

    if (value.NODE_ENV === 'production') {
      /*
       * Locución: lo que NO puede salir a producción.
       *
       * Las tres se conservan del paquete original. Un audio de prueba servido
       * a una persona real es peor que no servir ninguno; un directorio en
       * disco dentro de un contenedor se va con el contenedor y se lleva la
       * caché entera; y la licencia de uso de una voz sintética es una decisión
       * legal que nadie debe tomar heredando un valor por omisión.
       */
      if (value.AUDIO_TTS_WORKER_ENABLED) {
        if (value.AUDIO_TTS_PROVIDER === 'fake') {
          ctx.addIssue({
            code: 'custom',
            path: ['AUDIO_TTS_PROVIDER'],
            message:
              'AUDIO_TTS_PROVIDER=fake está prohibido en producción: sintetiza un audio ' +
              'determinista que no es una voz, y quien lo escuche creerá que sí lo es.',
          });
        }
        if (!value.AUDIO_TTS_PROD_LICENSE_CONFIRMED) {
          ctx.addIssue({
            code: 'custom',
            path: ['AUDIO_TTS_PROD_LICENSE_CONFIRMED'],
            message:
              'Declara AUDIO_TTS_PROD_LICENSE_CONFIRMED=true para usar la voz del proveedor en ' +
              'producción. Es la confirmación de que alguien miró la licencia.',
          });
        }
        if (value.AUDIO_STORAGE_DRIVER === 'local') {
          ctx.addIssue({
            code: 'custom',
            path: ['AUDIO_STORAGE_DRIVER'],
            message:
              'AUDIO_STORAGE_DRIVER=local guarda el audio en el disco del contenedor y se va ' +
              'con él: la caché entera se perdería y habría que volver a pagarla. Usa ' +
              '«database» en producción.',
          });
        }
      }

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
      /*
       * Verificación de identidad: lo que NO puede salir a producción.
       *
       * Estas cuatro guardas vienen del paquete original y se perdieron al
       * absorberlo; sin ellas, un despliegue que sólo encendiera el worker
       * decidiría sobre la identidad de personas reales con un comparador
       * sintético y sin que nadie lo hubiera decidido. El worker apagado no las
       * dispara: son el precio de encenderlo, no del despliegue.
       */
      if (value.IDENTITY_VERIFICATION_WORKER_ENABLED) {
        /*
         * Un perfil calibrado sobre rostros SINTÉTICOS no vale para personas.
         *
         * El comparador ya es real, así que la pregunta dejó de ser «¿mira las
         * imágenes?» y pasó a ser «¿contra qué población se midió el corte?».
         * `scripts/calibrar-identidad.mjs` mide sobre la población dibujada que
         * vive en este repositorio y nombra el perfil `sintetico-…` justamente
         * para que se note: esos rostros no cubren el espacio de rasgos que
         * cubren las personas, y un umbral medido sobre ellos no predice la tasa
         * de falsas aceptaciones sobre caras de verdad.
         *
         * Sirve para demostrar el worker y para las pruebas. En producción hay
         * que recalibrar contra un corpus real —el mismo comando, apuntado a
         * otra carpeta— y el perfil pasará a llamarse de otra manera.
         */
        if (/^sintetico/i.test(value.IDENTITY_THRESHOLD_PROFILE_VERSION)) {
          ctx.addIssue({
            code: 'custom',
            path: ['IDENTITY_THRESHOLD_PROFILE_VERSION'],
            message:
              'El perfil de umbrales está calibrado sobre rostros sintéticos y no predice la ' +
              'tasa de falsas aceptaciones sobre personas reales. Recalibra contra un corpus ' +
              'real con `yarn calibrar:identidad <carpeta>` y usa el perfil que emita, o apaga ' +
              'IDENTITY_VERIFICATION_WORKER_ENABLED.',
          });
        }
        if (value.IDENTITY_THRESHOLD_PROFILE_VERSION === 'unconfigured') {
          ctx.addIssue({
            code: 'custom',
            path: ['IDENTITY_THRESHOLD_PROFILE_VERSION'],
            message:
              'IDENTITY_THRESHOLD_PROFILE_VERSION debe nombrar el perfil calibrado del que ' +
              'salen los umbrales. Sin él, el veredicto no dice contra qué se decidió y no ' +
              'hay forma de auditarlo después.',
          });
        }
        if (!value.IDENTITY_LIVENESS_ENABLED && !value.IDENTITY_ACCEPT_NO_LIVENESS_RISK) {
          ctx.addIssue({
            code: 'custom',
            path: ['IDENTITY_LIVENESS_ENABLED'],
            message:
              'Sin prueba de vida, una foto impresa del documento junto a una foto impresa ' +
              'de su titular pasa la comparación 1:1. Enciende IDENTITY_LIVENESS_ENABLED o, ' +
              'para aceptar ese riesgo a sabiendas, declara ' +
              'IDENTITY_ACCEPT_NO_LIVENESS_RISK=true y documenta la excepción.',
          });
        }
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
