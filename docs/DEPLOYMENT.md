# Despliegue

Este documento existe para que una entrega técnica no se confunda con una autorización de
negocio para operar decisiones reales. En el sistema fija el orden de migración, credenciales,
aislamiento, configuración y verificación que conserva RLS, auditoría y disponibilidad.

Dos cargas de trabajo comparten la misma imagen: `api` (decide, `WORKER_ROLE=API`) y `worker`
(trabajos de fondo, `WORKER_ROLE=WORKER`) — ver
[`docs/worker-orchestration.md`](worker-orchestration.md) para el reparto completo, el
orquestador central y por qué la siembra y la proyección de notificaciones se movieron al
proceso `worker`.

## Desarrollo local

Copie `.env.example` a `.env`. Para ejecutar sin un proveedor de identidad local, use:

```env
AUTH_MODE=API_KEY
```

Inicie las dependencias:

```bash
docker compose up -d postgres redis
```

Prepare la base y la aplicación:

```bash
yarn install --frozen-lockfile
yarn prisma:generate
yarn prisma:migrate
yarn prisma:seed
yarn start:dev
```

El seed registra las claves bootstrap en el catálogo de clientes de integración. Si cambia `MANAGEMENT_API_KEY`, `RUNTIME_API_KEY`, `BOOTSTRAP_TENANT_ID` o los scopes, vuelva a ejecutar el seed.

## Contenedores

La imagen ofrece targets separados:

```bash
docker build --target runtime -t atlas-decision-engine:2.0.0 .        # API (dist/main.js)
docker build --target worker -t atlas-decision-worker:2.0.0 .         # Trabajos de fondo (dist/worker.js)
docker build --target migrator -t atlas-decision-migrator:2.0.0 .
docker build --target script-runner -t atlas-decision-script-runner:2.0.0 .
docker build --target smoke -t atlas-decision-smoke:2.0.0 .           # yarn smoke en contenedor
```

`runtime` y `worker` comparten binario y dependencias — son el mismo `AppModule` con distinto
arranque y distinto `WORKER_ROLE` — para que nunca se despliegue una réplica de fondo con
código más viejo que la de decisión. Ninguna de las dos contiene Prisma CLI ni ejecuta
migraciones durante el arranque.

