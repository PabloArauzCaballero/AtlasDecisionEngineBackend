# Tableros

Especificación de los tableros a construir sobre las métricas expuestas. La plataforma **no**
incluye definiciones de Grafana: pertenecen al stack de observabilidad de la organización.

## 1. Salud del plano de decisión

Para: operaciones. Responde a «¿está decidiendo bien el sistema ahora mismo?».

| Panel | Consulta | Lectura |
| --- | --- | --- |
| Peticiones por segundo | `sum(rate(atlas_http_requests_total{route=~"/v1/decisions.*"}[5m]))` | Volumen |
| Tasa de error | `5xx / total` sobre la misma ruta | Objetivo < 0,1 % |
| p50/p95/p99 | `histogram_quantile` sobre `atlas_http_request_duration_ms_bucket` | p95 < 250 ms |
| Mezcla de resultados | `sum by (outcome) (rate(atlas_decisions_total[5m]))` | Un cambio brusco sin despliegue = cambio en los datos de entrada |
| Sin-decisión | `rate(atlas_decisions_total{status="NO_DECISION"}[5m])` | Suele indicar proveedor caído |

## 2. Trabajos de fondo

Para: operaciones. Responde a «¿se está drenando lo que se acumula?».

| Panel | Consulta |
| --- | --- |
| Pendientes en el outbox | `atlas_outbox_pending` |
| Ritmo de despacho | `rate(atlas_outbox_dispatched_total[5m])` |
| Eventos muertos | `increase(atlas_outbox_dead_total[1h])` |
| Notificaciones proyectadas | `rate(atlas_notification_created_total[5m])` |

!!! tip "El panel que más ahorra"
    Pendientes **junto a** ritmo de despacho en el mismo eje temporal. Pendientes creciendo con
    despacho a cero significa que ningún proceso corre el relay — el fallo más silencioso del
    reparto de procesos.

## 3. Calidad de datos y contratos

Para: analistas de riesgo y QA.

| Panel | Consulta |
| --- | --- |
| Violaciones de contrato | `rate(atlas_contract_violations_total[15m])` |
| Salidas obligatorias ausentes | `rate(atlas_missing_required_output_total[15m])` |
| Fallos de proveedor | `sum by (provider, reason) (rate(atlas_provider_failures_total[15m]))` |
| Divergencia DEV/PROD | `sum by (artifact_code, difference) (increase(atlas_dev_prod_result_diff_total[1d]))` |

## 4. Motor y ejecución

Para: ingeniería.

| Panel | Consulta |
| --- | --- |
| Duración de campos calculados | p95 de `atlas_calculated_field_duration_ms` |
| Profundidad de cadena | p95 de `atlas_chained_artifact_depth` |
| Ciclos bloqueados | `increase(atlas_blocked_reference_cycles_total[1d])` |
| Espera del bloqueo de auditoría | p95 de `atlas_audit_chain_lock_wait_ms` |

## 5. Taxonomía de errores

`topk(10, sum by (code) (increase(atlas_errors_total[1h])))`.

Un código de dominio que sube sin despliegue de por medio apunta a un cambio en los datos de
entrada, no en el software.

## Convenciones

- Todo panel con umbral debe enlazar su [alerta](alerts.md) y su runbook.
- Marque los despliegues en el eje temporal: la mitad de las anomalías se explican solas.
- No cree paneles por tenant: la cardinalidad haría inviable el almacenamiento.
