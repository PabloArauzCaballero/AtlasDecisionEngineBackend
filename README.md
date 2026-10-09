# ATLAS Decision Engine Backend 2.0

Backend modular para diseñar, probar, aprobar, desplegar, ejecutar y auditar decisiones de crédito, riesgo y fraude.

## Estado

Este repositorio es el entregable técnico de la fase de backend y endurecimiento. Incluye el motor, persistencia, seguridad, auditoría, observabilidad y referencias de despliegue verificables en desarrollo y CI.

El cierre de esta fase no equivale a un Go-Live: IAM/JWKS real, infraestructura administrada, pruebas de carga, restore, pentest, rotación de secretos y aprobaciones de Riesgo/Compliance pertenecen al proceso de puesta en producción.

## Capacidades

- Artefactos y versiones inmutables de decisión.
- Grafo validado, compilación canónica y ejecución determinista.
- Catálogo versionado de variables y códigos de razón.
- Suites de prueba, regresión y cobertura del grafo.
- Gobierno, aprobaciones, segregación de funciones y despliegues.
- Runtime idempotente con snapshots, trazas y revisión manual.
- Auditoría encadenada por HMAC y verificación de integridad.
- Multi-tenancy, RBAC, JWT RS256/JWKS, proveedor de identidad y clientes de integración.
- Rate limiting, métricas Prometheus, health/readiness y logs JSON estructurados.
- Workers de fondo con API propia: verificación de identidad, extractos bancarios, análisis semántico y locución (TTS).
- Consola SQL de solo lectura sobre cinco datasets gobernados.
- Revisión manual con aviso de vuelta a AtlasBackend por outbox.

## Módulos (`src/modules/`)

`artifacts`, `governance`, `deployments`, `runtime` (decisiones, simulación, idempotencia), `live-execution`,
`libraries`, `graph`, `nested-trees`, `variables`, `calculated-fields`, `views`, `code-import`, `testing`,
`manual-review`, `atlas-callback`, `outbox-relay`, `outcome-ingestion`, `model-monitoring`, `risk-governance`,
`data-subject`, `security-review`, `audit-query`, `traceability`, `notifications`, `identity-session`,
`platform-catalog`, `sql-console`, `qa-lab`, `tutorials`, `seeding`, `health` y `workers/`
(`identity-verification`, `bank-statement`, `semantic-analysis`, `audio-tts`). Además `src/pdf-worker/`
(proceso aparte, `yarn pdf:worker`). El catálogo generado de módulos y endpoints está en `docs/` (`yarn docs:catalog`).

## Procesos: API y worker

`WORKER_ROLE` (`ALL` por defecto, `API`, `WORKER`) decide dónde corren los trabajos de fondo (relay del outbox,
corridas de prueba, purga de idempotencia, vigilancia de modelos, workers). `ALL` sirve HTTP y trabaja;
`API` solo sirve HTTP; `WORKER` (`dist/worker.js`) no sirve HTTP. Ver
[`docs/worker-orchestration.md`](docs/worker-orchestration.md).

## Stack

- Node.js 22 (imagen `node:22-bookworm-slim`)
- NestJS 11 y TypeScript
- PostgreSQL 16 y Prisma 6
- Redis 7
- Jest
- Docker y manifiestos Kubernetes de referencia

Los workers pueden enviar texto fuera del perímetro a un LLM alojado (OpenRouter, LiteLLM u OpenAI en el
análisis semántico; OpenRouter en el segundo lector de carnets y en el consejero de columnas de extractos) y a
ElevenLabs en la locución. Ver [Workers](#workers-de-fondo).

## Documentación vigente

- [`docs/README.md`](docs/README.md): catálogo, vigencia y justificación de cada documento.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): arquitectura y contratos internos.
- [`docs/API_EXAMPLES.md`](docs/API_EXAMPLES.md): autenticación y ejemplos HTTP.
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md): ejecución local y despliegue.
- [`docs/runbooks/OPERATIONS.md`](docs/runbooks/OPERATIONS.md): operación e incidentes.
- [`docs/CONFIGURABLE_OUTPUTS.md`](docs/CONFIGURABLE_OUTPUTS.md): nodos RESULT y scripts aislados.
- [`docs/code-to-flow-specification.md`](docs/code-to-flow-specification.md): importación y derivación visual de código.
- [`docs/nested-decision-trees.md`](docs/nested-decision-trees.md): composición versionada de políticas.
- [`docs/live-execution.md`](docs/live-execution.md): previsualización SSE opt-in y no productiva.
- [`docs/event-driven-architecture.md`](docs/event-driven-architecture.md): outbox, relay e idempotencia.
- [`docs/worker-orchestration.md`](docs/worker-orchestration.md): orquestador central de trabajos de fondo, reparto API/WORKER y despertar por `LISTEN`/`NOTIFY`.
- [`docs/verification-2026-07-28.md`](docs/verification-2026-07-28.md): última verificación integral aislada.
- [`docs/IMPLEMENTATION_MATRIX.md`](docs/IMPLEMENTATION_MATRIX.md): trazabilidad entre diseño e implementación.
- [`docs/plantuml/README.md`](docs/plantuml/README.md): diagramas de diseño.
- [`SECURITY.md`](SECURITY.md): reporte responsable y reglas mínimas.
- [`docs/VISTAS_POR_FASES.md`](docs/VISTAS_POR_FASES.md): backlog de interfaz; no es un contrato de API.

