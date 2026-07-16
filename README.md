# ATLAS Decision Engine Backend 2.0

Backend modular para diseñar, probar, aprobar, desplegar, ejecutar y auditar decisiones de crédito, riesgo y fraude de ATLAS.

## Estado

**Release candidate endurecido para producción.** La base técnica está implementada y verificada localmente. El Go-Live todavía exige integrar IAM/JWKS real, proveedores externos, infraestructura administrada, pruebas de carga, restore, pentest y aprobación de políticas.

## Capacidades

- Artefactos y versiones inmutables de decisión.
- Grafo de reglas, validación estructural y compilación determinista.
- Catálogo versionado de variables y reason codes.
- Suites de prueba, assertions, regresión y cobertura de nodos/aristas/terminales.
- Gobierno, aprobaciones y segregación de funciones.
- Ambientes, deployments, suspensión y rollback.
- Runtime idempotente con snapshots, trazas y revisión manual.
- Auditoría encadenada por HMAC y verificación de integridad.
- Trazabilidad entre objetivos, políticas, artefactos y pruebas.
- Multi-tenancy, RBAC, JWT RS256/JWKS y API keys de transición.
- Rate limiting distribuido, métricas Prometheus, health/readiness y logs JSON estructurados con Pino (stdout + archivo persistente).

## Stack

- Node.js 22
- NestJS 11 + TypeScript
- PostgreSQL 16
- Prisma 6 con adapter `pg`
- Redis 7
- Jest
- Docker / Kubernetes reference manifests

## Documentación clave

- [`docs/VISTAS_POR_FASES.md`](docs/VISTAS_POR_FASES.md): catálogo de pantallas por fase y clasificación tabla/formulario.
- [`docs/PRODUCTION_READINESS.md`](docs/PRODUCTION_READINESS.md): gates antes de Go-Live.
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md): despliegue local y productivo.
- [`docs/runbooks/OPERATIONS.md`](docs/runbooks/OPERATIONS.md): respuesta operativa.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): arquitectura interna.
- [`docs/IMPLEMENTATION_MATRIX.md`](docs/IMPLEMENTATION_MATRIX.md): trazabilidad con PlantUML.
- [`docs/API_EXAMPLES.md`](docs/API_EXAMPLES.md): ejemplos de uso.

## Inicio rápido local

```bash
cp .env.example .env
docker compose up --build
```

La migración se ejecuta como un contenedor one-shot separado. El seed **no** se aplica automáticamente:

```bash
docker compose --profile seed run --rm seed
```

Servicios locales:

- API: `http://localhost:3000`
- Swagger: `http://localhost:3000/docs`
- Liveness: `GET /health/live`
- Readiness: `GET /health/ready`
- Métricas: `GET /metrics` con `Authorization: Bearer <METRICS_TOKEN>`

## Inicio sin contenerizar la API

```bash
npm ci
npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed
npm run start:dev
```

## Seguridad

### Producción

`NODE_ENV=production` obliga a usar `AUTH_MODE=JWT` o `HYBRID`. Configure:

- `JWT_JWKS_URL` HTTPS
- `JWT_ISSUER`
- audiences de management/runtime
- claim de tenant y roles
- Redis
- token de métricas
- secreto HMAC de auditoría

La aplicación valida firma RS256, issuer, audience, expiración, `nbf`, tenant y roles. En modo híbrido se conservan API keys distintas para integraciones técnicas durante una migración controlada.

### Contexto por API key en desarrollo

Headers de management:

```http
x-api-key: <MANAGEMENT_API_KEY>
x-tenant-id: 1
x-actor-id: developer
x-roles: RISK_ANALYST,QA_ANALYST
```

Runtime:

```http
x-api-key: <RUNTIME_API_KEY>
x-tenant-id: 1
x-actor-id: consumer-api
x-roles: DECISION_RUNTIME
idempotency-key: unique-business-key
```

Los headers de roles y tenant no son confiables cuando la autenticación es JWT; se extraen exclusivamente de claims firmados.

## Respuestas paginadas

Los inventarios aceptan `page` y `pageSize`; el tamaño está limitado por `MAX_PAGE_SIZE`.

```json
{
  "items": [],
  "page": 1,
  "pageSize": 25,
  "total": 0,
  "totalPages": 0,
  "hasNextPage": false
}
```

