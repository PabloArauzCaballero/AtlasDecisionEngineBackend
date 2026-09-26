<!-- GENERADO POR scripts/load-test.sh — no editar a mano. -->

# Capacidad del repartidor — ejecución

Generado por `./scripts/load-test.sh` contra `compose.resilience.yml`, un proyecto de
Compose aislado. Latencia medida sobre `dispatched_at - occurred_at`, que el motor ya
persiste; el tiempo total incluye el arranque de las réplicas.

| Réplicas | Eventos | Drenaje | Throughput | p50 | p95 | p99 | Integridad |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 3000 | 52143 ms | 57 ev/s | 37508 ms | 49737 ms | 51236 ms | ok |
| 2 | 3000 | 50653 ms | 59 ev/s | 39517 ms | 49483 ms | 50093 ms | ok |
| 3 | 3000 | 46955 ms | 63 ev/s | 37374 ms | 44944 ms | 45994 ms | ok |

**Integridad `ok`** significa que se repartieron exactamente los eventos encolados y se
produjo exactamente una notificación por evento: capacidad sin duplicar trabajo.
