# Arquitectura event-driven (Outbox transaccional + Bus de eventos)

> Rebanada 1 — cubre la Fase 11 del PROMPT MAESTRO y deja la base de eventos lista para
> las notificaciones (Fase 12) y la ejecución en vivo (Fase 8).

## Por qué un outbox transaccional

El problema clásico de "cambié la base de datos pero no publiqué el evento" (o al revés)
se elimina escribiendo el evento **en la misma transacción Prisma** que el cambio de
negocio. Es exactamente el patrón que ya usa `AuditService.append`: el evento y el cambio
se confirman o revierten juntos, nunca por separado.

```
┌─ Transacción de negocio (governance, deployment, runtime…) ─┐
│  1. UPDATE/INSERT del cambio de dominio                      │
│  2. states.transition(...)                                   │
│  3. audit.append(tx, ...)                                    │
│  4. outboxPublisher.publish(tx, envelope)  ← misma tx        │
│     └─ pg_notify('atlas_jobs', 'outbox-relay')  ← misma tx   │
└─────────────────────────────────────────────────────────────┘
             │ commit atómico
             ▼
   decision_outbox_event (status = PENDING)
             │
             ▼  OutboxRelayService, bajo JobSchedulerService (poll + lease + NOTIFY)
   FOR UPDATE SKIP LOCKED → EventBus.emit → status = DISPATCHED
             │
             ▼  NotificationProjectorService (subscribeAll, solo en el proceso WORKER)
   ProcessedEvent (idempotencia) + decision_notification
```

El relay y el proyector corren en el proceso **WORKER**, no en las réplicas de API — ver
[`docs/worker-orchestration.md`](worker-orchestration.md) para el reparto completo de
trabajos de fondo y el mecanismo de despertar por `LISTEN`/`NOTIFY` que reemplaza el
sondeo fijo por segundo.

## Componentes

| Componente | Archivo | Rol |
|---|---|---|
| `EventEnvelope` | `common/events/event-envelope.ts` | Sobre versionado: eventType, schemaVersion, correlation/causation/actor/tenant, payload. |
| `DecisionEventType` | `common/events/event-types.ts` | Catálogo de tipos de evento + payloads tipados (contrato v1). |
| `OutboxPublisherService` | `common/events/outbox-publisher.service.ts` | `publish(tx, envelope)` — escribe la fila outbox en la tx del llamante. |
| `EventBus` | `common/events/event-bus.ts` | Emisor tipado en proceso (subscribe / subscribeAll / emit). |
| `OutboxRelayService` | `modules/outbox-relay/outbox-relay.service.ts` | Worker: claim con lease → emit → DISPATCHED / backoff / DEAD. |

## El relay (entrega at-least-once)

Misma forma que `TestRunWorkerService`: reclama trabajo con
`UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED) RETURNING`, más un **lease** que
expira. Ya no trae su propio temporizador: el `JobSchedulerService` decide cuándo se
ejecuta un ciclo (`runOnce()`), y `OutboxPublisherService.publish` despierta ese ciclo con
`pg_notify` en la misma transacción que escribe la fila — ver
[`docs/worker-orchestration.md`](worker-orchestration.md). Consecuencias:

- **Sin doble entrega entre réplicas.** `SKIP LOCKED` hace que cada réplica reclame filas
  distintas; si una muere a mitad de lote, su lease expira y las filas vuelven a ser
  reclamables.
- **Reintentos con backoff exponencial.** Un `emit` fallido reprograma la fila con
  `available_at = now() + backoff`. La entrega es *at-least-once*: los consumidores deben
  ser idempotentes.
- **Dead-letter.** Tras `OUTBOX_MAX_ATTEMPTS` intentos la fila pasa a `DEAD` para
  atención del operador (métrica `atlas_outbox_dead_total`).

## Contratos de evento versionados

Cada evento lleva `schemaVersion` (default `'1'`). Un cambio incompatible de payload
**incrementa la versión** en el sobre; nunca se muta la forma v1 existente. Los
productores publican por constante de `DecisionEventType` y los consumidores se suscriben
por la misma constante, de modo que un literal divergente es un error de compilación, no
un pipeline roto en silencio.

## Aislamiento por tenant (RLS)

`decision_outbox_event` y `decision_notification` son tenant-scoped y llevan políticas
RLS espejo de `20260719080000_tenant_rls_and_app_role` (mismo GUC `app.tenant_id`).
`decision_processed_event` es de sistema (sin columna tenant): queda fuera del filtro por
tenant y `atlas_app` accede vía los privilegios por defecto del esquema.

## Configuración

| Variable | Default | Descripción |
|---|---|---|
| `OUTBOX_RELAY_ENABLED` | `true` | Habilita el trabajo de relay. |
| `OUTBOX_RELAY_INTERVAL_MS` | `1000` | Suelo del sondeo (red de seguridad; el `NOTIFY` da la latencia real). |
| `OUTBOX_RELAY_MAX_INTERVAL_MS` | `30000` | Techo del retroceso adaptativo con el outbox vacío. |
| `OUTBOX_BACKLOG_SAMPLE_MS` | `30000` | Cada cuánto se cuenta el backlog para el gauge, ociosa la cola. |
| `OUTBOX_BATCH_SIZE` | `25` | Eventos reclamados por lote. |
| `OUTBOX_MAX_ATTEMPTS` | `8` | Intentos antes de `DEAD`. |
| `OUTBOX_LEASE_MS` | `30000` | Duración del lease de reclamo. |

Las claves `JOB_*` que gobiernan el orquestador (cadencia, backoff, `LISTEN`/`NOTIFY`) se
documentan en [`docs/worker-orchestration.md`](worker-orchestration.md).

## Observabilidad

- `atlas_outbox_pending` (gauge) — backlog PENDING, muestreado cuando el relay está ocioso.
- `atlas_outbox_dispatched_total{event_type}` — eventos entregados.
- `atlas_outbox_dead_total{event_type}` — eventos dead-lettered.
- `atlas_notification_created_total{event_type}` — notificaciones proyectadas.
- `atlas_job_*` — ciclos, duración y despertares del trabajo `outbox-relay` como trabajo de
  fondo genérico (ver worker-orchestration.md). Solo se exponen en `/metrics` del proceso
  WORKER: una réplica de API ya no ejecuta el relay y por tanto nunca las produce.

## Ruta de escalado (fuera de alcance de esta rebanada)

El `EventBus` en proceso es suficiente para el monolito actual. Para escalar horizontalmente
se sustituye el transporte por **Redis Streams** (ioredis ya está en el stack) detrás del
mismo contrato `subscribe`/`emit`: productores y consumidores no cambian. El outbox y la
tabla `ProcessedEvent` siguen siendo la fuente de la verdad y la garantía de idempotencia.
