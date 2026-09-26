# Alertas

## Criterio

Una alerta debe ser **accionable**: si al recibirla no hay nada que hacer, no debe existir.
Alertar sobre síntomas sin acción es la forma más rápida de que el equipo deje de mirar.

## Propuestas

Expresiones PromQL sobre las métricas reales; los umbrales son propuestos y deben acordarse con
el negocio junto a los [objetivos de servicio](service-level-objectives.md).

### Críticas — despiertan a alguien

| Alerta | Expresión | Por qué es crítica |
| --- | --- | --- |
| Decisión caída | `sum(rate(atlas_http_requests_total{route=~"/v1/decisions.*",status=~"5.."}[5m])) / sum(rate(atlas_http_requests_total{route=~"/v1/decisions.*"}[5m])) > 0.05` | El canal de originación no puede decidir |
| Eventos en cola muerta | `increase(atlas_outbox_dead_total[15m]) > 0` | Un cambio de negocio quedó sin notificar; escalar no lo arregla |
| Servicio no listo | `up == 0` o readiness fallando | Dependencia caída |

### Altas — atención en horario

| Alerta | Expresión | Lectura |
| --- | --- | --- |
| Latencia degradada | `histogram_quantile(0.95, sum(rate(atlas_http_request_duration_ms_bucket{route=~"/v1/decisions.*"}[10m])) by (le)) > 250` | p95 fuera de objetivo |
| Backlog del outbox creciente | `deriv(atlas_outbox_pending[30m]) > 0 and atlas_outbox_pending > 100` | El despacho no da abasto → escalar `worker` |
| **Relay detenido** | `rate(atlas_outbox_dispatched_total[15m]) == 0 and atlas_outbox_pending > 0` | **Nadie corre el relay**: revisar `WORKER_ROLE` |
| Proveedor externo fallando | `rate(atlas_provider_failures_total[10m]) > 0.1` | Variables sin resolver |
| Pico de sin-decisión | `rate(atlas_decisions_total{status="NO_DECISION"}[15m]) / rate(atlas_decisions_total[15m]) > 0.05` | Datos o política |
| Pico de denegaciones | `rate(atlas_errors_total{code=~"HTTP_401|HTTP_403"}[10m]) > 1` | Credencial rotada o ensayo de credenciales |

!!! tip "La alerta más valiosa de esta lista"
    «Relay detenido» detecta el fallo más silencioso del sistema: todo desplegado con
    `WORKER_ROLE=API`. La API responde, las decisiones se sirven y las colas crecen sin que nada
    parezca roto.

### Medias — revisar en el día

| Alerta | Expresión |
| --- | --- |
| Contraejemplos de QA | `increase(atlas_qa_counterexamples_total[1h]) > 0` |
| Ciclos de referencia bloqueados | `increase(atlas_blocked_reference_cycles_total[1h]) > 0` |
| Divergencia DEV/PROD | `increase(atlas_dev_prod_result_diff_total{difference!="NONE"}[1h]) > 0` |
| Espera del bloqueo de auditoría | p95 de `atlas_audit_chain_lock_wait_ms` creciente |

## Cuáles están implementadas

Las de esta página eran **propuestas**: expresiones acordadas pero sin nada que las evaluara.
Un subconjunto ya vive como reglas ejecutables en `docker/observability/alerts.yml`, que carga
el Prometheus del perfil `observability`:

| Regla | Cubre |
| --- | --- |
| `AtlasOutboxBacklogGrowing` | `min_over_time(atlas_outbox_pending[10m]) > 500` |
| `AtlasOutboxDeadLetter` | Eventos en cola muerta |
| `AtlasBackgroundJobStalled` | Relay o cualquier trabajo sin éxito en 15 min |
| `AtlasApiErrorRateHigh` | Más del 5 % de 5xx |
| `AtlasApiLatencyP95High` | p95 por encima de 1 s |
| `AtlasTargetDown` | El proceso ni acepta el raspado |

`AtlasOutboxBacklogGrowing` usa `min_over_time` y no el valor instantáneo a propósito: una
ráfaga legítima también sube el pendiente, y lo que se quiere detectar es que el suelo no baja.

`AtlasBackgroundJobStalled` es la que cubre el fallo más silencioso descrito arriba —todo
desplegado con `WORKER_ROLE=API`—, y lo hace sobre
`atlas_job_last_success_timestamp_seconds`, que es una sonda de latido y no un contador: un
contador que deja de crecer es indistinguible de uno que nunca tuvo trabajo.

Levantarlas:

```bash
docker compose -f docker-compose.yml -f compose.observability.yml \
  --profile observability up -d
```

!!! warning "Hay que raspar los DOS procesos"
    `atlas_outbox_*`, `atlas_job_*` y `atlas_notification_created_total` **solo** los produce el
    worker. `prometheus.yml` lo resuelve por DNS en el puerto 3001 para alcanzar todas las
    réplicas; raspar únicamente la API deja el panel del outbox alimentado por un proceso que no
    reparte nada.

    El endpoint acepta el secreto como `X-Metrics-Token` o como `Authorization: Bearer`. El
    segundo portador se añadió porque Prometheus **no** admite cabeceras arbitrarias en un
    `scrape_config`: con solo el primero, la métrica estaba publicada, protegida e inalcanzable
    para el único consumidor previsto.

## Lo que no se alerta por métrica

**La integridad de la cadena de auditoría.** No es un porcentaje: es binaria. Se comprueba con
`GET /v1/audit/chain/verify` en una tarea periódica y un `valid: false` abre un incidente
directamente, sin umbral.

## Al añadir una alerta

1. ¿Qué acción concreta dispara?
2. ¿Qué runbook la acompaña?
3. ¿Puede dispararse por un despliegue normal? Si sí, ajuste la ventana.
4. ¿Su métrica tiene cardinalidad acotada?
