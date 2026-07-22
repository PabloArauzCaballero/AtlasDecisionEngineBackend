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
└─────────────────────────────────────────────────────────────┘
             │ commit atómico
             ▼
   decision_outbox_event (status = PENDING)
             │
             ▼  OutboxRelayService (poll + lease)
   FOR UPDATE SKIP LOCKED → EventBus.emit → status = DISPATCHED
             │
             ▼  NotificationProjectorService (subscribeAll)
   ProcessedEvent (idempotencia) + decision_notification
```

## Componentes

| Componente | Archivo | Rol |
|---|---|---|
| `EventEnvelope` | `common/events/event-envelope.ts` | Sobre versionado: eventType, schemaVersion, correlation/causation/actor/tenant, payload. |
| `DecisionEventType` | `common/events/event-types.ts` | Catálogo de tipos de evento + payloads tipados (contrato v1). |
| `OutboxPublisherService` | `common/events/outbox-publisher.service.ts` | `publish(tx, envelope)` — escribe la fila outbox en la tx del llamante. |
| `EventBus` | `common/events/event-bus.ts` | Emisor tipado en proceso (subscribe / subscribeAll / emit). |
| `OutboxRelayService` | `modules/outbox-relay/outbox-relay.service.ts` | Worker: claim con lease → emit → DISPATCHED / backoff / DEAD. |

## El relay (entrega at-least-once)

Misma forma que `TestRunWorkerService`: un bucle de sondeo que reclama trabajo con
`UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED) RETURNING`, más un **lease** que
expira. Consecuencias:

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
| `OUTBOX_RELAY_ENABLED` | `true` | Habilita el worker de relay. |
| `OUTBOX_RELAY_INTERVAL_MS` | `1000` | Intervalo de sondeo. |
| `OUTBOX_BATCH_SIZE` | `25` | Eventos reclamados por lote. |
| `OUTBOX_MAX_ATTEMPTS` | `8` | Intentos antes de `DEAD`. |
| `OUTBOX_LEASE_MS` | `30000` | Duración del lease de reclamo. |

## Observabilidad

- `atlas_outbox_pending` (gauge) — backlog PENDING, muestreado en cada poll.
- `atlas_outbox_dispatched_total{event_type}` — eventos entregados.
- `atlas_outbox_dead_total{event_type}` — eventos dead-lettered.
- `atlas_notification_created_total{event_type}` — notificaciones proyectadas.

## Ruta de escalado (fuera de alcance de esta rebanada)

El `EventBus` en proceso es suficiente para el monolito actual. Para escalar horizontalmente
se sustituye el transporte por **Redis Streams** (ioredis ya está en el stack) detrás del
mismo contrato `subscribe`/`emit`: productores y consumidores no cambian. El outbox y la
tabla `ProcessedEvent` siguen siendo la fuente de la verdad y la garantía de idempotencia.
