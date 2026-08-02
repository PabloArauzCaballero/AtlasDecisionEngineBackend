# Orquestación de trabajos de fondo

Este documento describe cómo se reparte el trabajo entre el proceso que decide (`API`) y el
que hace trabajo de fondo (`WORKER`), y cómo el orquestador central minimiza el consumo de
recursos sin sacrificar la latencia con la que ese trabajo de fondo arranca.

## Por qué existe un orquestador

Antes de esto, cada trabajo de fondo —el relay del outbox, el worker de corridas de prueba,
la purga de idempotencia— traía su propio `setTimeout` que se re-agendaba solo, a un
intervalo fijo:

| Trabajo | Intervalo fijo anterior |
|---|---|
| Relay del outbox | 1000 ms |
| Worker de corridas de prueba | 500 ms |
| Purga de idempotencia | 3 600 000 ms |

Esto era correcto — la exclusión mutua entre réplicas la da la base de datos
(`FOR UPDATE SKIP LOCKED` + lease), no el temporizador — pero tenía un coste plano: un
sistema **sin ninguna carga** sondeaba la base de datos al mismo ritmo que uno saturado.
El relay y el worker de corridas juntos hacían más de 250 000 consultas al día por réplica
solo para preguntar «¿hay algo?», y cada trabajo nuevo repetía la misma mecánica de
agendado, drenaje de lotes y apagado limpio con sus propios matices — que es exactamente
cómo se acumulan los fallos de apagado.

`JobSchedulerService` (`src/common/jobs/job-scheduler.service.ts`) centraliza esa mecánica.
Un trabajo deja de tener temporizador propio: implementa el contrato `BackgroundJob`
(`src/common/jobs/background-job.ts`) — un nombre, una cadencia declarada y un método
`runOnce()` que procesa un lote y devuelve cuántas unidades procesó — y el orquestador
decide cuándo llamarlo.

## Las tres piezas

### 1. Retroceso adaptativo

Un lote que devuelve `> 0` se re-ejecuta de inmediato (cediendo el bucle de eventos, no
sincrónicamente): drenar una ráfaga no debe costar un intervalo de sondeo por lote. Un lote
que devuelve `0` duplica la espera (`JOB_BACKOFF_FACTOR`, por defecto `2`) hasta un techo
(`JOB_MAX_IDLE_INTERVAL_MS`). Al ralentí, la frecuencia de sondeo tiende al techo, no al
suelo — es la inversión exacta del comportamiento anterior.

Un fallo (la promesa de `runOnce()` rechaza) usa un retroceso *independiente*
(`JOB_ERROR_INTERVAL_MS` → `JOB_MAX_ERROR_INTERVAL_MS`): una base de datos caída no debe
recibir un reintento por segundo de cada trabajo de cada réplica.

### 2. Despertar por `LISTEN`/`NOTIFY`

El sondeo por sí solo obliga a elegir entre latencia y coste: un techo alto abarata el
ralentí pero encarece la latencia del primer lote tras la inactividad. `JobSignalService`
(`src/common/jobs/job-signal.service.ts`) rompe ese compromiso: el productor emite
`pg_notify('atlas_jobs', '<nombre-del-trabajo>')` **dentro de la misma transacción** que
escribe la fila de trabajo, y una conexión dedicada de escucha en el proceso WORKER
reacciona reiniciando el retroceso de ese trabajo y ejecutándolo de inmediato.

Que el `NOTIFY` vaya dentro de la transacción del productor no es un detalle: Postgres solo
entrega la notificación si esa transacción hace **commit**. Un trabajo nunca se despierta
para una fila que un rollback deshizo, y nunca corre antes de que esa fila sea visible para
otra conexión.

```
Transacción de negocio (API)                    Proceso WORKER
──────────────────────────────                  ──────────────
INSERT decision_outbox_event  ─┐
pg_notify('atlas_jobs',        │
          'outbox-relay')      │  commit
                                └──────────────►  LISTEN atlas_jobs
                                                   recibe 'outbox-relay'
                                                   JobSchedulerService.wake('outbox-relay')
                                                   OutboxRelayService.runOnce()
```

**El sondeo no desaparece: sigue siendo la red de seguridad.** Si la escucha se cae
(reconexión, un `pgbouncer` en modo `transaction`/`statement` que no propaga `NOTIFY`), el
trabajo simplemente cae a su cadencia de sondeo — más lenta, pero nunca incorrecta.
`JOB_WAKE_ENABLED=false` desactiva la señal por completo y dejarlo así en un entorno con
`pgbouncer` transaccional es una decisión legítima, no una degradación oculta.

