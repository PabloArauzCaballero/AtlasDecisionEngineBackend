<!-- GENERADO POR scripts/docs/generate-catalogs.mjs — NO EDITAR A MANO.
     Fuente: src/common/events/event-types.ts y src/. Ejecute `yarn docs:catalog` tras cambiar el código. -->

# Catálogo de eventos de dominio

6 tipos de evento versionados. Todo evento se escribe en la MISMA transacción
que el cambio de negocio que lo produce (outbox transaccional) y se despacha después; ver
[semántica de entrega](delivery-semantics.md).

Romper la forma de un payload significa **subir `schemaVersion` en el sobre**, nunca mutar
el tipo existente: hay consumidores que ya procesaron eventos con la forma anterior y la
auditoría los conserva.

| Evento | Constante | Productor | Consumidor |
| --- | --- | --- | --- |
| `version.submitted_for_review` | `DecisionEventType.VERSION_SUBMITTED_FOR_REVIEW` | `src/modules/governance/governance.service.ts` | `src/modules/notifications/notification-projector.service.ts` |
| `version.changes_requested` | `DecisionEventType.VERSION_CHANGES_REQUESTED` | `src/modules/governance/governance.service.ts` | `src/modules/notifications/notification-projector.service.ts` |
| `version.approved` | `DecisionEventType.VERSION_APPROVED` | `src/modules/governance/governance.service.ts` | `src/modules/notifications/notification-projector.service.ts` |
| `version.rejected` | `DecisionEventType.VERSION_REJECTED` | `src/modules/governance/governance.service.ts` | `src/modules/notifications/notification-projector.service.ts` |
| `version.published` | `DecisionEventType.VERSION_PUBLISHED` | — | `src/modules/notifications/notification-projector.service.ts` |
| `security.risk_detected` | `DecisionEventType.SECURITY_RISK_DETECTED` | — | `src/modules/notifications/notification-projector.service.ts` |

