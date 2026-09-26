import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, WorkerRunStatus } from '@prisma/client';
import { runsBackgroundJobs, workerRoleOf } from '../../../common/config/worker-role';
import { BackgroundJob } from '../../../common/jobs/background-job';
import { JobName } from '../../../common/jobs/job-names';
import { JobSchedulerService } from '../../../common/jobs/job-scheduler.service';
import { MessagingTraceService } from '../../../common/observability/messaging-trace.service';
import {
  APP_ATTRIBUTES,
  MESSAGING_SYSTEM,
} from '../../../common/observability/telemetry.constants';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { AudioTtsRuntimeFactory } from './audio-tts.runtime';
import { buildAudioOutcome, type AudioRunOutcome } from './audio-tts.result';
import { AudioDomainError } from './core/domain/errors';

/**
 * Worker de locución.
 *
 * Mismo procedimiento que los otros tres —el orquestador decide cuándo se
 * reclama, aquí sólo queda el reclamo atómico y la ejecución—, con una
 * diferencia que define todo lo demás: **este worker puede terminar sin haber
 * generado nada**. Es cache-first, así que la mayoría de las locuciones se
 * sirven de un audio que ya existía, y ésas no cuestan ni tiempo ni dinero.
 *
 * La generación ocurre DENTRO de la ejecución reclamada y no en una segunda
 * cola. El paquete original tenía la suya (pg-boss) porque nadie más se la
 * daba; aquí eso metería el mismo trabajo en dos colas con dos reintentos y dos
 * arrendamientos. Ver `run-scoped-audio-queue.ts`.
 */
@Injectable()
export class AudioTtsRunWorkerService implements OnModuleInit, OnModuleDestroy, BackgroundJob {
  private readonly logger = new Logger(AudioTtsRunWorkerService.name);
  private readonly activeJobs = new Set<Promise<void>>();
  private stopped = false;

  readonly name = JobName.AudioTts;
  readonly minIdleIntervalMs: number;
  readonly maxIdleIntervalMs: number;
  readonly initialDelayMs = 0;

