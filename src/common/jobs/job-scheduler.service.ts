import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { runsBackgroundJobs, workerRoleOf } from '../config/worker-role';
import { MetricsService } from '../observability/metrics.service';
import { APP_ATTRIBUTES, SPAN_NAMES } from '../observability/telemetry.constants';
import { TracingService } from '../observability/tracing.service';
import { BackgroundJob, JobCadence } from './background-job';
import { JobSignalService } from './job-signal.service';

/**
 * Parte de `SHUTDOWN_GRACE_MS` que se reserva al drenaje de lotes. El resto queda para lo
 * que va DESPUÉS en el apagado —cerrar el pool de Postgres, el cliente de Redis y vaciar
 * las trazas—, que también necesita ocurrir dentro de la misma gracia del orquestador.
 */
const DRAIN_SHARE = 0.8;

/** Estado que el orquestador lleva por trabajo registrado. */
interface ScheduledJob {
  readonly job: BackgroundJob;
  readonly cadence: JobCadence;
  timer?: ReturnType<typeof setTimeout>;
  inFlight?: Promise<void>;
  /** Retroceso actual, en ms. Crece al ralentí y se reinicia al encontrar trabajo. */
  idleDelayMs: number;
  consecutiveFailures: number;
  /** Llegó un despertar mientras el trabajo corría: hay que reintentar sin esperar. */
  wakePending: boolean;
  lastSuccessAt?: number;
}

/**
 * Orquestador central de los trabajos de fondo.
 *
 * Antes, cada trabajo traía su propio temporizador que se re-agendaba solo: el relay del
 * outbox cada segundo, el worker de corridas cada 500 ms y la purga cada hora. Funcionaba,
 * pero el coste era plano: un sistema sin ninguna carga gastaba ~250 000 consultas al día
 * solo en preguntar «¿hay algo?», y añadir un cuarto trabajo significaba escribir por
 * cuarta vez la misma lógica de agendado, drenaje y apagado — cada copia con sus propios
 * matices, que es como se acumulan los fallos de apagado.
 *
 * Este servicio centraliza esa mecánica en tres decisiones:
 *
 * 1. **Retroceso adaptativo.** Un lote productivo se re-agenda de inmediato (drenar una
 *    ráfaga no debe costar un intervalo por lote); un lote vacío duplica la espera hasta un
 *    techo. Al ralentí, la frecuencia de sondeo tiende al techo en vez de al suelo.
 * 2. **Despertar por señal.** El productor anuncia el trabajo con `pg_notify` al hacer
 *    commit y el orquestador reinicia el retroceso de ese trabajo y lo ejecuta ya. La
 *    latencia deja de depender del intervalo de sondeo, así que el techo puede subirse sin
 *    penalizar el tiempo de respuesta. Sondeo y señal se combinan: la señal da latencia, el
 *    sondeo da la garantía.
 * 3. **Un solo ciclo de vida.** Un único punto de arranque, de apagado y de instrumentación.
 *    Un trabajo nuevo declara qué hace y con qué cadencia; no vuelve a escribir un
 *    `setTimeout` ni un drenaje de apagado.
 *
 * Lo que NO cambia: la exclusión mutua entre réplicas sigue siendo de la base de datos
 * (`FOR UPDATE SKIP LOCKED` + lease en cada trabajo). Este orquestador solo garantiza que
 * dentro de un proceso no hay dos ejecuciones simultáneas del mismo trabajo.
 */
