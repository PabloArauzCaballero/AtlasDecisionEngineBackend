# Procesamiento en segundo plano

Qué corre fuera del ciclo petición–respuesta, quién lo ejecuta y cómo se opera.

## 1. Inventario real

Todo lo que sigue está en el repositorio y se arranca solo; **no hay un planificador
externo, ni cron, ni broker**. Cada trabajo se replanifica a sí mismo con un `setTimeout`
`unref`'d, de modo que nunca mantiene vivo el proceso durante un apagado.

| Trabajo | Servicio | Reclamo | Interruptor | Corre en |
| --- | --- | --- | --- | --- |
| Relay del outbox | `modules/outbox-relay/outbox-relay.service.ts` | `FOR UPDATE SKIP LOCKED` + lease (`OUTBOX_LEASE_MS`) | `OUTBOX_RELAY_ENABLED` | `ALL`, `WORKER` |
| Worker de corridas de prueba | `modules/testing/test-run-worker.service.ts` | `FOR UPDATE SKIP LOCKED` + lease (`TEST_RUN_LEASE_SECONDS`) | `TEST_RUN_WORKER_ENABLED` | `ALL`, `WORKER` |
| Purga de idempotencia | `modules/runtime/retention-sweeper.service.ts` | `DELETE` por lotes acotados | `RUNTIME_RETENTION_SWEEP_ENABLED` | `ALL`, `WORKER` |
| Proyector de notificaciones | `modules/notifications/notification-projector.service.ts` | Suscripción al bus en proceso, idempotente vía `decision_processed_event` | — | Donde corra el relay |
| Reintento de auditoría de accesos | `common/security/access-denial-auditor.service.ts` | Cola acotada en memoria + temporizador | `ACCESS_AUDIT_ENABLED` | Donde se atiende HTTP |
| Siembra de arranque | `modules/seeding/seeding.service.ts` | Bloqueo consultivo de Postgres, idempotente | `STARTUP_SEED_ENABLED` | Una vez por despliegue |
| Sidecar de scripts | `runner/server.mjs` | Servidor sobre socket Unix, admisión acotada | `SCRIPT_NODES_ENABLED` | Contenedor propio |

Dos de ellos **no** son trasladables a un proceso de fondo y por eso no aparecen en el rol
`WORKER`:

- **Reintento de auditoría de accesos**: su cola se llena con las denegaciones que atiende
  ese mismo proceso HTTP. Moverlo dejaría las denegaciones de la API sin quien las escriba.
- **Latido del stream en vivo** (`live-execution.controller.ts`): pertenece a una conexión
  SSE abierta; sin la conexión no existe.

## 2. El problema que resolvía este reparto

Los tres trabajos de cola corrían dentro de **cada réplica de la API**. Nunca fue
incorrecto —el reclamo atómico impide el trabajo duplicado— pero impedía operar el sistema:

1. No se podía escalar el plano de decisión sin multiplicar la carga de fondo, que compite
   por el mismo pool de conexiones justo en las réplicas sensibles a latencia.
2. Un lote de pruebas pesado degradaba el p95 de las decisiones en línea y no había forma
   de separarlos salvo apagando el worker en todas partes.
3. Apagarlos exigía coordinar tres variables distintas sin equivocarse — y el worker de
   corridas **no tenía interruptor**: se arrancaba en todo proceso que cargara su módulo.

## 3. La decisión: `WORKER_ROLE`

Una sola variable fija el reparto (`src/common/config/worker-role.ts`):

| Rol | Sirve HTTP | Trabajos de fondo | Arranque |
| --- | --- | --- | --- |
| `ALL` | Sí | Sí | `node dist/main.js` |
| `API` | Sí | No | `node dist/main.js` |
| `WORKER` | No | Sí | `node dist/worker.js` |

`ALL` es el valor por defecto **a propósito**: un despliegue existente que no declare nada
se comporta exactamente igual que antes de este cambio.

Los interruptores por trabajo siguen existiendo y se combinan con Y lógico: el rol dice
DÓNDE puede correr un trabajo, el interruptor si ese trabajo está activo.