## Inicio local

1. Copie `.env.example` a `.env`.
2. Para autenticación local sin proveedor de identidad, cambie `AUTH_MODE=API_KEY`.
3. Inicie PostgreSQL y Redis:

```bash
docker compose up -d postgres redis
```

4. Prepare y ejecute la aplicación:

```bash
yarn install --frozen-lockfile
yarn prisma:generate
yarn prisma:migrate
yarn prisma:seed
yarn start:dev
```

El seed registra los clientes bootstrap usando `MANAGEMENT_API_KEY`, `RUNTIME_API_KEY`, `BOOTSTRAP_TENANT_ID` y los alcances `BOOTSTRAP_*_ROLES`. Puede ejecutarse varias veces de forma idempotente.

Servicios:

- API: `http://localhost:3000`
- Swagger, solo fuera de producción: `http://localhost:3000/docs`
- Liveness: `GET /health/live`
- Readiness: `GET /health/ready`
- Métricas: `GET /metrics` con `Authorization: Bearer <METRICS_TOKEN>`

En DEV, Coolify pasa `SOURCE_COMMIT` como `COMMIT_SHA` a API y worker. El gate post-deploy
consulta `/health/live` y `/health/ready`, exige PostgreSQL y Redis reales (no el respaldo en
memoria) y compara el commit servido con el SHA que pasó CI. Obtiene el dominio `api` de Coolify;
si no hay uno registrado, se configura `DEV_SMOKE_BASE_URL` como variable del repositorio en
GitHub. Sin un destino verificable, el despliegue falla.

## Autenticación

### Clientes de integración

Una API key solo identifica una credencial registrada. El servidor obtiene de PostgreSQL:

- la identidad estable del cliente;
- la audiencia `management` o `runtime`;
- los roles autorizados;
- los tenants permitidos;
- el estado y vigencia de la credencial.

El llamante no puede declarar `x-principal-id` ni `x-roles`. `x-tenant-id` es opcional para clientes de un solo tenant y obligatorio para clientes autorizados en varios tenants.

```http
x-api-key: <MANAGEMENT_API_KEY>
x-tenant-id: 1
```

El cliente runtime usa una credencial distinta y debe llevar el rol `DECISION_RUNTIME`
(`BOOTSTRAP_RUNTIME_ROLES`); sin él `POST /v1/decisions/:artifactCode` responde 403. La clave de idempotencia
va en el CUERPO (`idempotencyKey`, obligatoria, máx. 160 caracteres), no en una cabecera:

```http
x-api-key: <RUNTIME_API_KEY>
x-tenant-id: 1
```

### Identidades firmadas

Los modos `JWT`, `HYBRID`, `IDENTITY_PROVIDER` e `IDENTITY_HYBRID` resuelven tenant y roles desde claims o perfiles verificados. El comodín `PLATFORM_ADMIN` solo se acepta mediante JWT o proveedor de identidad; una API key siempre necesita el rol específico de la ruta.

`AUTH_MODE` admite `API_KEY` (por defecto), `JWT`, `HYBRID`, `IDENTITY_PROVIDER` e `IDENTITY_HYBRID`.
Producción rechaza `AUTH_MODE=API_KEY`, Swagger habilitado, logging debug/verbose y proveedores HTTP sin TLS.

## Roles

Roles de gestión (`src/common/security/platform-roles.ts`): `PLATFORM_ADMIN`, `RISK_ANALYST`, `FRAUD_ANALYST`,
`QA_ANALYST`, `RISK_APPROVER`, `COMPLIANCE`, `AUDITOR`, `OPERATIONS`. `DECISION_RUNTIME` queda fuera de esa
lista a propósito: es el rol de la audiencia `runtime` y no abre el plano de gestión. Cada ruta declara sus
roles con `@Roles(...)`; el tenant sale del principal, nunca del cuerpo.