### 3. Un solo ciclo de vida

Registrarse, agendarse, drenar lotes en vuelo antes del apagado, instrumentar con métricas:
todo eso vive una sola vez en el orquestador. Un trabajo nuevo solo implementa
`BackgroundJob` y llama a `scheduler.register(this)` en su propio `onModuleInit` — el mismo
punto donde antes decidía si arrancar su temporizador según `WORKER_ROLE`.

## Trabajos registrados

| Trabajo | Constante (`JobName`) | Servicio | Despierta por | Purpose |
|---|---|---|---|---|
| Relay del outbox | `outbox-relay` | `OutboxRelayService` | `pg_notify` de `OutboxPublisherService.publish` | Reparte eventos de dominio al bus en proceso. |
| Corridas de prueba | `test-run` | `TestRunWorkerService` | `pg_notify` de `TestExecutionService.enqueueSuite`, y de sí mismo al liberar una ranura de concurrencia | Ejecuta suites de prueba encoladas. |
| Purga de idempotencia | `runtime-retention` | `RetentionSweeperService` | Nada (`wakeChannel: null`) — puramente periódico | Borra filas de `decision_runtime_idempotency` vencidas, en lotes acotados. |

La purga de retención declara `wakeChannel: null` a propósito: nada la hace urgente salvo
el reloj, así que su mínimo y su máximo de retroceso son el mismo valor
(`RUNTIME_RETENTION_SWEEP_INTERVAL_MS`) — una cadencia fija, no un retroceso adaptativo.

## Dónde corre cada cosa (`WORKER_ROLE`)

`WORKER_ROLE` (`src/common/config/worker-role.ts`) sigue fijando el reparto entre procesos,
sin cambios en su contrato:

| Rol | Sirve HTTP | Orquestador de trabajos activo | Para qué |
|---|---|---|---|
| `ALL` | Sí | Sí | Desarrollo, un solo contenedor. |
| `API` | Sí | No (solo *produce* señales, nunca las consume) | Réplicas de decisión, escalables por tráfico. |
| `WORKER` | No | Sí | Proceso dedicado (`dist/worker.js`), escalable por profundidad de cola. |

Lo que cambió respecto a la versión anterior de este reparto es qué más se movió al lado
`WORKER`, porque también son trabajo de fondo:

- **`SeedingService`** (siembra de arranque): antes corría en cualquier proceso que
  arrancara `AppModule`, incluidas las réplicas de API — cada una compitiendo por el mismo
  bloqueo consultivo para hacer exactamente el mismo trabajo antes de aceptar su primera
  petición. Ahora solo se ejecuta si `runsBackgroundJobs(config)` es verdadero.
- **`NotificationProjectorService`** (proyector de notificaciones): se suscribe al
  `EventBus` en proceso, cuyo único productor es el relay del outbox. Con el relay ya fuera
  de las réplicas de API, una API seguía suscrita a un bus que jamás emitía nada; ahora la
  suscripción también respeta `runsBackgroundJobs(config)`.

Una réplica de API, por tanto, **nunca** siembra, nunca proyecta notificaciones y nunca
ejecuta el relay/worker de pruebas/purga — solo *anuncia* trabajo con `pg_notify` dentro de
sus propias transacciones de negocio.

## Configuración

Todas las claves están en `src/common/config/env.schema.ts` y documentadas ahí junto a su
justificación; resumen operativo:

| Variable | Default | Efecto |
|---|---|---|
| `JOB_SCHEDULER_ENABLED` | `true` | Apaga el orquestador entero (además de `WORKER_ROLE`). |
| `JOB_INITIAL_DELAY_MS` | `500` | Espera antes del primer ciclo de un trabajo, para no competir con el arranque. |
| `JOB_MIN_IDLE_INTERVAL_MS` | `1000` | Suelo del retroceso — el intervalo de sondeo más corto posible. |
| `JOB_MAX_IDLE_INTERVAL_MS` | `30000` | Techo del retroceso al ralentí. Subirlo abarata el ralentí sin coste de latencia MIENTRAS la señal funcione. |
| `JOB_BACKOFF_FACTOR` | `2` | Multiplicador por ciclo vacío consecutivo. |
| `JOB_ERROR_INTERVAL_MS` / `JOB_MAX_ERROR_INTERVAL_MS` | `5000` / `120000` | Retroceso independiente ante fallo. |
| `JOB_WAKE_ENABLED` | `true` | Activa la escucha `LISTEN`/`NOTIFY`. En `false`, todo cae al sondeo puro. |
| `JOB_WAKE_CHANNEL` | `atlas_jobs` | Nombre del canal de Postgres. Validado como identificador simple (`[a-z0-9][a-z0-9_-]*`); no se parametriza en `LISTEN`. |

