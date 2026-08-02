<!-- GENERADO POR scripts/docs/generate-catalogs.mjs — NO EDITAR A MANO.
     Fuente: src/common/config/env.schema.ts. Ejecute `yarn docs:catalog` tras cambiar el código. -->

# Variables de entorno

118 variables declaradas. El esquema se valida al arrancar: un valor ausente o
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
| `IDENTITY_PROVIDER_RETRY_ATTEMPTS` | no | `2` | Retries only for transient failures (network error / timeout / 502-503-504), never for a rejected credential. Shields login from the brief window where the provider dev server is restarting (build-and-watch). 0 disables retries. |
| `IDENTITY_PROVIDER_RETRY_BACKOFF_MS` | no | `300` | — |
| `IDENTITY_REFRESH_COOKIE_NAME` | **sí** | — | — |
| `IDENTITY_REFRESH_COOKIE_MAX_AGE_SECONDS` | **sí** | — | — |
| `IDENTITY_SESSION_RATE_LIMIT` | no | `20` | — |
| `CORS_ALLOWED_ORIGINS` | no | `''` | — |
| `TRUST_PROXY_HOPS` | no | `1` | — |
| `BODY_LIMIT_BYTES` | no | `1_048_576` | — |
| `REQUEST_TIMEOUT_MS` | no | `15_000` | — |
| `SHUTDOWN_GRACE_MS` | no | `20_000` | — |
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
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | no | — | — |
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
| `SCRIPT_NODES_ENABLED` | no | `false` | — |
| `SCRIPT_RUNNER_MODE` | no | `'IN_PROCESS'` | — |
| `PYTHON_EXECUTABLE` | no | `'python'` | Interpreter used by the in-process runner and the Code->Flow Python syntax checker. The SIDECAR image ships only `python3`, so that container sets this explicitly; the default matches the usual development install where the launcher is named `python`. |
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
| `BOOTSTRAP_TENANT_ID` | **sí** | — | Bootstrap integration clients. Read straight from process.env by the seed helpers (they stay framework-free so `prisma db seed` can run them without Nest); declared here so the values are validated and documented instead of being magic strings. |
| `BOOTSTRAP_MANAGEMENT_ROLES` | no | `''` | — |
| `BOOTSTRAP_RUNTIME_ROLES` | no | `''` | — |