## Gobierno de dos personas

`POST /v1/artifact-versions/:id/submit-for-review` crea una solicitud con pasos en orden: 1 `QA_ANALYST`,
2 `RISK_APPROVER` y, solo si se pide `requireCompliance`, 3 `COMPLIANCE`. Cada paso lleva segregación de
funciones (`governance.service.ts`):

- quien contribuyó a la versión no puede aprobarla (`SEPARATION_OF_DUTIES_VIOLATION`);
- nadie firma TODOS los pasos de una solicitud: al firmar el último pendiente habiendo firmado ya los demás
  se rechaza. Una persona puede firmar dos pasos si otra firma el resto;
- hace falta el rol EXACTO del paso (`APPROVAL_ROLE_REQUIRED`). `PLATFORM_ADMIN` sólo lo sustituye si el
  entorno pone `GOVERNANCE_ADMIN_CAN_SIGN_ANY_STEP=true` (por defecto `false`; TEST/DEV lo encienden en
  `docker-compose.coolify.yml` mientras nadie tenga los roles de cada paso), sólo con identidad firmada, y la
  firma queda marcada en la auditoría (`signedVia: PLATFORM_ADMIN_WILDCARD`). Ni así se salta las dos reglas
  anteriores;
- cada decisión lleva un comentario de al menos 10 caracteres (la API lo exige, no sólo el portal);
- una persona no decide dos veces el mismo paso (`DUPLICATE_APPROVAL_DECISION`).

La reidentificación de un titular (`risk-governance`) también exige dos personas: quien la pide no puede
aprobarla (`REIDENTIFICATION_SELF_APPROVAL`). Las aprobaciones las firman personas desde el portal; no se
crean aprobadores de máquina.

## Despliegues

Solo se aceptan despliegues `DIRECT` sin reglas de tráfico (`DEPLOYMENT_MODE_NOT_SUPPORTED` en otro caso): el
runtime todavía no enruta por porcentaje ni segmento. `effectiveFrom` futuro se rechaza
(`DEPLOYMENT_EFFECTIVE_FROM_IN_FUTURE`) porque dejaría el artefacto sin despliegue activo. Sembrar no es
desplegar: sin binding activo el runtime responde `ACTIVE_DEPLOYMENT_NOT_FOUND`.

## Simulación

`POST /v1/simulations/:artifactCode` no escribe decisión, idempotencia ni auditoría (`persisted: false`),
pero los nodos `WORKER` (OCR, LLM, TTS) se ejecutan de verdad a través de `WorkerServiceInvokerService`: la
simulación puede llamar a proveedores externos y tener coste.

## Scripts en el grafo

`SCRIPT_RUNNER_MODE` es `IN_PROCESS` (por defecto) o `SIDECAR`. El modo en proceso no es una frontera de
seguridad del sistema operativo: con `SCRIPT_NODES_ENABLED` en producción la configuración exige `SIDECAR`
(contenedor `runner/`). El filtrado del código del script es defensa en profundidad, no un aislamiento.

## Consola SQL

`/v1/sql-console` (`catalog`, `validate`, `query`, `history`) es solo lectura y la usan `RISK_ANALYST`,
`FRAUD_ANALYST`, `RISK_APPROVER`, `COMPLIANCE` y `AUDITOR`. Tres barreras (`src/modules/sql-console`):

1. **`guard/sql-guard.ts`**: guardia léxica. Una sola sentencia de hasta 64 KiB; rechaza palabras como
   `INSERT`, `UPDATE`, `DELETE`, `CREATE`, `SET`, `INTO`, `EXPLAIN`, `SHOW`, `COPY` y funciones como
   `set_config`, `current_setting`, `pg_sleep` o `pg_read_file`. Explica en qué línea y por qué.
2. **Rol de base de datos**: `atlas_sql_console`, o `atlas_reader` si aquél no está aprovisionado, más
   `transaction_read_only` y un `search_path` acotado a los cinco datasets. Es la barrera real.
3. **`execution/query-executor.service.ts`**: pide el plan (`EXPLAIN (FORMAT JSON)`) y comprueba que toda
   relación recorrida pertenezca a un dataset publicado; ejecuta con `LIMIT` y reloj.

Usa `PrismaReadService` y no el reintento hacia el primario: si la conexión de lectura cae, la consola falla
en vez de degradar a una conexión con permiso de escritura. Límites: `SQL_CONSOLE_MAX_ROWS` (10 000) y
`SQL_CONSOLE_TIMEOUT_MS` (12 000).