## Logs

Todos los `Logger` de Nest (guards, interceptors, servicios) enrutan a través de un único
`StructuredLoggerService` respaldado por [Pino](https://getpino.io/), registrado con
`app.useLogger()`. Cada línea es JSON estructurado con `requestId`, `tenantId`, `principalId` y
`context`, y se escribe simultáneamente a stdout y a un archivo persistente:

- `LOG_FILE_PATH` (default `logs/atlas-decision-engine.log`): ruta del archivo; el directorio se
  crea automáticamente si no existe. El archivo crece de forma append-only entre reinicios — en
  producción, rotarlo con `logrotate` o un side-car de recolección (no hay rotación interna).
- `LOG_LEVEL` sigue controlando el umbral mínimo (`error`/`warn`/`log`/`debug`/`verbose`).

Las acciones de negocio (crear artefacto, reemplazar grafo, correr suite, aprobar, desplegar,
ejecutar decisión, revisión manual, trazabilidad) se loguean desde el único punto por el que todas
pasan (`AuditService.append`), y cada rechazo HTTP (401/403/409/429/5xx) se loguea desde
`DomainExceptionFilter`, además del log de acceso por request de `AccessLogInterceptor`.

## Principales rutas

| Dominio | Rutas principales |
|---|---|
| Salud | `/health/live`, `/health/ready` |
| Métricas | `/metrics` |
| Artefactos | `/v1/artifacts`, `/v1/artifact-versions/*` |
| Variables | `/v1/variables`, `/v1/reason-codes` |
| Pruebas | `/v1/artifact-versions/:id/test-suites`, `/v1/test-suites/:id/runs` |
| Gobierno | `/v1/artifact-versions/:id/submit-for-review`, `/v1/approval-*` |
| Despliegues | `/v1/environments`, `/v1/deployments` |
| Runtime | `/v1/decisions/:artifactCode` |
| Revisión manual | `/v1/manual-reviews` |
| Auditoría | `/v1/audit/executions`, `/v1/audit/events`, `/v1/audit/chain/verify` |
| Trazabilidad | `/v1/traceability/objectives`, `/v1/traceability/policies/*` |

## Verificación

```bash
npm run typecheck
npm run build
npm test
npm run test:cov
npm run migration:validate
npm run security:audit
```

Validación de configuración después de compilar:

```bash
NODE_ENV=production \
DATABASE_URL='...' \
REDIS_URL='rediss://...' \
AUTH_MODE=JWT \
JWT_JWKS_URL='https://...' \
JWT_ISSUER='https://...' \
AUDIT_HASH_SECRET='...' \
METRICS_TOKEN='...' \
npm run production:config:check
```

## Docker

La imagen tiene targets separados:

```bash
docker build --target runtime -t atlas-decision-engine:2.0.0 .
docker build --target migrator -t atlas-decision-migrator:2.0.0 .
```

La API runtime no contiene Prisma CLI ni ejecuta migraciones o seeds al arrancar. Ejecutar cambios de schema como Job previo al rollout evita carreras entre réplicas.

## Kubernetes

`deploy/kubernetes` contiene plantillas para Deployment, Service, migration Job, HPA, PDB y NetworkPolicy. Deben adaptarse a registry, secret manager, TLS, ingress, topología y políticas reales.

## Reglas de datos

- Contactos del dispositivo no se almacenan; solo señales derivadas autorizadas.
- Cada decisión conserva versión, deployment, checksum, variables, pasos, razones y errores.
- El límite disponible y otros saldos auditables deben representarse como movimientos, no como números sobrescritos.
- No se acelera automáticamente toda la deuda ante una cuota vencida; la política financiera se modela por calendario y cuota.
- Los registros históricos no se editan silenciosamente; se generan nuevas versiones o eventos.

## Límites actuales

- Las integraciones con buró, KYC, bancos, QR, mensajería, KMS y WORM son puertos preparados, no conexiones productivas terminadas.
- El editor visual requiere endpoint transaccional de escritura del grafo y control `ETag/If-Match`.
- Los umbrales de score, mora, aprobación y override deben ser aprobados por Riesgo; el seed es demostrativo.
- La retención y legal hold deben definirse con Compliance antes de automatizar purgas.
