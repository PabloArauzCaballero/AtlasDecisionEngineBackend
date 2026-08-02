# Mapa de integraciones

Todo lo que este backend consume o expone hacia fuera, con su modo de fallo.

## Salientes

| Integración | Protocolo | Configuración | Timeout | Si falla |
| --- | --- | --- | --- | --- |
| Proveedor de identidad (AtlasBackend) | HTTPS | `IDENTITY_PROVIDER_URL` | `IDENTITY_PROVIDER_TIMEOUT_MS` | El portal no autentica. **Reintenta solo ante fallo transitorio** (red, timeout, 502/503/504); jamás ante credencial rechazada |
| Proveedor de variables | HTTPS | `VARIABLE_BACKEND_URL` | `VARIABLE_BACKEND_TIMEOUT_MS` | La variable queda `UNRESOLVED`; el contrato decide si la decisión sigue o falla cerrado. Se cuenta en `atlas_provider_failures_total` |
| JWKS | HTTPS | `JWT_JWKS_URL` | `JWT_JWKS_TIMEOUT_MS` | No se pueden verificar tokens nuevos; la caché (`JWT_JWKS_CACHE_SECONDS`) da margen |
| Colector OpenTelemetry | OTLP/HTTP | `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | del SDK | Se pierden trazas; nada más cambia |
| Sidecar de scripts | HTTP sobre socket Unix | `SCRIPT_RUNNER_SOCKET_PATH` | `SCRIPT_NODE_TIMEOUT_MS` | `SCRIPT_RUNNER_UNAVAILABLE` (503, reintentable) |

!!! important "Por qué el reintento del proveedor de identidad distingue el tipo de fallo"
    Reintentar una credencial rechazada multiplicaría los intentos fallidos de un atacante y
    dispararía el bloqueo de la cuenta del usuario legítimo. Solo se reintenta lo que puede
    resolverse solo: un corte de red o un reinicio del proveedor.

## Entrantes

| Consumidor | Cómo autentica | Qué usa |
| --- | --- | --- |
| Portal del analista | Sesión contra el proveedor de identidad, cookie de refresco | Toda la API de gestión |
| Canal de originación | API key (`x-api-key`) o JWT | `POST /v1/decisions/{artifactCode}` |
| Prometheus | Token en `METRICS_TOKEN` | `GET /metrics` |
| Orquestador de contenedores | Sin credencial | `/health/live`, `/health/ready` |

## Dependencias de infraestructura

| Dependencia | Obligatoria | Degradación |
| --- | --- | --- |
| PostgreSQL | **sí** | Sin ella no hay arranque ni readiness |
| Redis | en producción **sí** | Fuera de producción cae a caché en memoria; en producción el arranque se rechaza, porque idempotencia y límite de tasa serían inconsistentes entre réplicas |

## Contratos de integración

- **HTTP**: contrato OpenAPI en `openapi/openapi.json`, referencia interactiva en `/docs/{API_VERSION}/reference`.
- **Eventos**: `asyncapi/asyncapi.yaml` y el [catálogo de eventos](../events/event-catalog.md).
- **Base de datos**: el esquema de Prisma es la fuente; el [catálogo de entidades](../data/entity-catalog.md) se genera de él.

## Lo que deliberadamente no se integra

- **Sin broker externo.** El outbox despacha a un bus en proceso. Un broker resolvería un problema que este sistema aún no tiene y añadiría un modo de fallo.
- **Sin llamadas salientes desde el código importado.** El sidecar corre `network_mode: none`; un script no puede exfiltrar nada aunque lo intente.