## Roles de base de datos lector y escritor (ADR-0029)

`DATABASE_URL` es la única obligatoria. `DATABASE_WRITE_URL` y `DATABASE_READ_URL` separan escritura y lectura
por credencial (o por servidor, con réplica); `DATABASE_READ_POOL_MAX` dimensiona el pool de lectura.
`DATA_READ_ROUTING_ENABLED` (apagado por defecto) activa el enrutamiento y es el rollback;
`ENABLE_PRIMARY_READ_FALLBACK` (encendido) sirve desde el primario si la lectura no está disponible, con log y
`atlas_database_fallback_total`. Con una conexión de lectura dedicada, el arranque comprueba que el rol NO puede
escribir. `yarn db:provision:dev` crea `atlas_writer` y `atlas_reader` (requiere `POSTGRES_WRITER_PASSWORD` y
`POSTGRES_READER_PASSWORD`, mínimo 16 caracteres); nunca se ejecuta en producción.

## Revisión manual y AtlasBackend

Las resoluciones humanas (`/v1/manual-reviews`) se devuelven a AtlasBackend por outbox (`atlas-callback`, repartido
por el worker). Configure `ATLAS_BACKEND_BASE_URL` y `ENGINE_CALLBACK_API_KEY` (se envía en
`x-engine-callback-key`); en producción son obligatorias salvo `ATLAS_CALLBACK_DISABLED=true`. Sin configuración
el aviso se reintenta y acaba en `DEAD`, visible y reprocesable.

## Workers de fondo

API bajo `/v1/workers` (`GET /v1/workers`, `GET /v1/workers/:code/metrics`) y por worker:

| Worker | Rutas | Notas |
|---|---|---|
| Identidad | `/v1/workers/identity-verification`, `.../reviews` | Pipeline local (Tesseract, MRZ, forense); segundo lector por OpenRouter con `IDENTITY_SECOND_READER_ENABLED` (apagado). Cola humana con claim/resolve. |
| Extractos | `/v1/workers/bank-statement`, `.../reviews`, `.../institutions` | Subir un extracto real exige almacén S3 (`STORAGE_S3_ENDPOINT`, `_BUCKET`, `_ACCESS_KEY_ID`, `_SECRET_ACCESS_KEY`). `BANK_STATEMENT_COLUMN_ADVISOR_ENABLED` (apagado) envía los rótulos de cabecera a OpenRouter y requiere `OPENROUTER_API_KEY`. |
| Semántico | `/v1/workers/semantic-analysis`, `.../categories`, `.../model-settings`, `.../unresolved` | Encendido con `SEMANTIC_ANALYSIS_WORKER_ENABLED`; `SEMANTIC_ANALYSIS_PROVIDER` ∈ `transformer`, `cascade`, `litellm`, `openrouter`, `openai`. El texto clasificado sale a un LLM alojado salvo con `transformer`. Minimiza a los `SEMANTIC_ANALYSIS_MINIMIZE_AFTER_DAYS` (30) y purga auditoría a los `SEMANTIC_ANALYSIS_AUDIT_RETENTION_DAYS` (90). |
| Locución (TTS) | `/v1/workers/audio-tts` | Con el worker encendido, `AUDIO_TTS_DATA_KEY` de al menos 32 caracteres (cifra el texto locutado); `AUDIO_TTS_PROD_LICENSE_CONFIRMED` es la confirmación explícita de licencia de voz en producción. Proveedor externo con coste por carácter. |
| Archivos | `GET /v1/workers/storage/references` | Rol `DECISION_RUNTIME`; AtlasBackend la consulta antes de borrar archivos. |

Los modelos y el gateway del análisis semántico son configuración GLOBAL a todos los tenants
(`model-settings`, editable en caliente por `RISK_ANALYST` y `OPERATIONS`).

## Logs y métricas

Todos los logs Nest se emiten como JSON estructurado con contexto de request. `LOG_OUTPUT=stdout` es el valor seguro por defecto para contenedores con filesystem de solo lectura.

Para duplicar a archivo:

```env
LOG_OUTPUT=stdout_and_file
LOG_FILE_PATH=/var/log/atlas/atlas-decision-engine.log
```

La ruta debe pertenecer a un volumen escribible. Si el sink falla, la aplicación continúa por stdout.

Las fallas del proveedor de variables se exponen mediante `atlas_provider_failures_total{provider,reason}` y un evento estructurado.

## Rutas principales

