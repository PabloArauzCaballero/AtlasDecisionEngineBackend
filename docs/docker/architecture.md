# Arquitectura de contenedores

Inventario de servicios, redes, puertos, volúmenes y riesgos del despliegue en contenedores.
Complementa `docs/ARCHITECTURE.md`, que describe la arquitectura del software; aquí se
describe **dónde se ejecuta** cada cosa.

## Alcance: qué NO está en este repositorio

Antes del inventario, para que no se lea como si faltaran piezas:

- **Frontend.** El portal es un proyecto de Compose aparte (imagen `atlas-decision-frontend`).
  No se dockeriza desde aquí; la variable `CORS_ALLOWED_ORIGINS` de la API declara los orígenes
  que se le admiten.
- **Proveedor de identidad.** `AtlasBackend` es otro despliegue, alcanzable por
  `IDENTITY_PROVIDER_URL`. Con `AUTH_MODE=IDENTITY_HYBRID`, la API valida contra él las
  sesiones del portal mientras las integraciones técnicas siguen con clave de API.
- **Proxy inverso y TLS.** La terminación TLS es responsabilidad de la plataforma de despliegue
  (Coolify/Traefik en el destino actual), no de este Compose. Añadir aquí un nginx duplicaría
  una función que la plataforma ya presta y crearía dos sitios donde configurar certificados.

## Inventario de servicios

Clasificación según la taxonomía de la Fase 1 de la auditoría.

| Servicio | Clasificación | Responsabilidad | Criticidad |
| --- | --- | --- | --- |
| `api` | Contenedor propio, proceso persistente | Sirve la API de gestión y de runtime de decisiones | **Crítica** |
| `worker` | Contenedor propio, proceso persistente | Relay del outbox, corridas de prueba, purga, workers semántico y de extractos | **Crítica** |
| `postgres` | Contenedor propio, proceso persistente | Estado de negocio, outbox y cadena de auditoría | **Crítica** |
| `redis` | Contenedor propio, proceso persistente | Caché por tenant, límites de tasa, idempotencia | Alta |
| `script-runner` | Sidecar aislado, proceso persistente | Ejecuta código importado por analistas, fuera del proceso de la API | **Crítica (seguridad)** |
| `migrate` | Tarea puntual | Aplica migraciones versionadas | **Crítica** |
| `bootstrap-app-role` | Tarea puntual | Da contraseña al rol no superusuario `atlas_app` | **Crítica** |
| `seed` | Tarea puntual | Siembra idempotente del catálogo de arranque | Media |
| `smoke` | Tarea puntual, perfil `tools` | Verifica una instancia viva desde dentro de la red | Media |
| `docs` / `docs-serve` | Tarea puntual / auxiliar, perfil `docs` | Construye y sirve el portal MkDocs | Baja |
| `prometheus`, `grafana` | Auxiliares, perfil `observability` | Recogen y muestran métricas | Media |
| `jaeger` | Auxiliar, fichero propio (`yarn jaeger:up`) | Destino OTLP de las trazas en desarrollo | Media |
| `postgres-test`, `redis-test`, `migrate-test`, `integration`, `e2e` | `compose.test.yml` | Batería de pruebas aislada | Media |

**Ningún proceso relevante queda sin ubicación declarada.** Los dos procesos de negocio (`api`
y `worker`) comparten imagen base a propósito: son el mismo `AppModule` con distinto arranque
(ADR-0021), y construir dos imágenes permitiría desplegar una con código más viejo que la otra.

## Redes

Antes de esta auditoría **no había ninguna red declarada**: Compose creaba la red `default` y
todos los servicios compartían el mismo dominio de difusión, de modo que cualquier contenedor
del proyecto podía abrir una conexión a PostgreSQL o a Redis.

| Red | Miembros | Propósito |
| --- | --- | --- |
| `atlas_app` | `api`, `worker`, `smoke`, `prometheus`, `grafana`, `jaeger` | Plano de aplicación. Da salida a Internet (el worker semántico llama a proveedores externos). |
| `atlas_data` | `postgres`, `redis`, `api`, `worker`, `migrate`, `bootstrap-app-role`, `seed` | Plano de datos. |
| — (`network_mode: none`) | `script-runner` | Sin red en absoluto. Se alcanza solo por socket Unix sobre volumen compartido. |

