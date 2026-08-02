# Métricas

## Exposición

`GET /metrics` en formato Prometheus, **protegido por token** (`METRICS_TOKEN`). En producción
el esquema exige el token si las métricas están activas: `/metrics` revela rutas, volúmenes y
comportamiento interno.

El registro es **por instancia de servicio**, no el global de `prom-client`. Así una segunda
instancia —en pruebas o en un segundo contexto de Nest— no dispara el error de «métrica ya
registrada».

## Catálogo

### HTTP

| Métrica | Tipo | Etiquetas |
| --- | --- | --- |
| `atlas_http_requests_total` | Counter | `method`, `route`, `status` |
| `atlas_http_request_duration_ms` | Histogram | `method`, `route`, `status` |

Los buckets son 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000 ms: densos por debajo de
250 ms, que es donde vive el objetivo de servicio, y gruesos hasta el techo del timeout.

!!! note "Por qué histograma y no un máximo"
    Antes existía un `_max` monótono que solo subía y nunca reflejaba el estado actual. Un
    histograma da p95 y p99 reales por ventana, que es lo que se puede alertar.

### Decisión

| Métrica | Tipo | Etiquetas | Para qué |
| --- | --- | --- | --- |
| `atlas_decisions_total` | Counter | `outcome`, `status` | Volumen y mezcla de resultados |
| `atlas_provider_failures_total` | Counter | `provider`, `reason` | Salud de las variables externas |
| `atlas_errors_total` | Counter | `code` | Taxonomía de errores de dominio |
| `atlas_contract_violations_total` | Counter | — | Entradas que incumplen el contrato |
| `atlas_missing_required_output_total` | Counter | — | Salidas obligatorias no producidas |
| `atlas_intermediate_variable_events_total` | Counter | — | Ciclo de vida de las intermedias |
| `atlas_dev_prod_result_diff_total` | Counter | `artifact_code`, `difference` | Divergencia entre un ambiente y PROD |

`atlas_dev_prod_result_diff_total` cuenta también los `NONE`: sin denominador, la tasa de
divergencia no se puede leer.

### Campos calculados y cadenas

| Métrica | Tipo |
| --- | --- |
| `atlas_calculated_field_executions_total` | Counter |
| `atlas_calculated_field_duration_ms` | Histogram |
| `atlas_chained_artifact_depth` | Histogram |
| `atlas_blocked_reference_cycles_total` | Counter |

### Mensajería

| Métrica | Tipo | Lectura |
| --- | --- | --- |
| `atlas_outbox_pending` | Gauge | Creciente sostenido = el despacho no da abasto |
| `atlas_outbox_dispatched_total` | Counter | Plano con `pending` creciente = nadie corre el relay |
| `atlas_outbox_dead_total` | Counter | `> 0` requiere una persona |
| `atlas_notification_created_total` | Counter | Proyección a la bandeja |

### QA y auditoría

| Métrica | Tipo |
| --- | --- |
| `atlas_qa_generated_cases_total` | Counter |
| `atlas_qa_counterexamples_total` | Counter |
| `atlas_audit_chain_lock_wait_ms` | Histogram |

### Proceso

`atlas_process_uptime_seconds` (Gauge).

## Convención para métricas nuevas

`atlas_<dominio>_<evento>_total` para contadores; gauge para estado; histograma para duración.
Las etiquetas deben tener **cardinalidad acotada**: nunca un identificador de tenant, de
ejecución ni de usuario — cada valor distinto crea una serie temporal nueva y hace inviable el
almacenamiento.

Ver [alertas](alerts.md) y [objetivos de nivel de servicio](service-level-objectives.md).