Cada trabajo migrado conserva además sus propias claves de suelo/techo
(`OUTBOX_RELAY_INTERVAL_MS`/`OUTBOX_RELAY_MAX_INTERVAL_MS`,
`TEST_RUN_WORKER_POLL_MS`/`TEST_RUN_WORKER_MAX_POLL_MS`,
`RUNTIME_RETENTION_SWEEP_INTERVAL_MS`), que tienen prioridad sobre los valores globales
`JOB_MIN_IDLE_INTERVAL_MS`/`JOB_MAX_IDLE_INTERVAL_MS`.

## Observabilidad

Un trabajo de fondo se instrumenta automáticamente por el orquestador — no hay que añadir
métricas a mano al escribir uno nuevo:

- `atlas_job_runs_total{job, outcome}` — ciclos por resultado (`work` | `idle` | `error`).
- `atlas_job_items_total{job}` — unidades de trabajo procesadas.
- `atlas_job_duration_ms{job}` — duración de un ciclo.
- `atlas_job_wakeups_total{job}` — despertares recibidos por señal (compárese con
  `atlas_job_runs_total{outcome="work"}` para saber cuánto está aportando el `NOTIFY` frente
  al sondeo puro).
- `atlas_job_last_success_timestamp_seconds{job}` — marca del último ciclo sin error; la
  señal de alerta útil, porque un contador de errores quieto no distingue «todo va bien» de
  «el trabajo dejó de ejecutarse».

**Estas métricas solo existen en `/metrics` del proceso WORKER** (`src/worker.ts`), protegido
por el mismo `METRICS_TOKEN` que la API, comparado en tiempo constante. Antes de esta pieza
el proceso WORKER no exponía métricas en absoluto; sin este endpoint, el backlog del outbox
se seguía leyendo de réplicas de API que ya no reparten nada.

Las sondas de disponibilidad (`/health/ready`, cualquier proceso) añaden, cuando corren
trabajos de fondo, `checks.jobs` (los trabajos registrados) y `checks.jobSignal`
(`disabled` | `listening` | `polling`) — informativo, nunca causa por sí solo de que el
proceso se declare no listo: perder la escucha degrada la latencia, no la corrección.

## Escribir un trabajo nuevo

```ts
@Injectable()
export class MiTrabajoService implements OnModuleInit, BackgroundJob {
  readonly name = 'mi-trabajo';
  readonly minIdleIntervalMs = 1_000;
  readonly maxIdleIntervalMs = 30_000;

  constructor(
    private readonly scheduler: JobSchedulerService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    if (!runsBackgroundJobs(this.config)) return; // no en réplicas de API
    this.scheduler.register(this);
  }

  async runOnce(): Promise<number> {
    // procesar UN lote; devolver cuántas unidades se procesaron
  }
}
```

Si algún productor debe despertarlo de inmediato, inyecte `JobSignalService` en ese
productor y llame `await this.jobSignal.notify(tx, 'mi-trabajo')` **dentro** de la
transacción que crea el trabajo pendiente — nunca fuera de ella.

## Docker y Kubernetes

- `docker-compose.yml`: el servicio `seed` dejó de ser un perfil opcional — es un Job de un
  solo disparo que corre siempre, antes de `api` y `worker`, porque la siembra ahora vive
  del lado de los trabajos de fondo y no debe intentarla cada proceso al arrancar.
  `docker-compose.prod.yml` añade rotación de logs, `restart: always` en los servicios de
  larga vida y cotas de CPU/memoria por servicio.
- `deploy/kubernetes/configmap.yaml` trae las claves `JOB_*` que aplican al Deployment del
  worker (en las réplicas de API el orquestador ni siquiera arranca, así que ahí son
  inertes).
- `deploy/kubernetes/network-policy.yaml` añade una política dedicada para
  `atlas-decision-worker`: antes quedaba sin ninguna restricción de red propia porque la
  única política existente seleccionaba `app: atlas-decision-api`.
- `deploy/kubernetes/worker-deployment.yaml` anota `prometheus.io/scrape` para que el
  raspador descubra `/metrics` del worker automáticamente.

Ver también [`docs/event-driven-architecture.md`](event-driven-architecture.md) (outbox) y
[`docs/DEPLOYMENT.md`](DEPLOYMENT.md) (orden de despliegue completo).
