# Escalado

## Dos ejes independientes

Separar la API del worker existe precisamente para poder escalarlos por separado.

| Carga | Escala con | Señal | Límite práctico |
| --- | --- | --- | --- |
| `api` | Peticiones por segundo y p95 | `atlas_http_request_duration_ms` | Conexiones a PostgreSQL |
| `worker` | Profundidad de cola | `atlas_outbox_pending`, corridas en `QUEUED` | Conexiones y CPU |

Antes de la separación, escalar el plano de decisión multiplicaba la carga de fondo, que
competía por el mismo pool justo en las réplicas sensibles a latencia.

## El techo real: el pool de conexiones

`DATABASE_POOL_MAX` (15) es **por réplica**. El total es
`(réplicas_api + réplicas_worker) × DATABASE_POOL_MAX` y debe caber en `max_connections` de
PostgreSQL con margen para migraciones y operación.

!!! warning "Escalar réplicas sin mirar el pool agota la base"
    Es el modo de fallo más común al escalar horizontalmente: 20 réplicas × 15 = 300
    conexiones. Si el motor admite 200, las réplicas nuevas no arrancan y las existentes empiezan
    a fallar. Ajuste `DATABASE_POOL_MAX` a la baja al subir réplicas, o introduzca un pooler.

## Escalar la API

- Sin estado: cualquier réplica atiende cualquier petición.
- Idempotencia y límite de tasa están en Redis, así que se comportan igual con 1 o con N réplicas — **por eso producción exige Redis**.
- HPA por CPU y por latencia. Considere `maxSurge: 1` y `maxUnavailable: 0` para no perder capacidad durante el rollout.

## Escalar el worker

Los tres trabajos reclaman su carga con `FOR UPDATE SKIP LOCKED` más un lease, así que N
réplicas **no duplican trabajo**.

```bash
docker compose up --scale worker=3 -d
kubectl scale deployment/atlas-decision-worker --replicas=3
```

Ajustes finos antes de añadir réplicas:

| Variable | Efecto |
| --- | --- |
| `OUTBOX_BATCH_SIZE` | Más eventos por ciclo |
| `OUTBOX_RELAY_INTERVAL_MS` | Ciclos más frecuentes |
| `TEST_RUN_WORKER_CONCURRENCY` | Corridas simultáneas por réplica |
| `TEST_CASE_CONCURRENCY` | Casos simultáneos por corrida |

Suele ser más barato subir el lote que añadir una réplica: cada réplica cuesta un pool de
conexiones entero.

## Escalar el sidecar de scripts

`RUNNER_MAX_CONCURRENCY` (4) y `RUNNER_MAX_QUEUE` (64) están deliberadamente **por debajo** de
`pids_limit` (64) y de la cuota de CPU del contenedor: cada intérprete cuesta varios pids.

Subirlos sin subir también los límites del contenedor cambia un `503` honesto por thrashing.
El `503 SCRIPT_RUNNER_BUSY` es admisión, no avería, y la API lo trata como transitorio.

## Lo que no escala horizontalmente

- **PostgreSQL**: escala vertical y réplicas de lectura. Ninguna consulta del camino de decisión está dirigida hoy a una réplica.
- **La verificación de la cadena de auditoría**: es secuencial por tenant, por definición.

## Antes de escalar, mida

Un p95 alto con CPU baja no se arregla con réplicas: suele ser una consulta sin índice, un
proveedor externo lento o una cadena de artefactos larga. Mire primero las trazas.
