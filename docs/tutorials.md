# Tutorial interactivo y persistencia de progreso

Fase 4 del PROMPT MAESTRO. El portal guía al usuario nuevo con un recorrido
interactivo; el backend solo persiste **el progreso**, no el contenido.

## Decisión de diseño: el contenido vive en el frontend

Los pasos, textos y anclajes del tutorial son contenido de producto que cambia con
la UI, así que viven junto a las vistas que describen
(`AtlasDecisionEngineFrontend/src/features/tutorial/`). El backend guarda
únicamente qué tutorial vio cada usuario y hasta dónde llegó. Esto evita una
migración de base de datos cada vez que se reescribe un texto, y permite que un
tutorial nuevo se despliegue con el frontend.

## Modelo de datos

`UserTutorialProgress` (`user_tutorial_progress`) — ver `prisma/schema.prisma`.

No existe una tabla de usuarios en este servicio: la identidad la posee el
proveedor externo (ver [event-driven-architecture.md](./event-driven-architecture.md)
para el mismo razonamiento aplicado a las notificaciones). Por eso la fila se
llavea por `(tenantId, userId, tutorialId)`, donde `userId` es el `id` del
principal autenticado, nunca un valor enviado por el cliente.

| Campo | Sentido |
|---|---|
| `status` | `STARTED` / `COMPLETED` / `DISMISSED` |
| `lastStep` | Índice del último paso visto, para reanudar donde se quedó |
| `version` | Versión del contenido; permite volver a ofrecer un tutorial reescrito |
| `autoShow` | Si el recorrido puede abrirse solo; el usuario puede silenciarlo |
| `completedAt` | Se sella al pasar a `COMPLETED`, y se limpia si se reabre |

**RLS:** la tabla es tenant-scoped y lleva la política `tenant_isolation` espejo de
`20260719080000_tenant_rls_and_app_role` (migración
`20260724100000_tutorial_progress_rls`).

## API

Ambos endpoints aceptan cualquier rol de plataforma (`PLATFORM_ROLES`): el tutorial
es transversal. El aislamiento real no lo da el rol sino el principal — el servicio
filtra siempre por el `tenantId` y el `principal.id` del llamador, así que un usuario
no puede leer ni escribir el progreso de otro.

- `GET /v1/tutorial-progress` — progreso del llamador, más reciente primero.
- `PUT /v1/tutorial-progress/:tutorialId` — upsert idempotente del progreso.
  Cuerpo: `status` (requerido), `lastStep`, `version`, `autoShow`.

Implementación: `src/modules/tutorials/tutorial.controller.ts` y
`src/modules/tutorials/tutorial.service.ts`.
El upsert es idempotente por diseño: reenviar el mismo paso no crea filas ni
mueve `completedAt` salvo que el estado cambie, de modo que el frontend puede
guardar en cada paso sin coordinar.

## Frontend

`src/features/tutorial/` — `InteractiveTutorialProvider` conduce el recorrido con
overlay y anclajes (`useTutorialTarget`), `useTutorialProgress` sincroniza contra
la API vía `apiRequest` (nunca `fetch` directo) y decide si un recorrido se abre
solo, respetando `autoShow` y `version`.