Consecuencias comprobables:

- `smoke` está en `atlas_app` pero **no** en `atlas_data`: ejerce la API por HTTP y no puede
  abrir una conexión a la base de datos para «comprobar» nada por detrás.
- `postgres` y `redis` no están en `atlas_app`: ningún servicio auxiliar los alcanza.
- En **producción** (`docker-compose.prod.yml`) se retiran además las publicaciones de puerto
  de `postgres` y `redis`; en desarrollo se mantienen en `127.0.0.1` para poder abrir psql.

## Matriz de puertos

| Servicio | Puerto interno | Publicado en desarrollo | Publicado en producción |
| --- | --- | --- | --- |
| `api` | 3000 | `127.0.0.1:3000` | — (lo expone el proxy de la plataforma) |
| `worker` | 3001 (sondas + `/metrics`) | `127.0.0.1:3001` | — |
| `postgres` | 5432 | `127.0.0.1:5432` | **no publicado** |
| `redis` | 6379 | `127.0.0.1:6379` | **no publicado** |
| `script-runner` | — (socket Unix) | — | — |
| `prometheus` | 9090 | `127.0.0.1:9090` | — |
| `grafana` | 3000 | `127.0.0.1:3300` | — |
| `jaeger` | 16686 (UI), 4318/4317 (OTLP) | `127.0.0.1:16686`, `127.0.0.1:4318`, `127.0.0.1:4317` | — (topología aparte) |
| `docs-serve` | 8000 | `127.0.0.1:8000` | — |

Ninguna publicación usa `0.0.0.0`. Todas están atadas a loopback, de modo que un portátil en
una red compartida no expone la base de datos de decisiones a la sala.

## Matriz de volúmenes

| Volumen | Servicio | Contenido | Se pierde si… |
| --- | --- | --- | --- |
| `atlas_decision_pg` | `postgres` | Datos de negocio, outbox, auditoría | `docker compose down -v`. **Restaurable** desde `scripts/backup.sh` |
| `atlas_decision_redis` | `redis` | AOF de caché e idempotencia | `down -v`. Pérdida asumible: se repuebla solo |
| `atlas_runner_socket` | `script-runner`, `api` (ro) | Socket Unix del sidecar | Se recrea al arrancar |
| `atlas_prometheus` | `prometheus` | Series temporales (15 días) | `down -v`. Pérdida asumible |
| `atlas_grafana` | `grafana` | Paneles y usuarios | `down -v`. El origen de datos se reaprovisiona solo |

`compose.test.yml` **no declara ningún volumen**: usa `tmpfs`, de modo que una corrida de
pruebas no puede dejar estado detrás ni pisar la base de desarrollo.

## Matriz de dependencias de arranque

Todas por `condition: service_healthy` o `service_completed_successfully` — ningún `sleep`
arbitrario, ningún `depends_on` desnudo.

```
postgres (healthy)
   └── migrate (completed)
         ├── bootstrap-app-role (completed)
         └── seed (completed)
               └── api      ← también redis (healthy) y script-runner (started)
               └── worker   ← también redis (healthy)
                     └── smoke ← api (healthy)
```

El orden importa por una razón de seguridad y no de comodidad: `migrate` y `seed` conectan como
el superusuario `atlas`, mientras que `api` y `worker` conectan como `atlas_app`, que **no** es
superusuario. La RLS por tenant es inerte para una conexión de superusuario, así que los
procesos que sirven tráfico nunca deben usar esa credencial.

## Matriz de variables de entorno por sensibilidad

Catálogo completo y documentado en `.env.example`. Clasificación:

| Clase | Ejemplos | Tratamiento |
| --- | --- | --- |
| **Secreta** | `POSTGRES_PASSWORD`, `APP_DB_PASSWORD`, `MANAGEMENT_API_KEY`, `RUNTIME_API_KEY`, `AUDIT_HASH_SECRET`, `METRICS_TOKEN`, `GRAFANA_ADMIN_PASSWORD` | Sin valor por defecto en Compose (`:?` obliga a definirlas). Nunca en una capa de imagen. En producción, secretos de la plataforma |
| **Sensible** | `DATABASE_URL`, `REDIS_URL`, `IDENTITY_PROVIDER_URL` | Configuración de entorno; contienen credenciales compuestas |
| **Interna** | `DATABASE_POOL_MAX`, `JOB_*`, `OUTBOX_MAX_ATTEMPTS`, `RUNNER_MAX_CONCURRENCY` | Ajuste operativo, con valores por defecto seguros |
| **Pública** | `BUILD_VERSION`, `COMMIT_SHA`, `OTEL_SERVICE_NAME` | Aparecen en respuestas de sonda y en métricas |
| **Específica de entorno** | `NODE_ENV`, `AUTH_MODE`, `SWAGGER_ENABLED`, `LOG_LEVEL` | El esquema de entorno impone restricciones en `production` |

