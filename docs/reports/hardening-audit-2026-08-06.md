# Auditoría de endurecimiento — API y workers

**Fecha:** 2026-08-06 · **Rama:** `test/workers-integracion-postgres` · **Base:** `ccfe686`

Auditoría por fases del backend y sus trabajos de fondo, siguiendo
[la skill `backend-hardening`](https://github.com/PabloArauzCaballero/AtlasDecisionEngineBackend/blob/main/.claude/skills/backend-hardening/SKILL.md). Cada hallazgo
cita archivo/línea o salida de gate ejecutada. Lo que no se pudo verificar se dice.

## Resumen

El servicio llega a esta auditoría **ya endurecido en lo esencial**. Las defensas que suelen
faltar están presentes y razonadas en el propio código: reclamo por `FOR UPDATE SKIP LOCKED`
con lease en el outbox, retroceso exponencial con techo por trabajo y por error, idempotencia
con lease corto y reclamo atómico, RLS por tenant con guardia anti-superusuario, y **toda**
llamada saliente acotada por `AbortSignal`.

La auditoría encontró **un defecto real, reproducible y ahora corregido**, y deja **cinco
riesgos documentados** que no se han tocado porque exceden el alcance de un cambio seguro en
una rama compartida.

## Fase 1 — Inventario

| Superficie | Alcance |
| --- | --- |
| Módulos | 24 en `src/modules/`, 17 transversales en `src/common/` |
| Procesos | `src/main.ts` (API) y `src/worker.ts` (trabajos), **mismo `AppModule`** |
| Trabajos de fondo | Registrados en `JobSchedulerService`; el rol lo decide `WORKER_ROLE` |
| Transporte de eventos | Outbox transaccional → `EventBus` en proceso; despertar por `LISTEN/NOTIFY` |
| Infraestructura | PostgreSQL (Prisma + `@prisma/adapter-pg`), Redis (`ioredis`), sidecar de scripts |

Un solo `AppModule` para los dos procesos es la decisión que más riesgo elimina del
inventario: no existe una segunda definición de la configuración que pueda desviarse.

## Fase 2 — Correctitud

Sin hallazgos abiertos. Verificado:

- El orquestador garantiza **exclusión mutua dentro del proceso** y la delega a la base de
  datos entre réplicas ([`job-scheduler.service.ts`](https://github.com/PabloArauzCaballero/AtlasDecisionEngineBackend/blob/main/src/common/jobs/job-scheduler.service.ts)).
  `runNow()` ocupa la ranura antes de ejecutar, así que un temporizador pendiente no puede
  arrancar el mismo trabajo en paralelo.
- El reparto del outbox es **at-least-once explícito**, con deduplicación aguas abajo en
  `decision_processed_event` ([`outbox-relay.service.ts:37-54`](https://github.com/PabloArauzCaballero/AtlasDecisionEngineBackend/blob/main/src/modules/outbox-relay/outbox-relay.service.ts#L37-L54)).
- `EventBus.emit` propaga el fallo del handler a propósito: es lo que mantiene la fila
  `PENDING` y hace real el reintento ([`event-bus.ts:9-18`](https://github.com/PabloArauzCaballero/AtlasDecisionEngineBackend/blob/main/src/common/events/event-bus.ts#L9-L18)).

## Fase 3 — Seguridad

Sin hallazgos abiertos. Verificado:

- RLS por tenant aplicada vía GUC transaccional, con **fallo cerrado en producción** si la
  conexión resulta ser superusuario ([`prisma.service.ts:74-87`](https://github.com/PabloArauzCaballero/AtlasDecisionEngineBackend/blob/main/src/common/prisma/prisma.service.ts#L74-L87)).
- El identificador de canal de `LISTEN` se valida contra un patrón cerrado porque no se puede
  parametrizar ([`job-signal.service.ts:12`](https://github.com/PabloArauzCaballero/AtlasDecisionEngineBackend/blob/main/src/common/jobs/job-signal.service.ts#L12)).
- `/metrics` autoriza igual en API y worker, por el mismo código y en tiempo constante
  ([`worker.ts`](https://github.com/PabloArauzCaballero/AtlasDecisionEngineBackend/blob/main/src/worker.ts), `metrics-token.ts`).
- `/health/ready` es público y **nunca** filtra el texto crudo del driver
  ([`health-probe.service.ts:59-63`](https://github.com/PabloArauzCaballero/AtlasDecisionEngineBackend/blob/main/src/modules/health/health-probe.service.ts#L59-L63)).

## Fase 4 — Integridad de datos

Sin hallazgos abiertos. La idempotencia usa lease corto (60 s) además del TTL de respuesta,
con reclamo atómico por guardia en el `WHERE` y un tope de reintentos que evita la recursión
sin cota ([`idempotency.service.ts:85-121`](https://github.com/PabloArauzCaballero/AtlasDecisionEngineBackend/blob/main/src/modules/runtime/idempotency.service.ts#L85-L121)).

## Fase 5 — Observabilidad

### H-1 · `SHUTDOWN_GRACE_MS` era un mando muerto — **corregido**

**Severidad:** media · **Estado:** corregido y verificado

`SHUTDOWN_GRACE_MS` estaba declarado en el esquema de entorno, publicado en `.env.example` y
documentado en la tabla de variables, pero **no se leía en ningún punto de `src/`**. El
operador lo configuraba, la documentación lo prometía, y no acotaba nada.

Dos consecuencias reales, medidas:

**(a) El drenaje de lotes no tenía cota.** `onModuleDestroy` esperaba los lotes en vuelo con
un `Promise.allSettled` sin plazo. Un solo lote que no termina —una extracción de PDF que
superó su timeout sin poder cancelarse, porque `withTimeout` compite contra la promesa pero
no cancela el trabajo subyacente
([`worker-service-invoker.service.ts:250-276`](https://github.com/PabloArauzCaballero/AtlasDecisionEngineBackend/blob/main/src/modules/workers/worker-service-invoker.service.ts#L250-L276))—
dejaba el apagado colgado hasta el SIGKILL del orquestador. Un SIGKILL es peor que abandonar
el lote a propósito: se lleva por delante el cierre del pool y el vaciado de trazas, así que
el incidente se pierde justo cuando importa.

**(b) Un arranque fallido salía 30 s tarde.** El manejador de fallo escribía el motivo y hacía
`process.exitCode = 1`, pero **nunca cerraba el contexto de Nest**. `exitCode` no termina un
proceso que aún tiene descriptores vivos, así que el contenedor seguía en pie hasta que el
pool de Postgres cerraba por inactividad.

Medido en el contenedor real, forzando `WORKER_ROLE=API` (rechazo legítimo del arranque):

| | log fatal | salida real | diferencia |
| --- | --- | --- | --- |
| antes | `20:22:37.425Z` | `20:23:07.533Z` | **30,108 s** |
| después | `20:23:17.604Z` | `20:23:17.980Z` | **0,376 s** |

Los 30 s coinciden exactamente con `DATABASE_IDLE_TIMEOUT_MS` (30 000 por defecto), lo que
confirma el mecanismo. El esquema exige `min(1_000)` para esa variable, así que el proceso
siempre acababa saliendo: era una salida **lenta**, no un cuelgue indefinido.

**Corrección aplicada:**

1. [`job-scheduler.service.ts`](https://github.com/PabloArauzCaballero/AtlasDecisionEngineBackend/blob/main/src/common/jobs/job-scheduler.service.ts) — el drenaje se
   acota al 80 % de `SHUTDOWN_GRACE_MS` y deja constancia de qué trabajos se abandonaron. Lo
   abandonado no se pierde: cada trabajo reclama por lease, así que vuelve a estar disponible
   al vencer y otra réplica lo retoma.
2. [`worker.ts`](https://github.com/PabloArauzCaballero/AtlasDecisionEngineBackend/blob/main/src/worker.ts) y [`main.ts`](https://github.com/PabloArauzCaballero/AtlasDecisionEngineBackend/blob/main/src/main.ts) — el camino de fallo de
   arranque cierra el contexto y vacía las trazas antes de salir; ambas señales de apagado
   arman un vigilante que fuerza la salida al agotarse la gracia, para salir por decisión
   propia un instante antes del SIGKILL y conservar el motivo en el log.
3. [`env.schema.ts`](https://github.com/PabloArauzCaballero/AtlasDecisionEngineBackend/blob/main/src/common/config/env.schema.ts) — la variable pasa a llevar su
   propia explicación. La tabla de
   [variables de entorno](../getting-started/environment-variables.md) se **genera** desde el
   esquema (`yarn docs:catalog`), así que documentarla en cualquier otro sitio se habría
   perdido en la siguiente regeneración.

El 20 % restante de la gracia queda para lo que va después del drenaje: cerrar el pool de
Postgres, el cliente de Redis y vaciar el exportador de trazas.

**Validación:** prueba nueva en
[`test/job-scheduler.spec.ts`](https://github.com/PabloArauzCaballero/AtlasDecisionEngineBackend/blob/main/test/job-scheduler.spec.ts) con un trabajo que nunca
resuelve; afirma cota superior **y** inferior, de modo que no puede pasar por vacío.

**Rollback:** revertir los tres archivos. `SHUTDOWN_GRACE_MS` vuelve a ser inerte y el
comportamiento anterior se restaura por completo; no hay migración ni estado persistido.

**Monitoreo posterior:** la línea `Apagado: N lote(s) seguían en vuelo…` en nivel `warn` es la
señal de que un trabajo no respeta su presupuesto. Recurrente = investigar ese trabajo, no
subir la gracia.

> **Operación:** `SHUTDOWN_GRACE_MS` debe quedar **por debajo** del
> `terminationGracePeriodSeconds` del orquestador. Si lo supera, el SIGKILL llega antes que el
> vigilante y se pierde de nuevo el motivo del apagado.

## Fase 6 — Rendimiento

Sin hallazgos abiertos. El muestreo del gauge de pendientes del outbox solo ocurre en ciclos
ociosos y como mucho cada `OUTBOX_BACKLOG_SAMPLE_MS`, tras haberse detectado que la medida
costaba más que lo medido
([`outbox-relay.service.ts:108-124`](https://github.com/PabloArauzCaballero/AtlasDecisionEngineBackend/blob/main/src/modules/outbox-relay/outbox-relay.service.ts#L108-L124)).

**No es un hallazgo:** importar `app.module.js` tarda 16–90 s en el host Windows de
desarrollo. En el contenedor Linux la inicialización de módulos es de ~4 ms (`docker logs`),
así que es un artefacto del sistema de archivos del host, no un arranque en frío de
producción. `pdfjs-dist` se carga de forma perezosa y por su build `legacy`, como corresponde.

## Fase 7 — Pruebas

Gates ejecutados sobre el árbol de trabajo:

| Gate | Resultado |
| --- | --- |
| `yarn typecheck` | ✅ exit 0 |
| `yarn build` | ✅ exit 0 |
| `yarn format:check` (archivos tocados) | ✅ exit 0 |
| `yarn docs:links` | ✅ 0 enlaces rotos, 0 huérfanos |
| `yarn test:unit` (base, antes del cambio) | ✅ 94 suites, 787 pasan, 2 omitidas |
| `test/job-scheduler*.spec.ts` (tras el cambio) | ✅ 12 pasan (9 + 3) |
| `yarn test:unit` (tras el cambio) | ⚠️ 99/100 suites, 868 pasan, **1 falla ajena** |
| Verificación en contenedor | ✅ 30,108 s → 0,376 s |

La suite que falla es `test/persistence-registry-and-router.spec.ts`
(«shares one pool when read and write resolve to the same target»). Tanto ese archivo como
`src/common/persistence/` están **sin seguimiento en git** (`??`): son obra en curso de la otra
sesión (separación de rutas de datos, ADR-0029) y no tienen relación con este cambio, que no
toca el registro de conexiones. Las 94 suites de la línea base siguen en verde.

## Riesgos documentados, no corregidos

No se han tocado: cada uno exige un cambio de diseño o de infraestructura más amplio que lo
que cabe hacer con seguridad en esta rama.

| ID | Riesgo | Severidad | Detalle |
| --- | --- | --- | --- |
| R-1 | `withTimeout` no cancela el trabajo subyacente | media | Una extracción de PDF que agota su plazo sigue consumiendo CPU en segundo plano; el llamante ya recibió su error. Bajo carga se acumulan cómputos huérfanos. Corregir exige mover la extracción a un `worker_thread` cancelable. Es la causa que hace necesaria la cota de H-1(a). |
| R-2 | `EventBus.emit` no tiene plazo | media | Un handler colgado retiene la fila del outbox hasta que vence el lease, y entonces **otra réplica la reparte mientras la primera sigue viva** — proceso duplicado real. Lo absorbe la deduplicación por `decision_processed_event`, pero es dependencia de una defensa aguas abajo, no una cota. |
| R-3 | `catalog-cache` no purga entradas vencidas | baja | El `Map` por tenant solo crece; las entradas caducadas permanecen. Fuga de memoria proporcional al número de tenants, no al tráfico. |
| R-4 | `health-probe.ready()` sin plazo propio | baja | Depende de `statement_timeout` (30 s), muy por encima del plazo típico de una sonda. En la práctica la corta el orquestador. |
| R-5 | Sin chaos engineering ejecutado | — | Ver la sección siguiente. |

## Alcance no cubierto

Honestamente y por delante: el encargo pedía diez fases y diecinueve entregables (FMEA, árbol
de fallos, plan de continuidad, suite de caos, cobertura >95 %). **Esto no es eso.** Es la
fase de auditoría de la skill del propio proyecto, que termina en un informe priorizado y en
la corrección de lo que se pudo verificar. Lo que **no** se ha hecho:

- **No se ha ejecutado chaos engineering.** Nada de caída de BD/Redis/broker, partición de
  red, OOM ni disco lleno. Requiere un entorno desechable; el árbol de trabajo actual está
  siendo editado en paralelo y comparte infraestructura con contenedores activos.
- **No se ha medido cobertura.** `yarn test:cov` no se ejecutó; no se afirma ninguna cifra.
- **No se ha tocado carga, estrés, spike ni soak.** Sin evidencia, no hay afirmación.
- **No se ha reescrito el catálogo de errores** — ya existe en
  [`docs/api/error-catalog.md`](../api/error-catalog.md) y no había motivo para duplicarlo.
- **DR y continuidad ya existen** en [`docs/operations/disaster-recovery.md`](../operations/disaster-recovery.md)
  y [`docs/runbooks/OPERATIONS.md`](../runbooks/OPERATIONS.md); no se han rehecho.

Los checklists de «Zero X» de la Fase 10 **no se declaran cumplidos**: varios (Zero Duplicate
Processing, Zero Resource Leaks) están directamente contradichos por R-1 y R-2, que siguen
abiertos.

## Nota sobre el árbol de trabajo

Durante la auditoría, el árbol pasó de 210 a 226 archivos modificados por **otra sesión
trabajando en paralelo** (refactor de `persistence/**` y `audit-query/**`). En un punto
intermedio `yarn typecheck` falló por ese refactor a medias, ajeno a este cambio; al concluir
volvió a exit 0. Los gates de arriba son del estado final, pero conviene reejecutarlos antes
de integrar.