| Dominio | Rutas |
|---|---|
| Salud | `/health/live`, `/health/ready` |
| Métricas | `/metrics` |
| Artefactos | `/v1/artifacts`, `/v1/artifact-versions/*` |
| Variables | `/v1/variables`, `/v1/reason-codes` |
| Pruebas | `/v1/artifact-versions/:id/test-suites`, `/v1/test-suites/:id/runs` |
| Gobierno | `/v1/artifact-versions/:id/submit-for-review`, `/v1/approval-*`, `/v1/approval-steps/:id/decisions` |
| Despliegues | `/v1/environments`, `/v1/deployments`, `POST /v1/artifact-versions/:id/deployments`, `/v1/deployments/:id/{rollback,suspend}` |
| Runtime | `/v1/decisions/:artifactCode` |
| Simulación y vivo | `/v1/simulations/:artifactCode`, `/v1/live-executions/stream` |
| Revisión manual | `/v1/manual-reviews` |
| Árboles anidados | `/v1/artifact-versions/:versionId/references` |
| Código → Flow | `/v1/code-imports` |
| Librerías | `/v1/libraries` |
| Workers | `/v1/workers/*` (ver [Workers de fondo](#workers-de-fondo)) |
| Consola SQL | `/v1/sql-console/{catalog,validate,query,history}` |
| Riesgo y titulares | `/v1/risk-governance`, `/v1/data-subject-requests`, `/v1/security-review`, `/v1/model-monitoring`, `/v1/outcomes` |
| QA y vistas | `/v1/qa-lab`, `/v1/views`, `/v1/calculated-fields` |
| Sesión del portal | `/v1/session` |
| Notificaciones | `/v1/notifications` |
| Auditoría | `/v1/audit/executions`, `/v1/audit/events`, `/v1/audit/chain/verify` |
| Trazabilidad | `/v1/traceability/objectives`, `/v1/traceability/policies/*` |

## Verificación

```bash
yarn prisma:validate
yarn migration:validate
yarn check             # format:check + lint + typecheck
yarn typecheck
yarn test:unit         # suites sin base de datos (rápido, para el bucle local)
yarn build
yarn test              # todas las suites (unit + integración; requiere Postgres/Redis)
yarn test:cov
yarn test:e2e
yarn smoke             # PowerShell; en macOS/Linux: yarn smoke:sh
yarn security:audit
yarn verify            # format:check, lint, typecheck, build y test
yarn verify:release    # verify + migration:validate + security:audit + docs:validate
```

Si cambia código que alimenta un catálogo (módulos, endpoints, entidades, eventos, errores o
`env.schema.ts`), ejecute `yarn docs:catalog` y confirme el resultado: el CI falla si los catálogos generados
quedan desactualizados.

`yarn smoke` no lleva credenciales propias: toma `MANAGEMENT_API_KEY`,
`RUNTIME_API_KEY`, `PORT`, `BOOTSTRAP_TENANT_ID` y `DEFAULT_ENVIRONMENT` del
`.env` del repositorio (lo ya exportado en el entorno tiene prioridad) y aborta
si falta una clave, en vez de autenticarse con un valor de ejemplo y reportar un
401 como si fuera un defecto del producto. `docker-compose.yml` sigue la misma
regla: ningún secreto tiene valor por defecto ahí, todos vienen del `.env`
(véase `.env.example`).

`LIVE_EXECUTION_STREAM_ENABLED` está desactivado por defecto: el stream ejecuta
un grafo real de un ambiente no productivo pero no crea una `DecisionExecution`, por lo que
debe habilitarse conscientemente sólo donde el portal use esa previsualización.

La mayoría de las carpetas mantenidas contiene un `README.md` que explica su propósito de
negocio, responsabilidad de sistema y límites. El código productivo incluye
JSDoc para contratos e invariantes no obvias, y todos los endpoints publican un
resumen en OpenAPI.

Para validar configuración productiva, compile y ejecute:

```bash
yarn production:config:check
```

## Límites del entregable

- Las integraciones con buró, KYC, bancos, QR, mensajería, KMS y WORM requieren proveedores reales.
- OpenRouter/LiteLLM/OpenAI (análisis semántico, segundo lector, consejero de columnas) y ElevenLabs (locución) son terceros: lo que se les envía sale del perímetro.
- El seed BNPL es demostrativo y no sustituye aprobación formal de políticas.
- La retención y el legal hold requieren definición de Compliance; el worker semántico ya aplica una barrida automática (30/90 días por defecto).
- Los manifiestos Kubernetes deben adaptarse al ingress, TLS, secret manager, topología y observabilidad de la plataforma objetivo.
- `backend.zip` fue retirado del árbol actual, pero cualquier secreto que haya existido en su historial debe rotarse y purgarse mediante un procedimiento controlado.