El esquema (`src/common/config/env.schema.ts`) **rechaza los valores de ejemplo en
producción**, de modo que arrancar con un `.env` copiado de `.env.example` falla al validar en
vez de arrancar con una credencial conocida.

Ninguna variable llega por `ARG` de construcción: un `ARG` queda en el historial de capas y se
lee con `docker history`.

## Riesgos registrados

Riesgos vivos tras esta auditoría, con su mitigación o su estado.

| # | Riesgo | Impacto | Estado |
| --- | --- | --- | --- |
| R1 | **Dos copias de `@opentelemetry/instrumentation`** (0.220 y 0.221) en el árbol. `instrumentation-undici@0.31` exigía `^0.221`; el resto fija `^0.220`, y `^` no cruza la minor en 0.x | Rompió la construcción de la imagen: `yarn build` pasaba en un `node_modules` incremental y fallaba en una instalación limpia desde el lockfile | **RESUELTO.** `instrumentation-undici` fijado en `^0.30`, que depende de `^0.220` como el resto: el árbol vuelve a tener UNA copia (verificado). Los tipos de los hooks quedan anotados igualmente, para que la divergencia no pueda volver a romper la imagen si reaparece al subir versiones |
| R2 | `decision_outbox_event` no se purga. Las filas `DISPATCHED` se acumulan | Crecimiento sin cota de la tabla y de sus índices; degradación progresiva del reparto | **Abierto.** La purga existente cubre idempotencia de runtime, no el outbox |
| R3 | `decision_processed_event` tampoco se purga | Igual que R2 | **Abierto.** La purga debe conservar la marca más tiempo que el horizonte máximo de reintento |
| R4 | El repartidor no distingue error transitorio de permanente | Un payload irreparable gasta los 8 intentos antes de morir | **Aceptado.** Ineficiencia, no fallo de corrección: el final es el mismo y la fila queda visible en la DLQ |
| R5 | Sin ordenación garantizada por agregado (`SKIP LOCKED` con N réplicas) | Dos eventos del mismo agregado pueden procesarse en desorden | **Aceptado.** Hoy ningún consumidor depende del orden. Si alguno llegara a depender, particionar por `aggregate_id` |
| R6 | `runtime: runsc` (gVisor) no está registrado en el anfitrión de desarrollo | El sidecar de scripts corre bajo `runc`, que **no** es una frontera de seguridad del sistema operativo | **Mitigado en desarrollo**: `docker-compose.no-gvisor.yml` lo hace explícito y `SCRIPT_NODES_ENABLED` sigue en `false`. **Obligatorio en producción** |
| R7 | `traceId` no se persiste en la fila del outbox | No se puede enlazar el span de producción con el de consumo en el sistema de trazas | **Abierto.** La correlación funcional sí existe vía `correlation_id` |
| R8 | Sin réplica de PostgreSQL | Un fallo del volumen implica restaurar desde la última copia (RPO = intervalo de copia) | **Aceptado** para la escala actual. Ver ADR-0024 (SLO/RTO/RPO) |

## Referencias

- Decisión de mensajería: [ADR-0027](../adr/ADR-0027-messaging-technology-selection.md)
- Topología y contrato de mensajes: [arquitectura event-driven](../event-driven-architecture.md)
- Separación de roles API/worker: [ADR-0021](../adr/ADR-0021-worker-role-separation.md)
- Puesta en marcha: [entorno local](../getting-started/local-setup.md)
- Despliegue y reversión: [despliegue](../operations/deployment.md),
  [reversión](../operations/rollback.md)
- Copias y recuperación: [recuperación ante desastres](../operations/disaster-recovery.md)
- Objetivos de servicio: [ADR-0024](../adr/ADR-0024-slo-rto-rpo-adoption.md)