  private lastRecoveryAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly scheduler: JobSchedulerService,
    private readonly messagingTrace: MessagingTraceService,
    private readonly runtime: AudioTtsRuntimeFactory,
  ) {
    this.minIdleIntervalMs = config.get<number>('AUDIO_TTS_WORKER_POLL_MS') ?? 500;
    this.maxIdleIntervalMs = Math.max(
      config.get<number>('AUDIO_TTS_WORKER_MAX_POLL_MS') ?? 30_000,
      this.minIdleIntervalMs,
    );
  }

  onModuleInit(): void {
    if (!runsBackgroundJobs(this.config)) {
      this.logger.log(`Worker de locución no arrancado: WORKER_ROLE=${workerRoleOf(this.config)}`);
      return;
    }
    if (!(this.config.get<boolean>('AUDIO_TTS_WORKER_ENABLED') ?? false)) {
      this.logger.log('Worker de locución deshabilitado por configuración');
      return;
    }
    this.scheduler.register(this);
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    await Promise.allSettled(this.activeJobs);
  }

  async runOnce(): Promise<number> {
    await this.recoverExpiredRuns();
    /*
     * La concurrencia es BAJA a propósito, y más baja que la de los otros
     * workers. Lo que limita aquí no es la memoria del motor sino el proveedor
     * de voz: paga por petición y corta por peticiones por segundo. El mamparo
     * y el limitador del adaptador ya lo protegen, pero pedir cuatro a la vez
     * para que tres esperen en una cola interna sólo alarga el arrendamiento.
     */
    const concurrency = this.config.get<number>('AUDIO_TTS_WORKER_CONCURRENCY') ?? 2;
    let started = 0;
    while (!this.stopped && this.activeJobs.size < concurrency) {
      const claimed = await this.claimNextRun();
      if (!claimed) break;
      started += 1;
      const job = this.executeTraced(claimed);
      this.activeJobs.add(job);
      void job
        .finally(() => {
          this.activeJobs.delete(job);
          this.scheduler.wake(this.name);
        })
        .catch((error: unknown) => {
          this.logger.error(`Tarea de locución desprendida falló: ${describeError(error)}`);
        });
    }
    return started;
  }

  /**
   * Reclama la ejecución encolada más antigua, de forma atómica.
   *
   * `FOR UPDATE SKIP LOCKED` bloquea exactamente una fila y pasa por encima de
   * las que otra réplica está reclamando. `$transaction` es obligatorio: la
   * tabla tiene RLS forzada y una sentencia cruda suelta no fija `app.tenant_id`.
   */
  private async claimNextRun(): Promise<ClaimedRun | null> {
    const maxAttempts = this.maxAttempts();
    const [rows] = await this.prisma.$transaction([
      this.prisma.$queryRaw<ClaimedRun[]>(Prisma.sql`
      UPDATE decision_audio_tts_run
      SET status = 'RUNNING',
          started_at = now(),
          finished_at = NULL,
          lease_expires_at = ${this.nextLease()},
          attempt_count = attempt_count + 1
      WHERE id = (
        SELECT id
        FROM decision_audio_tts_run
        WHERE status = 'QUEUED'
          AND attempt_count < ${maxAttempts}
        ORDER BY queued_at ASC, id ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING id, trace_carrier
    `),
    ]);
    return rows[0] ?? null;
  }

  /** Continúa la traza de quien pidió la locución. */
  private executeTraced(claimed: ClaimedRun): Promise<void> {
    return this.messagingTrace.runAsConsumer(
      'audio-tts.process',
      claimed.trace_carrier,
      {
        'messaging.system': MESSAGING_SYSTEM,
        'messaging.destination.name': 'decision_audio_tts_run',
        'messaging.operation.type': 'process',
        'messaging.message.id': claimed.id.toString(),
        [APP_ATTRIBUTES.module]: 'audio-tts',
        [APP_ATTRIBUTES.operation]: 'process',
        [APP_ATTRIBUTES.jobName]: this.name,
      },
      () => this.execute(claimed.id),
    );
  }

  private async execute(runId: bigint): Promise<void> {
    const heartbeat = this.startHeartbeat(runId);
    try {
      const run = await this.prisma.audioTtsRun.findUnique({
        where: { id: runId },
        select: {
          tenantId: true,
          templateCode: true,
          variablesJson: true,
          language: true,
          requestedBy: true,
          correlationId: true,
        },
      });
      if (!run) return;

      const runtime = this.runtime.forTenant(run.tenantId);
      await this.setProgress(runId, 20);

      const resolved = await runtime.resolver.resolve({
        templateCode: run.templateCode,
        variables: (run.variablesJson as Record<string, string> | null) ?? {},
        // El actor es quien pidió la locución: es sobre él sobre quien se aplica
        // el techo diario de generaciones, que es lo que impide que una sola
        // cuenta agote el presupuesto de toda la organización.
        actorId: run.requestedBy,
        ...(run.language ? { language: run.language } : {}),
        correlationId: run.correlationId,
      });

      // `QUEUED` significa que el audio no existía y hay un asset esperando.
      // Generarlo es lo que sigue, aquí y ahora, bajo el arrendamiento que esta
      // ejecución ya sostiene.
      if (resolved.status === 'QUEUED') {
        await this.setProgress(runId, 55);
        await runtime.processor.process(resolved.assetId, run.correlationId);
      }

      const outcome = await buildAudioOutcome(runtime, resolved);
      await this.finish(runId, outcome);
    } catch (error) {
      await this.recordFailure(runId, error);
    } finally {
      clearInterval(heartbeat);
    }
  }

  /**
   * Cierra la ejecución con lo que se resolvió.
   *
   * Servir el respaldo o quedarse sin audio NO son fallos: el contrato del
   * worker es que la falta de audio nunca rompe a quien lo pide. Pero tampoco
   * son un éxito limpio —quien lo pidió esperaba otra cosa—, así que van a
   * «completado con advertencias», que es exactamente lo que ese estado dice.
   */
  private async finish(runId: bigint, outcome: AudioRunOutcome): Promise<void> {
    await this.prisma.audioTtsRun.update({
      where: { id: runId },
      data: {
        status: outcome.warnings.length
          ? WorkerRunStatus.SUCCEEDED_WITH_WARNINGS
          : WorkerRunStatus.SUCCEEDED,
        progress: 100,
        outcome: outcome.result.outcome,
        assetId: outcome.assetId,
        cacheHit: outcome.result.cacheHit,
        resultJson: outcome.result as unknown as Prisma.InputJsonValue,
        warningsJson: outcome.warnings as unknown as Prisma.InputJsonValue,
        finishedAt: new Date(),
        leaseExpiresAt: null,
      },
    });
  }

  /**
   * Distingue el fallo que no tiene arreglo del que sí.
   *
   * Una plantilla que no existe o una variable inválida van a fallar igual las
   * tres veces: reintentarlas sólo gasta el worker. Un fallo de red con el
   * proveedor se cura solo. Tratarlos igual es lo que convierte una cola en un
   * bucle — y aquí, además, en una factura.
   */
  private async recordFailure(runId: bigint, error: unknown): Promise<void> {
    if (error instanceof AudioDomainError) {
      await this.failRun(runId, error.code, error.message);
      return;
    }

    const maxAttempts = this.maxAttempts();
    const current = await this.prisma.audioTtsRun.findUnique({
      where: { id: runId },
      select: { attemptCount: true },
    });
    const exhausted = (current?.attemptCount ?? maxAttempts) >= maxAttempts;
    this.logger.error(
      `Locución ${runId.toString()} falló (intento ${current?.attemptCount ?? 0}/${maxAttempts}): ` +
        describeError(error),
    );

    if (exhausted) {
      await this.failRun(
        runId,
        'AUDIO_GENERATION_FAILED',
        'La locución falló tras agotar los reintentos.',
      );
      return;
    }
    await this.prisma.audioTtsRun.updateMany({
      where: { id: runId, status: WorkerRunStatus.RUNNING },
      data: {
        status: WorkerRunStatus.QUEUED,
        startedAt: null,
        leaseExpiresAt: null,
        progress: 0,
      },
    });
  }

  private async failRun(runId: bigint, code: string, message: string): Promise<void> {
    await this.prisma.audioTtsRun.updateMany({
      where: { id: runId, status: WorkerRunStatus.RUNNING },
      data: {
        status: WorkerRunStatus.FAILED,
        errorCode: code,
        errorMessage: message,
        finishedAt: new Date(),
        leaseExpiresAt: null,
      },
    });
  }

  /** Devuelve a la cola lo que perdió su arrendamiento, y cierra lo agotado. */
  private async recoverExpiredRuns(): Promise<void> {
    const intervalMs = this.config.get<number>('AUDIO_TTS_RECOVERY_INTERVAL_MS') ?? 30_000;
    if (Date.now() - this.lastRecoveryAt < intervalMs) return;
    this.lastRecoveryAt = Date.now();

    const maxAttempts = this.maxAttempts();
    const vencido = {
      status: WorkerRunStatus.RUNNING,
      OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: new Date() } }],
    };

    const recovered = await this.prisma.audioTtsRun.updateMany({
      where: { ...vencido, attemptCount: { lt: maxAttempts } },
      data: {
        status: WorkerRunStatus.QUEUED,
        startedAt: null,
        leaseExpiresAt: null,
        progress: 0,
      },
    });
    if (recovered.count > 0) {
      this.logger.warn(`Recuperadas ${recovered.count} locución(es) con arrendamiento vencido`);
    }

    // Lo que agotó sus intentos se CIERRA, no vuelve a la cola: `claimNextRun`
    // filtra por `attempt_count < maxAttempts`, así que devolverlo a QUEUED lo
    // dejaría ahí para siempre enseñando «En cola» sobre trabajo que nadie hará.
    const agotadas = await this.prisma.audioTtsRun.updateMany({
      where: {
        attemptCount: { gte: maxAttempts },
        OR: [vencido, { status: WorkerRunStatus.QUEUED }],
      },
      data: {
        status: WorkerRunStatus.FAILED,
        errorCode: 'AUDIO_RETRIES_EXHAUSTED',
        errorMessage: 'La locución se interrumpió y ya no quedaban reintentos.',
        finishedAt: new Date(),
        leaseExpiresAt: null,
      },
    });
    if (agotadas.count > 0) {
      this.logger.warn(`Cerradas ${agotadas.count} locución(es) sin reintentos disponibles`);
    }
  }

  /** Renueva el arrendamiento mientras el proveedor sintetiza. */
  private startHeartbeat(runId: bigint): ReturnType<typeof setInterval> {
    const leaseSeconds = this.leaseSeconds();
    const timer = setInterval(
      () => {
        void this.prisma.audioTtsRun
          .updateMany({
            where: { id: runId, status: WorkerRunStatus.RUNNING },
            data: { leaseExpiresAt: this.nextLease() },
          })
          .catch((error: unknown) =>
            this.logger.warn(
              `No se pudo renovar el arrendamiento de ${runId.toString()}: ${describeError(error)}`,
            ),
          );
      },
      Math.max(10_000, Math.floor((leaseSeconds * 1_000) / 3)),
    );
    timer.unref?.();
    return timer;
  }

  private async setProgress(runId: bigint, progress: number): Promise<void> {
    await this.prisma.audioTtsRun.updateMany({
      where: { id: runId, status: WorkerRunStatus.RUNNING },
      data: { progress },
    });
  }

  private maxAttempts(): number {
    return this.config.get<number>('AUDIO_TTS_MAX_ATTEMPTS') ?? 3;
  }

  private leaseSeconds(): number {
    return this.config.get<number>('AUDIO_TTS_LEASE_SECONDS') ?? 300;
  }

  private nextLease(): Date {
    return new Date(Date.now() + this.leaseSeconds() * 1_000);
  }
}

interface ClaimedRun {
  id: bigint;
  trace_carrier: unknown;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