`docker compose up -d` levanta la topología completa de un solo host: `postgres`, `redis`,
`migrate` → `bootstrap-app-role` → `seed` (siembra de un solo disparo, ya no un perfil
opcional) → `api` + `worker` + `script-runner`. Para producción, superponga
`docker-compose.prod.yml` (rotación de logs, `restart: always`, cotas de CPU/memoria):

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --scale api=3 --scale worker=2
```

El worker escala aparte de la API — los tres trabajos de fondo reclaman su carga con
`FOR UPDATE SKIP LOCKED` más un lease, así que N réplicas no duplican nada — y su pool de
conexiones (`DATABASE_POOL_MAX`) se mantiene deliberadamente pequeño porque su concurrencia
la fijan sus trabajos, no el tráfico. Ver
[`docs/worker-orchestration.md`](worker-orchestration.md) para el detalle del orquestador.

El servicio `script-runner` de Compose usa `runtime: runsc`. Un host sin gVisor puede trabajar con la API local y `SCRIPT_NODES_ENABLED=false`; la ejecución de scripts no debe habilitarse en producción sin el aislamiento descrito en `CONFIGURABLE_OUTPUTS.md`. Si además necesita que `script-runner` arranque en Compose en una máquina sin gVisor (Docker Desktop típico en Windows/macOS), superponga `docker-compose.no-gvisor.yml` — **solo desarrollo local**, nunca en un ambiente compartido: sustituye `runsc` por `runc` y con ello el sidecar deja de tener el aislamiento de kernel que la documentación de seguridad asume.

```bash
docker compose -f docker-compose.yml -f docker-compose.no-gvisor.yml up -d
```

## Producción

Orden recomendado:

1. Construir imágenes inmutables etiquetadas con versión y commit.
2. Ejecutar `prisma migrate deploy` con el target `migrator`, conectado con un rol
   administrador/superusuario (`ADMIN_DATABASE_URL` o el `DATABASE_URL` de ese Job).
3. Ejecutar `node scripts/set-app-db-role.mjs` (target `migrator`, mismo rol admin) para fijar
   la contraseña del rol `atlas_app` desde el secret manager. **Obligatorio**: la política RLS
   por tenant (migración `20260719080000_tenant_rls_and_app_role`) queda inerte si la API se
   conecta como superusuario — un superusuario ignora RLS sin importar las políticas definidas.
4. Provisionar clientes técnicos mediante un proceso controlado si el modo híbrido los necesita.
5. Desplegar la API con `DATABASE_URL` apuntando a `atlas_app` (nunca al rol admin/`atlas`) y
   `AUTH_MODE=JWT`, `HYBRID`, `IDENTITY_PROVIDER` o `IDENTITY_HYBRID`.
6. Verificar `/health/live`, `/health/ready`, métricas y smoke tests.
7. Habilitar tráfico gradualmente.

Requisitos:

- secretos desde un secret manager, nunca desde Git o ConfigMap;
- **el `DATABASE_URL` de la API debe usar el rol `atlas_app`, no el rol admin usado por
  `migrate`/`seed`** — de lo contrario RLS no aplica y el aislamiento por tenant depende
  solo del código de aplicación;
- JWKS, IdP y proveedores externos por HTTPS;
- PostgreSQL y Redis privados con TLS, backups y monitoreo;
- al menos dos réplicas, PDB, anti-affinity, HPA y NetworkPolicy;
- `LOG_OUTPUT=stdout`, salvo que exista un volumen escribible administrado;
- Swagger deshabilitado y `LOG_LEVEL` distinto de debug/verbose.

### Variables que requieren una decisión explícita

| Variable | Justificación de negocio | Efecto de sistema |
|---|---|---|
| `AUDIT_HASH_KEY_ID` / `AUDIT_HASH_PREVIOUS_SECRETS` | Conservan verificable el historial durante una rotación de claves. | Identifican la clave HMAC activa y permiten validar eventos antiguos sin volver a firmarlos. |
| `ACCESS_AUDIT_QUEUE_MAX` / `ACCESS_AUDIT_RETRY_SECONDS` | Evitan perder denegaciones durante una caída breve sin permitir consumo ilimitado de memoria. | Acotan y reintentan el buffer local de 401/403/429; para durabilidad entre reinicios se requiere un sink externo. |
| `AUDIT_VERIFY_BATCH_SIZE` | Permite verificar cadenas extensas sin degradar el servicio. | Limita cada lectura del historial append-only y mantiene memoria acotada. |
| `NESTED_TREE_MAX_DEPTH` / `NESTED_TREE_DEFAULT_TIMEOUT_MS` | Acotan el costo y la latencia de políticas compuestas. | Detienen recursión o subárboles que exceden el presupuesto. |
| `CODE_IMPORT_MAX_SOURCE_BYTES` / `CODE_IMPORT_ANALYSIS_TIMEOUT_MS` | Evitan que una carga de autor bloquee el portal. | Limitan memoria y tiempo del analizador estático. |
| `LIVE_EXECUTION_STREAM_ENABLED` | La previsualización no es evidencia regulatoria y debe ser una decisión consciente. | Habilita SSE sólo para ambientes no productivos (DEV/STAGING/TEST); el valor seguro por defecto es `false`. |
| `LIVE_EXECUTION_STREAM_HEARTBEAT_MS` | Mantiene una sesión de diagnóstico visible detrás de proxies. | Emite heartbeats sin convertir la previsualización en una ejecución persistida. |
| `STARTUP_SEED_ENABLED` | Impide crear datos demostrativos de forma accidental. | Debe fijarse en `false` en producción; la provisión se ejecuta por jobs controlados. Solo tiene efecto en procesos con `WORKER_ROLE` ∈ `ALL`, `WORKER` — una réplica de API nunca siembra. |
| `JOB_WAKE_ENABLED` | Determina si el trabajo de fondo arranca a la latencia del commit o a la del sondeo. | En `true` (default) requiere que la conexión a Postgres propague `LISTEN`/`NOTIFY`; un `pgbouncer` en modo `transaction`/`statement` no lo hace, así que ese despliegue debe ponerlo en `false` y confiar solo en el sondeo. |

La aplicación valida el entorno al arrancar y `yarn production:config:check` permite aplicar la
misma validación a una configuración de release. Las cadenas de ejemplo de `.env.example` son
rechazadas en producción incluso cuando conservan su sufijo descriptivo.

Los manifiestos de `deploy/kubernetes` son referencias. Deben adaptarse a registry, ingress, TLS, secret manager, namespaces, límites de red y estándares de observabilidad de la plataforma.
