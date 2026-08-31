<!-- GENERADO POR scripts/docs/generate-catalogs.mjs — NO EDITAR A MANO.
     Fuente: src/common/config/env.schema.ts. Ejecute `yarn docs:catalog` tras cambiar el código. -->

# Variables de entorno

267 variables declaradas. El esquema se valida al arrancar: un valor ausente o
fuera de rango impide el arranque en vez de degradar el comportamiento en caliente.

| Variable | Obligatoria | Valor por defecto | Para qué |
| --- | --- | --- | --- |
| `NODE_ENV` | no | `'development'` | — |
| `PORT` | no | `3000` | — |
| `BUILD_VERSION` | no | `'2.0.0'` | — |
| `COMMIT_SHA` | no | `'local'` | — |
| `API_VERSION` | **sí** | — | The published API contract version, deliberately separate from BUILD_VERSION: the build changes on every release, the contract only on a breaking change. Consumers pin to this. |
| `WORKER_ROLE` | no | `'ALL'` | Reparto de responsabilidades entre procesos; ver common/config/worker-role.ts. `ALL` conserva el comportamiento de un solo contenedor que sirve y procesa. |
| `WORKER_HEALTH_PORT` | no | `3001` | Puerto de sondas del proceso WORKER, que no sirve tráfico de negocio pero sí debe poder declararse vivo y listo ante el orquestador. También sirve `/metrics`. |
| `JOB_SCHEDULER_ENABLED` | no | `true` | --------------------------------------------------------------------- Orquestación central de trabajos de fondo (common/jobs).  El coste al ralentí del plano de fondo lo fijan estos valores, no cada trabajo por su cuenta: un lote vacío multiplica su espera por JOB_BACKOFF_FACTOR hasta JOB_MAX_IDLE_INTERVAL_MS, y el despertar por `pg_notify` la reinicia cuando de verdad hay algo. Subir el techo abarata el ralentí sin tocar la latencia MIENTRAS la señal funcione; con JOB_WAKE_ENABLED=false el techo pasa a ser la latencia del peor caso. --------------------------------------------------------------------- |
| `JOB_INITIAL_DELAY_MS` | no | `500` | — |
| `JOB_MIN_IDLE_INTERVAL_MS` | no | `1_000` | — |
| `JOB_MAX_IDLE_INTERVAL_MS` | no | `30_000` | — |
| `JOB_BACKOFF_FACTOR` | no | `2` | 1 desactiva el retroceso y deja una cadencia fija en el mínimo: solo tiene sentido para depurar, porque devuelve el coste plano que este mecanismo existe para eliminar. |
| `JOB_ERROR_INTERVAL_MS` | no | `5_000` | — |
| `JOB_MAX_ERROR_INTERVAL_MS` | no | `120_000` | — |
| `JOB_WAKE_ENABLED` | no | `true` | Despertar por LISTEN/NOTIFY. Desactívalo si la conexión pasa por un `pgbouncer` en modo transacción o statement, que no propaga las notificaciones: el sistema sigue siendo correcto, solo pierde latencia hasta el siguiente sondeo. |
| `JOB_WAKE_CHANNEL` | **sí** | — | — |
| `API_PUBLIC_URL` | no | — | URL pública desde la que los consumidores alcanzan esta API. Se publica en el contrato OpenAPI; sin ella solo se declara el servidor relativo, que es preferible a publicar la URL de otro ambiente y que un cliente generado apunte al sitio equivocado. |
| `DATABASE_URL` | **sí** | — | — |
| `DATABASE_POOL_MAX` | no | `15` | — |
| `DATABASE_CONNECTION_TIMEOUT_MS` | no | `5_000` | — |
| `DATABASE_IDLE_TIMEOUT_MS` | no | `30_000` | — |
| `DATABASE_STATEMENT_TIMEOUT_MS` | no | `30_000` | — |
| `DATABASE_WRITE_URL` | no | — | --------------------------------------------------------------------- Separación de rutas de datos (ADR-0029).  Vacías, las tres rutas son la misma conexión y el comportamiento es idéntico al anterior: DATABASE_URL sigue siendo la única variable obligatoria. Declarar DATABASE_READ_URL con el rol lector separa lectura y escritura por credencial; apuntarla a otro host la separa por servidor (réplica). El registro reutiliza el pool cuando las huellas coinciden, así que declarar la misma URL no duplica nada. --------------------------------------------------------------------- |
| `DATABASE_READ_URL` | no | — | — |
| `DATABASE_READ_POOL_MAX` | no | — | — |
| `DATA_READ_ROUTING_ENABLED` | no | `false` | — |
| `ENABLE_PRIMARY_READ_FALLBACK` | no | `true` | — |
| `DATA_ROUTING_RULES` | no | — | — |
| `REDIS_URL` | no | — | — |
| `REDIS_PREFIX` | **sí** | — | — |
| `REQUIRE_REDIS_IN_PRODUCTION` | no | `true` | — |
| `AUTH_MODE` | **sí** | — | — |
| `MANAGEMENT_API_KEY` | no | — | — |
| `RUNTIME_API_KEY` | no | — | — |
| `JWT_JWKS_URL` | no | — | — |
| `JWT_ISSUER` | no | — | — |
| `JWT_MANAGEMENT_AUDIENCE` | no | `'atlas-decision-management'` | — |
| `JWT_RUNTIME_AUDIENCE` | no | `'atlas-decision-runtime'` | — |
| `JWT_TENANT_CLAIM` | no | `'tenant_id'` | — |
| `JWT_ROLES_CLAIM` | no | `'roles'` | — |
| `JWT_JWKS_CACHE_SECONDS` | no | `900` | — |
| `JWT_JWKS_TIMEOUT_MS` | no | `3_000` | — |
| `JWT_CLOCK_SKEW_SECONDS` | no | `30` | — |
| `IDENTITY_PROVIDER_URL` | no | — | — |
| `IDENTITY_PROVIDER_TIMEOUT_MS` | no | `3_000` | — |
| `IDENTITY_PROVIDER_LOGIN_TIMEOUT_MS` | **sí** | — | — |
| `IDENTITY_PROVIDER_RETRY_ATTEMPTS` | no | `2` | Retries only for transient failures (connection refused / 502-503-504), never for a rejected credential and never for a timeout, which does not prove the request failed to arrive. Shields login from the brief window where the provider dev server is restarting (build-and-watch). 0 disables retries. |
| `IDENTITY_PROVIDER_RETRY_BACKOFF_MS` | no | `300` | — |
| `UNRESOLVED_HIGH_CONFIDENCE` | no | `0.9` | — |
| `UNRESOLVED_MEDIUM_CONFIDENCE` | no | `0.6` | — |
| `UNRESOLVED_AUTO_CLOSE_FLOOR` | no | `0.75` | — |
| `UNRESOLVED_AUTO_RESOLVE_ENABLED` | no | `false` | — |
| `IDENTITY_PROVIDER_CACHE_TTL_SECONDS` | no | `10` | — |
| `IDENTITY_REFRESH_COOKIE_NAME` | **sí** | — | — |
| `IDENTITY_REFRESH_COOKIE_MAX_AGE_SECONDS` | **sí** | — | — |
| `IDENTITY_SESSION_RATE_LIMIT` | no | `20` | — |
| `CORS_ALLOWED_ORIGINS` | no | `''` | — |
| `TRUST_PROXY_HOPS` | no | `1` | — |
| `BODY_LIMIT_BYTES` | no | `1_048_576` | — |
| `REQUEST_TIMEOUT_MS` | no | `15_000` | — |
| `SHUTDOWN_GRACE_MS` | no | `20_000` | Plazo total del apagado ordenado. El 80 % acota el drenaje de lotes en vuelo del orquestador de trabajos y el resto queda para cerrar los pools y vaciar las trazas; agotado el plazo, el proceso fuerza la salida. Debe quedar POR DEBAJO del terminationGracePeriodSeconds del orquestador: si lo supera, el SIGKILL llega antes que el vigilante y se pierde el motivo del apagado, que es justo lo que se quería salvar. |
| `RATE_LIMIT_ENABLED` | no | `true` | — |
| `RATE_LIMIT_WINDOW_SECONDS` | no | `60` | — |
| `RATE_LIMIT_MANAGEMENT_REQUESTS` | no | `300` | — |
| `RATE_LIMIT_RUNTIME_REQUESTS` | no | `1_500` | — |
| `AUTH_FAILURE_RATE_LIMIT` | no | `20` | — |
| `SWAGGER_ENABLED` | no | `false` | — |
| `METRICS_ENABLED` | no | `true` | — |
| `METRICS_TOKEN` | no | — | — |
| `LOG_LEVEL` | no | `'log'` | — |
| `LOG_OUTPUT` | no | `'stdout'` | Containers run with a read-only root filesystem, so writing a log file must be an explicit opt-in backed by a mounted volume. |
| `LOG_FILE_PATH` | no | `'logs/atlas-decision-engine.log'` | — |
| `ACCESS_AUDIT_ENABLED` | no | `true` | — |
| `ACCESS_AUDIT_QUEUE_MAX` | no | `1_000` | Authentication denials are buffered only long enough to bridge a transient database outage. Bounds prevent an attacker from turning the safety net into unbounded memory. |
| `ACCESS_AUDIT_RETRY_SECONDS` | no | `15` | — |
| `OTEL_ENABLED` | no | `false` | Distributed tracing. Read directly from process.env by observability/tracing.ts (it runs before the Nest container exists); declared here so the values are still validated and documented rather than being undeclared magic strings. |
| `OTEL_SERVICE_NAME` | no | `'atlas-decision-engine'` | — |
| `OTEL_SERVICE_NAMESPACE` | no | `'atlas'` | Agrupa API y worker bajo el mismo producto en el grafo de servicios de Jaeger. |
| `OTEL_SERVICE_VERSION` | no | — | Por defecto se toma BUILD_VERSION; esta variable sólo existe para despliegues que versionan la telemetría por separado del artefacto. |
| `OTEL_DEPLOYMENT_ENVIRONMENT` | no | — | — |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | no | — | — |
| `OTEL_EXPORT_TIMEOUT_MS` | no | `10_000` | — |
| `OTEL_TRACES_SAMPLER` | no | `'parentbased_traceidratio'` | Muestreo basado en el padre: se respeta la decisión de un servicio aguas arriba, porque media traza no sirve para nada. La proporción sólo gobierna las trazas que nacen aquí. |
| `OTEL_TRACES_SAMPLER_ARG` | no | `1` | — |
| `OTEL_PROPAGATORS` | no | `'tracecontext,baggage'` | — |
| `OTEL_DIAG_LOG_LEVEL` | **sí** | — | — |
| `VARIABLE_BACKEND_URL` | no | — | — |
| `VARIABLE_BACKEND_TIMEOUT_MS` | no | `1_500` | — |
| `AUDIT_HASH_SECRET` | **sí** | — | — |
| `AUDIT_HASH_KEY_ID` | **sí** | — | Identifies the active signing secret. Bump it together with AUDIT_HASH_SECRET when rotating, and move the old secret into AUDIT_HASH_PREVIOUS_SECRETS so historical events stay verifiable. |
| `AUDIT_HASH_PREVIOUS_SECRETS` | no | — | JSON object of {keyId: secret} for retired keys, verification only. |
| `DEFAULT_ENVIRONMENT` | **sí** | — | — |
| `MAX_EXECUTION_STEPS` | no | `256` | — |
| `TEST_RUN_WORKER_ENABLED` | no | `true` | El worker de corridas de prueba era el único trabajo de fondo sin interruptor: se arrancaba en todo proceso que cargara el módulo, incluidas las réplicas de API. |
| `TEST_RUN_WORKER_POLL_MS` | no | `500` | Suelo del sondeo. Con el despertar por señal activo, una corrida encolada arranca al commit y este valor solo gobierna la red de seguridad. |
| `TEST_RUN_WORKER_MAX_POLL_MS` | no | `30_000` | Techo del retroceso cuando la cola lleva rato vacía. |
| `TEST_RUN_RECOVERY_INTERVAL_MS` | no | `30_000` | Cada cuánto se buscan corridas con el lease vencido. Un lease dura TEST_RUN_LEASE_SECONDS, así que buscarlas más a menudo no puede encontrar nada nuevo. |
| `TEST_RUN_WORKER_CONCURRENCY` | no | `2` | — |
| `TEST_RUN_LEASE_SECONDS` | no | `300` | — |
| `TEST_CASE_CONCURRENCY` | no | `4` | — |
| `SEMANTIC_ANALYSIS_WORKER_ENABLED` | no | `false` | --- Workers adicionales (ADR-0026) ------------------------------------- Los dos vienen APAGADOS por defecto, al revés que los trabajos nativos: un despliegue que se actualice no debe empezar a consumir cuota de un proveedor de modelos ni a cargar `pdfjs-dist` sin que nadie lo haya pedido. |
| `SEMANTIC_ANALYSIS_WORKER_POLL_MS` | no | `500` | — |
| `SEMANTIC_ANALYSIS_WORKER_MAX_POLL_MS` | **sí** | — | — |
| `SEMANTIC_ANALYSIS_RECOVERY_INTERVAL_MS` | **sí** | — | — |
| `SEMANTIC_ANALYSIS_WORKER_CONCURRENCY` | no | `4` | — |
| `SEMANTIC_ANALYSIS_LEASE_SECONDS` | no | `120` | — |
| `SEMANTIC_ANALYSIS_MAX_ATTEMPTS` | no | `3` | Agotados los intentos la ejecución queda FAILED en vez de volver a la cola: reintentar sin cota convierte un fallo permanente en gasto perpetuo. |
| `SEMANTIC_ANALYSIS_MAX_TEXT_LENGTH` | no | `8_000` | — |
| `SEMANTIC_ANALYSIS_RULE_FAST_PATH_ENABLED` | no | `true` | — |
| `SEMANTIC_ANALYSIS_TIMEOUT_RESCUE_ENABLED` | no | `true` | — |
| `SEMANTIC_ANALYSIS_PROVIDER` | **sí** | — | — |
| `SEMANTIC_CASCADE_LOCAL_TIMEOUT_MS` | **sí** | — | — |
| `LITELLM_BASE_URL` | no | — | — |
| `LITELLM_API_KEY` | no | — | — |
| `LITELLM_FAST_MODEL` | no | — | — |
| `LITELLM_DEEP_MODEL` | no | — | — |
| `LITELLM_EMBEDDING_MODEL` | no | — | — |
| `LITELLM_TIMEOUT_MS` | **sí** | — | — |
| `LITELLM_MAX_ATTEMPTS` | no | — | — |
| `LITELLM_MAX_OUTPUT_TOKENS` | **sí** | — | — |
| `SEMANTIC_ALLOW_INTERNATIONAL_TRANSFER` | no | `false` | — |
| `SEMANTIC_ANALYSIS_BUDGET_WINDOW_SECONDS` | **sí** | — | — |
| `SEMANTIC_ANALYSIS_BUDGET_MAX_ANALYSES` | **sí** | — | — |
| `SEMANTIC_ANALYSIS_MINIMIZE_AFTER_DAYS` | no | `30` | --- Retención del texto analizado --- El texto que se clasifica se persiste íntegro para poder explicar la decisión, y en el caso de un proveedor alojado ya salió del perímetro una vez. Retenerlo indefinidamente añade una segunda copia permanente que nadie pidió, así que la barrida lo minimiza (lo sustituye por su huella) y más tarde purga la fila entera. |
| `SEMANTIC_ANALYSIS_AUDIT_RETENTION_DAYS` | no | `90` | — |
| `SEMANTIC_ANALYSIS_RETENTION_SWEEP_INTERVAL_MS` | **sí** | — | — |
| `BANK_STATEMENT_WORKER_ENABLED` | no | `false` | — |
| `BANK_STATEMENT_WORKER_POLL_MS` | no | `500` | — |
| `BANK_STATEMENT_WORKER_MAX_POLL_MS` | **sí** | — | — |
| `BANK_STATEMENT_RECOVERY_INTERVAL_MS` | **sí** | — | — |
| `BANK_STATEMENT_WORKER_CONCURRENCY` | no | `2` | Menor que la del semántico: cada job carga un PDF entero en memoria. |
| `BANK_STATEMENT_LEASE_SECONDS` | no | `300` | — |
| `BANK_STATEMENT_MAX_ATTEMPTS` | no | `3` | — |
| `BANK_STATEMENT_MAX_UPLOAD_BYTES` | **sí** | — | 10 MiB. Acota a la vez la memoria del worker y el tamaño de la fila, porque el documento se guarda en la propia base (ADR-0026). |
| `BANK_STATEMENT_TIMEOUT_MS` | no | `60_000` | Un PDF hostil puede hacer trabajar al lector indefinidamente. El presupuesto corta el job, no el proceso. |
| `IDENTITY_TIMEOUT_MS` | no | `90_000` | — |
| `BANK_STATEMENT_DOCUMENT_ACCEPT_CONFIDENCE` | no | `0.55` | — |
| `BANK_STATEMENT_DOCUMENT_REVIEW_CONFIDENCE` | no | `0.3` | — |
| `BANK_STATEMENT_REVIEW_EXTRACTION_CONFIDENCE` | no | `0.5` | — |
| `BANK_STATEMENT_REQUIRE_LICENSED_ISSUER` | no | `true` | — |
| `BANK_STATEMENT_QUEUE_WAIT_BUDGET_MS` | **sí** | — | — |
| `IDENTITY_VERIFICATION_WORKER_ENABLED` | no | `false` | --- Worker C: verificación de identidad (ADR-0026) --------------------- |
| `IDENTITY_WORKER_POLL_MS` | no | `500` | — |
| `IDENTITY_WORKER_MAX_POLL_MS` | no | `30_000` | — |
| `IDENTITY_RECOVERY_INTERVAL_MS` | no | `30_000` | — |
| `IDENTITY_WORKER_CONCURRENCY` | no | `2` | Cada job carga tres imágenes en memoria y las remuestrea con `sharp`, que reserva su propio búfer: la misma cota que el worker de extractos. |
| `IDENTITY_LEASE_SECONDS` | no | `300` | — |
| `IDENTITY_MAX_ATTEMPTS` | no | `3` | — |
| `IDENTITY_MAX_UPLOAD_BYTES` | **sí** | — | Por IMAGEN, no por petición: 10 MiB es lo que pesa una foto de un móvil moderno sin recortar. |
| `IDENTITY_DEFAULT_DOCUMENT_COUNTRY` | no | `'BO'` | — |
| `IDENTITY_ACCEPTED_DOCUMENT_TYPES` | no | `'BOLIVIA_CI'` | — |
| `IDENTITY_DOCUMENT_ACCEPT_CONFIDENCE` | no | `0.55` | — |
| `IDENTITY_DOCUMENT_REVIEW_CONFIDENCE` | no | `0.25` | — |
| `IDENTITY_ARBITRATION_MODE` | no | `'HUMAN'` | — |
| `IDENTITY_MATCH_THRESHOLD` | no | — | — |
| `IDENTITY_REVIEW_THRESHOLD` | no | — | — |
| `IDENTITY_THRESHOLD_PROFILE_VERSION` | no | `'unconfigured'` | — |
| `IDENTITY_MIN_DOCUMENT_QUALITY` | no | `0.5` | — |
| `IDENTITY_MIN_SELFIE_QUALITY` | no | `0.5` | — |
| `IDENTITY_MIN_FACE_AREA_RATIO` | no | `0.012` | — |
| `IDENTITY_DOCUMENT_EXPIRY_GRACE_DAYS` | no | `0` | — |
| `IDENTITY_MAX_IMAGE_PIXELS` | **sí** | — | — |
| `IDENTITY_MIN_IMAGE_WIDTH` | no | `480` | — |
| `IDENTITY_MIN_IMAGE_HEIGHT` | no | `480` | — |
| `IDENTITY_MIN_IMAGE_PIXELS` | no | `230_400` | — |
| `IDENTITY_MIN_READABLE_LONG_EDGE` | no | `240` | — |
| `IDENTITY_MIN_READABLE_SHORT_EDGE` | no | `150` | — |
| `IDENTITY_FACE_CROP_PADDING_RATIO` | no | `0.25` | — |
| `IDENTITY_MIN_DOCUMENT_FACE_PX` | no | `80` | — |
| `IDENTITY_LIVENESS_ENABLED` | no | `true` | — |
| `IDENTITY_LIVENESS_PASS_SCORE` | no | `0.55` | — |
| `IDENTITY_LIVENESS_FAIL_SCORE` | no | `0.35` | — |
| `IDENTITY_ACCEPT_NO_LIVENESS_RISK` | no | `false` | — |
| `IDENTITY_DOCUMENT_CLASSIFICATION_ENABLED` | no | `true` | — |
| `IDENTITY_OCR_PROVIDER` | no | `'tesseract'` | — |
| `IDENTITY_FACE_PROVIDER` | no | `'human'` | — |
| `IDENTITY_LIVENESS_PROVIDER` | no | `'human'` | — |
| `AUDIO_TTS_WORKER_ENABLED` | no | `false` | --- Worker D: locución (ADR-0026) --------------------------------------  El único de los cuatro que puede COSTAR DINERO por ejecución, y eso marca casi todas las variables que siguen: hay un presupuesto mensual, un techo por persona y día, y una puerta aparte para permitir generar bajo demanda. |
| `AUDIO_TTS_PROVIDER` | no | `'disabled'` | — |
| `AUDIO_TTS_ALLOW_RUNTIME_GENERATION` | no | `false` | — |
| `AUDIO_TTS_PROD_LICENSE_CONFIRMED` | no | `false` | — |
| `AUDIO_TTS_DEFAULT_LANGUAGE` | no | `'es-419'` | — |
| `AUDIO_TTS_DEFAULT_FORMAT` | no | `'mp3_44100_128'` | — |
| `AUDIO_TTS_SAMPLE_RATE` | no | `44_100` | — |
| `AUDIO_TTS_VOICE_PROFILE` | no | `'brand_es_latam_v1'` | — |
| `AUDIO_TTS_VOICE_VERSION` | no | `1` | — |
| `AUDIO_TTS_MODEL` | no | `'eleven_v3'` | — |
| `AUDIO_TTS_GLOBAL_FALLBACK_TEMPLATE` | **sí** | — | — |
| `AUDIO_TTS_MAX_TEXT_LENGTH` | no | `5_000` | — |
| `AUDIO_TTS_MONTHLY_BUDGET_UNITS` | **sí** | — | Presupuesto. Un 0 en el límite por actor significa BLOQUEADO, no ilimitado: un valor por omisión inseguro nunca debe abrir la puerta. |
| `AUDIO_TTS_SAFETY_RESERVE_UNITS` | **sí** | — | — |
| `AUDIO_TTS_RUNTIME_GENERATIONS_PER_ACTOR_DAY` | **sí** | — | — |
| `AUDIO_TTS_ACTOR_LIMIT_UNLIMITED` | no | `false` | — |
| `AUDIO_TTS_REQUEST_TIMEOUT_MS` | no | `10_000` | Red y resiliencia frente al proveedor. |
| `AUDIO_TTS_MAX_RESPONSE_BYTES` | **sí** | — | — |
| `AUDIO_TTS_MIN_RESPONSE_BYTES` | no | `256` | — |
| `AUDIO_TTS_HTTP_MAX_RETRIES` | no | `0` | — |
| `AUDIO_TTS_RETRY_BASE_MS` | no | `500` | — |
| `AUDIO_TTS_MAX_CONCURRENCY` | no | `2` | — |
| `AUDIO_TTS_MAX_REQUESTS_PER_SECOND` | no | `2` | — |
| `AUDIO_TTS_REPLICA_COUNT` | no | `1` | — |
| `AUDIO_TTS_BULKHEAD_QUEUE_SIZE` | no | `16` | — |
| `AUDIO_TTS_BULKHEAD_WAIT_MS` | no | `15_000` | — |
| `AUDIO_TTS_CB_FAILURE_THRESHOLD` | no | `5` | — |
| `AUDIO_TTS_CB_OPEN_MS` | no | `30_000` | — |
| `AUDIO_TTS_DATA_KEY` | no | `''` | — |
| `AUDIO_TTS_DATA_KEY_ID` | **sí** | — | — |
| `AUDIO_TTS_DATA_KEYS_PREVIOUS` | no | `''` | — |
| `ELEVENLABS_API_KEY` | no | `''` | — |
| `ELEVENLABS_BASE_URL` | no | `'https://api.elevenlabs.io'` | — |
| `ELEVENLABS_VOICE_ID` | no | `''` | — |
| `ELEVENLABS_MODEL_ID` | no | `''` | — |
| `ELEVENLABS_OUTPUT_FORMAT` | no | `''` | — |
| `ELEVENLABS_VOICE_STABILITY` | no | `0.5` | — |
| `ELEVENLABS_VOICE_SIMILARITY_BOOST` | no | `0.75` | — |
| `ELEVENLABS_VOICE_STYLE` | no | `0` | — |
| `ELEVENLABS_VOICE_SPEAKER_BOOST` | no | `true` | — |
| `AUDIO_TTS_WORKER_POLL_MS` | no | `500` | Ciclo de vida del trabajo, con la misma forma que los otros tres workers. |
| `AUDIO_TTS_WORKER_MAX_POLL_MS` | no | `30_000` | — |
| `AUDIO_TTS_RECOVERY_INTERVAL_MS` | no | `30_000` | — |
| `AUDIO_TTS_WORKER_CONCURRENCY` | no | `2` | Más baja que la de los otros workers: lo que limita aquí no es la memoria del motor sino las peticiones por segundo que admite el proveedor. |
| `AUDIO_TTS_LEASE_SECONDS` | no | `300` | — |
| `AUDIO_TTS_MAX_ATTEMPTS` | no | `3` | — |
| `AUDIO_STORAGE_DRIVER` | no | `'database'` | `database` guarda los bytes en la propia base, como el resto de workers guarda su carga útil; `local` es el adaptador de disco del paquete, para desarrollo. El adaptador S3 del paquete no se absorbió. |
| `AUDIO_LOCAL_STORAGE_PATH` | no | `'.local/audio-assets'` | — |
| `AUDIO_SEGMENT_CACHE_ENABLED` | no | `false` | — |
| `WORKERS_FIXTURES_ENABLED` | no | `false` | Los escenarios de prueba son sintéticos, pero crean ejecuciones reales. En producción están apagados para que no contaminen la operación. |
| `SCRIPT_NODES_ENABLED` | no | `false` | — |
| `SCRIPT_RUNNER_MODE` | no | `'IN_PROCESS'` | — |
| `PYTHON_EXECUTABLE` | no | `'python3'` | — |
| `SCRIPT_RUNNER_SOCKET_PATH` | no | `'/var/run/atlas-runner/runner.sock'` | — |
| `SCRIPT_NODE_TIMEOUT_MS` | no | `250` | — |
| `SCRIPT_NODE_MAX_SOURCE_BYTES` | no | `16_384` | — |
| `SCRIPT_NODE_MAX_OUTPUT_BYTES` | no | `65_536` | — |
| `SCRIPT_NODE_MAX_MEMORY_MB` | no | `32` | — |
| `IDEMPOTENCY_TTL_HOURS` | no | `24` | — |
| `IDEMPOTENCY_LEASE_SECONDS` | no | `60` | Short lease held while a decision is PROCESSING, so a crashed holder frees the key in seconds instead of blocking it for the full response TTL. Must be declared here or the schema strips it and IdempotencyService silently falls back to its 60s default. |
| `RUNTIME_RETENTION_SWEEP_ENABLED` | no | `true` | Retention sweep for expired runtime idempotency rows. The table is the highest volume in the system and every row already carries an expiry, so a background purge keeps it from growing without bound. Disable only for tests that assert on idempotency rows directly. |
| `RUNTIME_RETENTION_SWEEP_INTERVAL_MS` | **sí** | — | — |
| `RUNTIME_IDEMPOTENCY_RETENTION_GRACE_HOURS` | no | `24` | Extra margin kept beyond expiry before a row is eligible for deletion, so an in-flight replay racing expiry is never purged out from under itself. |
| `RUNTIME_RETENTION_SWEEP_BATCH` | no | `1_000` | Upper bound on rows deleted per statement, so a purge never holds a long lock. |
| `MAX_PAGE_SIZE` | no | `100` | — |
| `AUDIT_VERIFY_BATCH_SIZE` | no | `500` | Verification streams the append-only chain in bounded batches rather than loading a tenant's full regulatory history into memory. |
| `NESTED_TREE_MAX_DEPTH` | no | `5` | --------------------------------------------------------------------- Nested decision trees (Fase 7), Code->Flow import (Fase 5), live execution stream (Fase 8). --------------------------------------------------------------------- |
| `NESTED_TREE_DEFAULT_TIMEOUT_MS` | no | `2_000` | — |
| `NESTED_TREE_GRAPH_MAX_EDGES` | no | `2_000` | — |
| `NESTED_TREE_MAX_ARTIFACTS` | no | `25` | — |
| `NESTED_TREE_MAX_TOTAL_MS` | no | `10_000` | — |
| `NESTED_TREE_MAX_RESULT_BYTES` | **sí** | — | — |
| `NESTED_TREE_MAX_RETAINED_BYTES` | **sí** | — | — |
| `CODE_IMPORT_MAX_SOURCE_BYTES` | **sí** | — | — |
| `CODE_IMPORT_ANALYSIS_TIMEOUT_MS` | no | `2_000` | — |
| `LIVE_EXECUTION_STREAM_ENABLED` | no | `false` | Live preview is opt-in: it executes real non-PROD graphs but intentionally writes no decision/audit/outbox record. Heartbeats keep proxies and the global timeout alive. |
| `LIVE_EXECUTION_STREAM_HEARTBEAT_MS` | **sí** | — | — |
| `OUTBOX_RELAY_ENABLED` | no | `true` | Transactional outbox relay (event-driven backbone). The relay claims PENDING events with a short lease and dispatches them to the in-process bus; disable only in tests that drive dispatch manually or in replicas that must not run background workers. |
| `OUTBOX_RELAY_INTERVAL_MS` | no | `1_000` | Suelo del sondeo del relay y base del backoff por evento fallido. |
| `OUTBOX_RELAY_MAX_INTERVAL_MS` | no | `30_000` | Techo del retroceso con el outbox vacío. El productor anuncia cada fila con `pg_notify` al confirmar, así que subir este techo no retrasa el reparto real. |
| `OUTBOX_BACKLOG_SAMPLE_MS` | no | `30_000` | Cada cuánto se cuenta la profundidad del outbox para el gauge. Contarla en cada ciclo hacía que medir el backlog costara más que repartirlo. |
| `OUTBOX_BATCH_SIZE` | no | `25` | — |
| `OUTBOX_MAX_ATTEMPTS` | no | `8` | Failed dispatches back off exponentially via available_at; after this many attempts the event is dead-lettered (status DEAD) for operator attention. |
| `OUTBOX_LEASE_MS` | no | `30_000` | Claim lease: a relay replica that dies mid-batch frees its rows after this lapse. |
| `STARTUP_SEED_ENABLED` | no | — | Idempotently injects bootstrap seeds (every environment) and mockup/demo seeds (development only) at application startup. Left unset it is on everywhere except `test`, where suites provision their own fixtures. Set explicitly to force either way. Solo surte efecto donde corren los trabajos de fondo (WORKER_ROLE ∈ ALL, WORKER): una réplica de API nunca siembra, aunque esto esté en `true`. |
| `SEED_SOURCE_DATABASE_URL` | no | — | Cadena completa a la RAMA de PostgreSQL que publica el conjunto sembrado. Gana sobre `SEED_SOURCE_HOST`/`_DB`/`_USER`/`_PASSWORD`. La rama ES el perfil: la de desarrollo publica el artefacto de demostración, la de producción no, así que sustituye a `SEED_INCLUDE_MOCKUP` —que se deducía de `NODE_ENV` y nunca fue guarda fiable, porque la imagen del migrador fija `production` también en un portátil. Ver `docs/data/seeds.md`. |
| `SEED_SOURCE_HOST` / `SEED_SOURCE_PORT` / `SEED_SOURCE_DB` / `SEED_SOURCE_USER` / `SEED_SOURCE_PASSWORD` / `SEED_SOURCE_SSL` | no | — | La rama por partes. Cómodo cuando sólo cambia la rama: cada rama tiene su propio endpoint, así que se toca el host y el resto queda igual. |
| `BOOTSTRAP_TENANT_ID` | **sí** | — | Bootstrap integration clients. Read straight from process.env by the seed helpers (they stay framework-free so `prisma db seed` can run them without Nest); declared here so the values are validated and documented instead of being magic strings.  El tenant de TODO lo que siembra el módulo, no sólo de estos clientes: lo resuelve `seeding/data/helpers.ts`. `[1-9][0-9]*` y no `[0-9]+` para que las dos validaciones digan lo mismo — el `0` pasaba aquí y el resolutor lo rechaza, así que un despliegue arrancaba y la siembra moría después, que es el peor sitio para enterarse. |
| `SEED_TENANT_ID` | **sí** | — | Sinónimo histórico, el que usan los guiones de `prisma/dev-seeds/`. Se declara para que valide igual; si están las dos, manda BOOTSTRAP_TENANT_ID. |
| `BOOTSTRAP_MANAGEMENT_ROLES` | no | `''` | — |
| `BOOTSTRAP_RUNTIME_ROLES` | no | `''` | — |