### Por qué el worker carga el mismo `AppModule`

`src/worker.ts` crea un **contexto de aplicación** (`NestFactory.createApplicationContext`),
no una aplicación HTTP. Consecuencias buscadas:

- Misma configuración validada, mismo Prisma, mismo logger y mismas métricas que la API. No
  hay una segunda definición de la configuración que se desvíe con el tiempo.
- Sin adaptador HTTP no hay controladores: un proceso `WORKER` **no puede** atender una
  decisión aunque alguien le enrute tráfico por error.
- Arrancar `worker.js` con `WORKER_ROLE=API` no ejecutaría ningún trabajo, así que **falla
  al arrancar** en vez de quedarse vivo, verde y sin procesar nada.

### Sondas de un proceso sin HTTP

Un contenedor sin puerto no se puede sondear, y sin sonda el orquestador no sabe si
reiniciarlo. El worker levanta un servidor mínimo de `node:http` (sin Express, sin rutas de
negocio) en `WORKER_HEALTH_PORT` que delega en el **mismo** `HealthProbeService` que usa la
API — reimplementar la comprobación habría producido dos definiciones de «listo» que se
separan justo durante un incidente.

## 4. Despliegue

- **Docker Compose**: servicio `worker` (target `worker` del Dockerfile). La API arranca con
  `WORKER_ROLE=API`. Escalar con `docker compose up --scale worker=3`.
- **Kubernetes**: `deploy/kubernetes/worker-deployment.yaml`, misma imagen que la API con
  `command: ["node", "dist/worker.js"]`. Estrategia `Recreate`: dos generaciones compitiendo
  por las mismas filas no aportan disponibilidad, y el periodo de gracia (60 s, más que el de
  la API) deja drenar los trabajos en vuelo.

Publicar **una sola imagen** para ambos es deliberado: dos imágenes permitirían que una
corriera código más viejo que la otra sobre el mismo esquema de base de datos.

## 5. Operación

| Señal | Significa | Acción |
| --- | --- | --- |
| `atlas_outbox_pending` sube de forma sostenida | El despacho no da abasto o falla | Escalar `worker`; revisar errores del relay |
| `atlas_outbox_dead_total` crece | Eventos agotaron `OUTBOX_MAX_ATTEMPTS` | Atención de operador; más réplicas no lo arreglan |
| Corridas de prueba en `QUEUED` sin avanzar | Ningún proceso corre el worker | Comprobar `WORKER_ROLE` y `TEST_RUN_WORKER_ENABLED` |
| `decision_runtime_idempotency` crece sin cota | La purga no corre | Comprobar `RUNTIME_RETENTION_SWEEP_ENABLED` y el rol |

El fallo más silencioso posible de este diseño es desplegar **todo** con `WORKER_ROLE=API`:
la API funciona, las decisiones se sirven y las colas crecen sin que nadie lo note. Por eso
cada trabajo registra al arrancar la razón exacta por la que no se inició, y la sonda de
vida devuelve el `role` del proceso.

## 6. Evidencia

Salida real de un proceso `WORKER` (`node dist/worker.js`):

```json
{"context":"WorkerBootstrap","metadata":{"message":"ATLAS Decision Engine worker started","role":"WORKER","healthPort":3011}}
```

```json
GET /health/live  → {"status":"ok","role":"WORKER","version":"2.0.0"}
GET /health/ready → {"status":"ready","checks":{"database":"ok","cache":"redis"}}
```

Salida real de un proceso `API` (`node dist/main.js` con `WORKER_ROLE=API`):

```json
{"context":"TestRunWorkerService","msg":"Test run worker not started: WORKER_ROLE=API"}
{"context":"RetentionSweeperService","msg":"Runtime retention sweep not started (WORKER_ROLE=API)"}
{"context":"OutboxRelayService","msg":"Outbox relay not started: WORKER_ROLE=API"}
```

Pruebas: `test/worker-role.spec.ts` (7).
