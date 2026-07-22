# Bandeja de notificaciones

> Rebanada 1 — Fase 12 del PROMPT MAESTRO. Backend persistente + API + generación
> **desde eventos** (nunca desde controladores), conectada al centro de notificaciones ya
> existente del frontend.

## Principio de diseño: generar desde eventos

Las notificaciones **solo** las produce `NotificationProjectorService`, suscrito al
`EventBus`. Ningún controlador crea notificaciones directamente. Así la bandeja es
completa y reproducible por construcción: todo lo que merece avisar a un usuario primero
es un evento publicado en el outbox.

## Destinatarios por rol, no por usuario

Los usuarios viven en el proveedor de identidad externo (`:3001`), no en esta base de
datos. Por eso una notificación se dirige a:

- `recipientRole` (+ `tenantId`) — una cola por rol (p. ej. `QA_ANALYST`), o
- `recipientId` — un principal concreto (p. ej. el autor de la versión).

La bandeja de un usuario devuelve lo que coincide con **sus roles** o su `recipientId`. La
autorización vive en la consulta (`recipientWhere`), construida desde el principal
autenticado en el servidor — nunca desde entrada del cliente. Ocultar botones no es
autorización.

## Reglas de proyección (v1)

| Evento | Destinatario | Categoría |
|---|---|---|
| `version.submitted_for_review` | un aviso por cada `reviewerRole` requerido | GOVERNANCE |
| `version.changes_requested` | autor (`recipientId`) | GOVERNANCE |
| `version.approved` | autor (`recipientId`) — solo al aprobarse el último paso | GOVERNANCE |
| `version.rejected` | autor (`recipientId`), prioridad HIGH | GOVERNANCE |
| `version.published` | rol `OPERATIONS` | DEPLOYMENT |
| `security.risk_detected` | roles `COMPLIANCE` y `FRAUD_ANALYST`, prioridad HIGH | SECURITY |

## Idempotencia (exactly-once sobre at-least-once)

El relay entrega at-least-once. El projector inserta un marcador `ProcessedEvent`
(único por `consumerName + outboxEventId`, `skipDuplicates`) **en la misma transacción**
que las notificaciones. Un evento reentregado encuentra el marcador (0 filas nuevas) y no
duplica nada.

## API (`/v1/notifications`)

Todas las rutas están abiertas a cualquier rol de plataforma, pero cada llamador solo ve
lo dirigido a su principal o a un rol que posee.

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/v1/notifications` | Lista con **keyset pagination** (`cursor`, `pageSize`, `unreadOnly`, `category`). |
| `GET` | `/v1/notifications/unread-count` | `{ unread: number }`. |
| `POST` | `/v1/notifications/:id/read` | Marca una como leída (idempotente). |
| `POST` | `/v1/notifications/read-all` | Marca todas las visibles como leídas. |

La paginación por cursor sigue el patrón del feed de auditoría (`GET v1/audit/events/cursor`):
una bandeja es un log que solo crece, justo donde el offset degrada.

## Frontend

- `src/notifications/inbox.api.ts` — llamadas tipadas con zod, **siempre** vía
  `apiRequest` (nunca `fetch` directo).
- `src/notifications/useNotificationInbox.ts` — hooks de TanStack Query. El badge de
  no-leídas hace polling (`refetchInterval` de 30 s); la lista se carga al abrir el panel.
  El push en vivo (SSE/WebSocket) llega en la **Fase 8**.
- `src/notifications/NotificationCenter.tsx` — la campana consume la bandeja persistente;
  abrir una notificación la marca leída (`POST /:id/read`) y sigue su `actionUrl`;
  "Marcar todas" llama `POST /read-all`.
- El sistema de **toasts** (`NotificationProvider`) se mantiene intacto para errores
  transitorios; la bandeja es el historial persistente.

## Fuera de alcance (v2 / fases posteriores)

- Push en vivo SSE/WebSocket (Fase 8).
- Preferencias de notificación por usuario.
- Redis Streams / bus distribuido (solo documentado como ruta de escalado).