@Injectable()
export class JobSchedulerService implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(JobSchedulerService.name);
  private readonly scheduled = new Map<string, ScheduledJob>();
  private readonly defaults: JobCadence;
  private readonly backoffFactor: number;
  private readonly errorDelayMs: number;
  private readonly maxErrorDelayMs: number;
  private readonly drainDeadlineMs: number;

  private enabled = false;
  private started = false;
  private stopped = false;
  private unsubscribeWake?: () => void;

  constructor(
    private readonly config: ConfigService,
    private readonly signal: JobSignalService,
    private readonly metrics: MetricsService,
    private readonly tracing: TracingService,
  ) {
    this.defaults = {
      initialDelayMs: config.get<number>('JOB_INITIAL_DELAY_MS') ?? 500,
      minIdleIntervalMs: config.get<number>('JOB_MIN_IDLE_INTERVAL_MS') ?? 1_000,
      maxIdleIntervalMs: config.get<number>('JOB_MAX_IDLE_INTERVAL_MS') ?? 30_000,
    };
    this.backoffFactor = config.get<number>('JOB_BACKOFF_FACTOR') ?? 2;
    this.errorDelayMs = config.get<number>('JOB_ERROR_INTERVAL_MS') ?? 5_000;
    this.maxErrorDelayMs = config.get<number>('JOB_MAX_ERROR_INTERVAL_MS') ?? 120_000;
    this.drainDeadlineMs = Math.floor(
      (config.get<number>('SHUTDOWN_GRACE_MS') ?? 20_000) * DRAIN_SHARE,
    );
  }

  onModuleInit(): void {
    // El rol dice DÓNDE pueden correr los trabajos; el interruptor, si el orquestador está
    // activo. Se combinan con Y lógico, igual que hacían los trabajos por separado.
    this.enabled =
      runsBackgroundJobs(this.config) &&
      (this.config.get<boolean>('JOB_SCHEDULER_ENABLED') ?? true);
  }

  /**
   * Arranca después de que todos los módulos hayan registrado sus trabajos. Registrar más
   * tarde también funciona —{@link register} agenda al vuelo— pero este es el punto en el
   * que el proceso deja constancia de qué va a ejecutar.
   */
  onApplicationBootstrap(): void {
    if (!this.enabled) {
      this.logger.log(
        `Orquestador de trabajos inactivo (WORKER_ROLE=${workerRoleOf(this.config)}); ` +
          `${this.scheduled.size} trabajo(s) registrado(s) no se ejecutarán en este proceso`,
      );
      return;
    }
    this.started = true;

    if (this.signal.enabled) {
      this.unsubscribeWake = this.signal.onWake((channel) => this.wake(channel));
      this.signal.startListening();
    } else {
      this.logger.log('Despertar por señal deshabilitado: los trabajos solo sondearán');
    }

    for (const entry of this.scheduled.values()) this.schedule(entry, entry.cadence.initialDelayMs);
    this.logger.log(
      `Orquestador de trabajos activo: ${[...this.scheduled.keys()].sort().join(', ') || 'sin trabajos'}`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    this.unsubscribeWake?.();
    for (const entry of this.scheduled.values()) {
      if (entry.timer) clearTimeout(entry.timer);
      entry.timer = undefined;
    }
    // Esperar los lotes en vuelo antes de que Nest cierre el pool de Prisma: si no, el
    // último rastro de cada apagado limpio es un `Cannot use a pool after calling end`
    // en nivel error, que es exactamente el ruido que enseña a un operador a ignorar el log.
    //
    // Pero esa espera va ACOTADA. Sin cota, un solo lote que no termina —una extracción de
    // PDF que superó su timeout sin poder cancelarse, una consulta que no respeta
    // `statement_timeout`— deja el apagado colgado hasta que el orquestador manda SIGKILL.
    // Un SIGKILL es peor que abandonar el lote a propósito: mata también el cierre del pool
    // y el vaciado de trazas, así que el incidente se pierde justo cuando importa. Lo que se
    // abandona aquí no se pierde: cada trabajo reclama por lease, así que lo no confirmado
    // vuelve a estar disponible al vencer y otra réplica lo retoma.
    // `!== undefined` y no la promesa a secas: una promesa SIEMPRE es «verdadera», así que
    // usarla como condición es la forma habitual de que un `if` asincrónico mienta. Aquí lo
    // que se pregunta es si la ranura está ocupada, y eso se dice explícitamente.
    const pending = [...this.scheduled.values()].filter((entry) => entry.inFlight !== undefined);
    if (pending.length === 0) return;
    if (await this.drainWithin(pending, this.drainDeadlineMs)) return;

    const stuck = pending
      .filter((entry) => entry.inFlight !== undefined)
      .map((entry) => entry.job.name)
      .sort();
    this.logger.warn(
      `Apagado: ${stuck.length} lote(s) seguían en vuelo tras ${this.drainDeadlineMs} ms y se ` +
        `abandonan (${stuck.join(', ')}); su lease vencerá y otra réplica los retomará`,
    );
  }

  /**
   * Espera a que terminen los lotes en vuelo, o hasta agotar el plazo. Devuelve si drenaron.
   *
   * El temporizador va con `unref` para no ser él mismo la razón por la que el proceso sigue
   * vivo: si todo lo demás ya se cerró, el proceso debe poder morir sin esperar al plazo.
   */
  private drainWithin(entries: ScheduledJob[], deadlineMs: number): Promise<boolean> {
    // Se filtran los `undefined` en vez de pasárselos a `allSettled`: los tolera, pero
    // entonces el tipo del arreglo ya no dice que esto espera promesas, y una ranura vacía
    // colada por error se resolvería al instante haciendo creer que el drenaje terminó.
    const inFlight = entries
      .map((entry) => entry.inFlight)
      .filter((promise): promise is Promise<void> => promise !== undefined);
    const drained = Promise.allSettled(inFlight).then(() => true);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const lapsed = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), deadlineMs);
      timer.unref?.();
    });
    return Promise.race([drained, lapsed]).finally(() => {
      if (timer) clearTimeout(timer);
    });
  }

  /**
   * Registra un trabajo. Idempotente por nombre: registrar dos veces el mismo nombre es un
   * error de composición (dos servicios creyéndose el mismo trabajo), y se rechaza en vez
   * de duplicar el sondeo en silencio.
   */
  register(job: BackgroundJob): void {
    if (this.scheduled.has(job.name)) {
      throw new Error(`Ya hay un trabajo de fondo registrado con el nombre ${job.name}`);
    }
    const minIdleIntervalMs = job.minIdleIntervalMs ?? this.defaults.minIdleIntervalMs;
    const cadence: JobCadence = {
      initialDelayMs: job.initialDelayMs ?? this.defaults.initialDelayMs,
      minIdleIntervalMs,
      // Un trabajo que declara un mínimo mayor que el techo global (una purga horaria, por
      // ejemplo) fija su propio techo: el máximo nunca puede quedar por debajo del mínimo.
      maxIdleIntervalMs: Math.max(
        job.maxIdleIntervalMs ?? this.defaults.maxIdleIntervalMs,
        minIdleIntervalMs,
      ),
    };
    const entry: ScheduledJob = {
      job,
      cadence,
      idleDelayMs: cadence.minIdleIntervalMs,
      consecutiveFailures: 0,
      wakePending: false,
    };
    this.scheduled.set(job.name, entry);
    if (this.started && !this.stopped) this.schedule(entry, cadence.initialDelayMs);
  }

  /** Nombres registrados, ordenados. Para las sondas y las pruebas. */
  registeredJobs(): string[] {
    return [...this.scheduled.keys()].sort();
  }

  /**
   * Despierta los trabajos suscritos a un canal. Se llama desde la escucha de `NOTIFY` y
   * también sirve como punto de entrada para las pruebas y para un futuro endpoint de
   * operación que fuerce un ciclo.
   */
  wake(channel: string): void {
    if (!this.started || this.stopped) return;
    for (const entry of this.scheduled.values()) {
      const wakeChannel =
        entry.job.wakeChannel === undefined ? entry.job.name : entry.job.wakeChannel;
      if (wakeChannel !== channel) continue;
      this.metrics.recordJobWake(entry.job.name);
      // El retroceso se reinicia siempre: el canal acaba de afirmar que hay trabajo, así
      // que la evidencia en la que se apoyaba la espera larga ya no es válida.
      entry.idleDelayMs = entry.cadence.minIdleIntervalMs;
      if (entry.inFlight) {
        // El lote en curso pudo empezar antes del commit que dispara este aviso, así que no
        // se puede dar por atendido: se marca para volver a correr en cuanto termine.
        entry.wakePending = true;
        continue;
      }
      if (entry.timer) clearTimeout(entry.timer);
      entry.timer = undefined;
      this.schedule(entry, 0);
    }
  }

  /**
   * Ejecuta un trabajo una vez, ahora, sin tocar el agendado. Existe para las pruebas y
   * para operaciones puntuales; el camino normal es siempre el temporizador.
   */
  async runNow(name: string): Promise<number> {
    const entry = this.scheduled.get(name);
    if (!entry) throw new Error(`No hay ningún trabajo de fondo llamado ${name}`);
    // En bucle, no un solo `await`: mientras esperábamos, el temporizador pudo tomar la
    // ranura y volver a ocuparla.
    while (entry.inFlight) await entry.inFlight;
    // Ocupar la ranura ANTES de ejecutar. `schedule()` se guarda con `timer`/`inFlight`, y
    // esto no ponía ninguno de los dos: un temporizador ya pendiente arrancaba el MISMO
    // trabajo en paralelo y rompía la única exclusión que este orquestador promete dentro
    // del proceso. Con lotes que se reclaman por `FOR UPDATE SKIP LOCKED` no corrompe datos,
    // pero duplica el trabajo y hace intermitente cualquier prueba que use runNow.
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = undefined;
    const run = entry.job.runOnce();
    entry.inFlight = run.then(
      () => undefined,
      () => undefined,
    );
    try {
      return await run;
    } finally {
      entry.inFlight = undefined;
      // Devolver el trabajo a su cadencia: se canceló su temporizador, así que sin esto una
      // ejecución manual dejaría el trabajo sin sondear durante el resto de la vida del proceso.
      if (this.started && !this.stopped) this.schedule(entry, entry.idleDelayMs);
    }
  }

  private schedule(entry: ScheduledJob, delayMs: number): void {
    if (this.stopped || entry.timer || entry.inFlight) return;
    entry.timer = setTimeout(() => {
      entry.timer = undefined;
      entry.inFlight = this.run(entry).finally(() => {
        entry.inFlight = undefined;
        if (this.stopped) return;
        // Un despertar recibido a mitad del lote se atiende ya, sin esperar el retroceso.
        const next = entry.wakePending ? 0 : entry.idleDelayMs;
        entry.wakePending = false;
        this.schedule(entry, next);
      });
    }, delayMs);
    // Sin unref, un temporizador pendiente mantendría vivo un proceso al que ya se le pidió
    // terminar y el orquestador se convertiría en el motivo por el que no muere.
    entry.timer.unref?.();
  }

  /**
   * Ejecuta un lote dentro de una traza RAÍZ.
   *
   * Raíz y no hija: un trabajo periódico no lo origina ninguna solicitud y no debe heredar el
   * contexto de lo que se estuviera ejecutando en el proceso, que sería una petición ajena
   * elegida al azar por el bucle de eventos.
   *
   * Un span por **lote**, nunca uno por registro: un barrido de retención que procesa cien mil
   * filas debe producir una traza legible, no cien mil spans.
   *
   * También se abre para los ciclos en vacío, y eso es aceptable por el retroceso adaptativo:
   * al ralentí la cadencia tiende al techo (30 s por defecto), así que un trabajo ocioso aporta
   * dos trazas por minuto. Decidir a posteriori habría dejado las consultas del propio lote sin
   * padre, que es justo lo que se quiere ver.
   */
  private runBatch(entry: ScheduledJob): Promise<number> {
    return this.tracing.runInRootSpan(
      SPAN_NAMES.jobRun,
      {
        [APP_ATTRIBUTES.module]: 'jobs',
        [APP_ATTRIBUTES.operation]: 'run',
        [APP_ATTRIBUTES.jobName]: entry.job.name,
        [APP_ATTRIBUTES.jobAttempt]: entry.consecutiveFailures + 1,
      },
      async (span) => {
        const processed = await entry.job.runOnce();
        span.setAttribute(APP_ATTRIBUTES.jobProcessed, processed);
        span.setAttribute(APP_ATTRIBUTES.jobOutcome, processed > 0 ? 'work' : 'idle');
        return processed;
      },
    );
  }

  private async run(entry: ScheduledJob): Promise<void> {
    if (this.stopped) return;
    const startedAt = Date.now();
    try {
      const processed = await this.runBatch(entry);
      const durationMs = Date.now() - startedAt;
      entry.consecutiveFailures = 0;
      entry.lastSuccessAt = Date.now();
      if (processed > 0) {
        // Hubo trabajo: probablemente queda más. Volver ya, pero cediendo el bucle de
        // eventos, para drenar la ráfaga sin bloquear el proceso ni el apagado.
        entry.idleDelayMs = 0;
        this.metrics.recordJobRun(entry.job.name, 'work', durationMs, processed);
      } else {
        entry.idleDelayMs = this.nextIdleDelay(entry);
        this.metrics.recordJobRun(entry.job.name, 'idle', durationMs, 0);
      }
      this.metrics.setJobLastSuccess(entry.job.name, Math.floor(entry.lastSuccessAt / 1_000));
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      entry.consecutiveFailures += 1;
      entry.idleDelayMs = this.errorDelay(entry.consecutiveFailures);
      this.metrics.recordJobRun(entry.job.name, 'error', durationMs, 0);
      const message = `El trabajo ${entry.job.name} falló (intento ${entry.consecutiveFailures}, reintento en ${entry.idleDelayMs} ms): ${
        error instanceof Error ? (error.stack ?? error.message) : String(error)
      }`;
      // Un lote interrumpido por el apagado no es un incidente: lo que no reclamó sigue
      // pendiente y otra réplica lo tomará. Solo se reporta como tal mientras corre.
      if (this.stopped) this.logger.debug(message);
      else this.logger.error(message);
    }
  }

  /**
   * Retroceso exponencial acotado por el techo declarado por el trabajo. El primer lote
   * vacío tras uno productivo espera el mínimo —no el mínimo ya multiplicado—, porque el
   * caso frecuente es una ráfaga que acaba de agotarse y suele traer más detrás.
   */
  private nextIdleDelay(entry: ScheduledJob): number {
    if (entry.idleDelayMs < entry.cadence.minIdleIntervalMs) return entry.cadence.minIdleIntervalMs;
    return Math.min(entry.idleDelayMs * this.backoffFactor, entry.cadence.maxIdleIntervalMs);
  }

  /**
   * Retroceso ante fallo, independiente del de ralentí: una base de datos caída no debe
   * recibir un reintento por segundo de cada trabajo de cada réplica.
   */
  private errorDelay(failures: number): number {
    return Math.min(this.errorDelayMs * 2 ** Math.min(failures - 1, 10), this.maxErrorDelayMs);
  }
}
