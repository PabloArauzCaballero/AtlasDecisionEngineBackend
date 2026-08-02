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
import { BackgroundJob, JobCadence } from './background-job';
import { JobSignalService } from './job-signal.service';

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

  private enabled = false;
  private started = false;
  private stopped = false;
  private unsubscribeWake?: () => void;

  constructor(
    private readonly config: ConfigService,
    private readonly signal: JobSignalService,
    private readonly metrics: MetricsService,
  ) {
    this.defaults = {
      initialDelayMs: config.get<number>('JOB_INITIAL_DELAY_MS') ?? 500,
      minIdleIntervalMs: config.get<number>('JOB_MIN_IDLE_INTERVAL_MS') ?? 1_000,
      maxIdleIntervalMs: config.get<number>('JOB_MAX_IDLE_INTERVAL_MS') ?? 30_000,
    };
    this.backoffFactor = config.get<number>('JOB_BACKOFF_FACTOR') ?? 2;
    this.errorDelayMs = config.get<number>('JOB_ERROR_INTERVAL_MS') ?? 5_000;
    this.maxErrorDelayMs = config.get<number>('JOB_MAX_ERROR_INTERVAL_MS') ?? 120_000;
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
    await Promise.allSettled([...this.scheduled.values()].map((entry) => entry.inFlight));
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

  private async run(entry: ScheduledJob): Promise<void> {
    if (this.stopped) return;
    const startedAt = Date.now();
    try {
      const processed = await entry.job.runOnce();
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
