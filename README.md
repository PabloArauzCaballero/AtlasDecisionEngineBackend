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

## Stack

- Node.js 22
- NestJS 11 y TypeScript
- PostgreSQL 16 y Prisma 6
- Redis 7
- Jest
- Docker y manifiestos Kubernetes de referencia

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

El cliente runtime usa una credencial distinta:

```http
x-api-key: <RUNTIME_API_KEY>
x-tenant-id: 1
idempotency-key: unique-business-key
```

### Identidades firmadas

Los modos `JWT`, `HYBRID`, `IDENTITY_PROVIDER` e `IDENTITY_HYBRID` resuelven tenant y roles desde claims o perfiles verificados. El comodín `PLATFORM_ADMIN` solo se acepta mediante JWT o proveedor de identidad; una API key siempre necesita el rol específico de la ruta.

Producción rechaza `AUTH_MODE=API_KEY`, Swagger habilitado, logging debug/verbose y proveedores HTTP sin TLS.

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
| Gobierno | `/v1/artifact-versions/:id/submit-for-review`, `/v1/approval-*` |
| Despliegues | `/v1/environments`, `/v1/deployments` |
| Runtime | `/v1/decisions/:artifactCode` |
| Simulación y vivo | `/v1/simulations/:artifactCode`, `/v1/live-executions/stream` |
| Revisión manual | `/v1/manual-reviews` |
| Árboles anidados | `/v1/artifact-versions/:versionId/references` |
| Código → Flow | `/v1/code-imports` |
| Notificaciones | `/v1/notifications` |
| Auditoría | `/v1/audit/executions`, `/v1/audit/events`, `/v1/audit/chain/verify` |
| Trazabilidad | `/v1/traceability/objectives`, `/v1/traceability/policies/*` |

## Verificación

```bash
yarn prisma:validate
yarn migration:validate
yarn typecheck
yarn test:unit         # suites sin base de datos (rápido, para el bucle local)
yarn build
yarn test              # todas las suites (unit + integración; requiere Postgres/Redis)
yarn test:cov
yarn test:e2e
yarn smoke
yarn security:audit
```

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

Cada carpeta mantenida contiene un `README.md` que explica su propósito de
negocio, responsabilidad de sistema y límites. El código productivo incluye
JSDoc para contratos e invariantes no obvias, y todos los endpoints publican un
resumen en OpenAPI.

Para validar configuración productiva, compile y ejecute:

```bash
yarn production:config:check
```

## Límites del entregable

- Las integraciones con buró, KYC, bancos, QR, mensajería, KMS y WORM requieren proveedores reales.
- El seed BNPL es demostrativo y no sustituye aprobación formal de políticas.
- La retención y legal hold requieren definición de Compliance.
- Los manifiestos Kubernetes deben adaptarse al ingress, TLS, secret manager, topología y observabilidad de la plataforma objetivo.
- `backend.zip` fue retirado del árbol actual, pero cualquier secreto que haya existido en su historial debe rotarse y purgarse mediante un procedimiento controlado.
