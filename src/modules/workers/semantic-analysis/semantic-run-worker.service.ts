import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, WorkerRunStatus } from '@prisma/client';
import { runsBackgroundJobs, workerRoleOf } from '../../../common/config/worker-role';
import { BackgroundJob } from '../../../common/jobs/background-job';
import { JobName } from '../../../common/jobs/job-names';
import { JobSchedulerService } from '../../../common/jobs/job-scheduler.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { SemanticAnalysisProcessor } from './core/application/semantic-analysis.processor';
import { isRetryable, toStableErrorCode } from './core/domain/semantic-analysis.errors';
import type { SemanticAnalysisRequest } from './core/domain/semantic-analysis.types';

/**
 * Worker de análisis semántico.
 *
 * Sustituye a pg-boss sin tocar el núcleo: el `SemanticAnalysisProcessor`
 * absorbido sigue siendo quien reclama la auditoría, ejecuta el pipeline y
 * persiste el resultado. Lo que cambia es quién le entrega el trabajo — antes
 * una suscripción de pg-boss, ahora el orquestador del motor — y de dónde sale
 * la solicitud: de una fila reclamada con `FOR UPDATE SKIP LOCKED` en vez de un
 * mensaje de la cola.
 *
 * Con eso desaparecen la segunda tecnología de colas y su tabla de jobs
 * paralela, y a cambio hay que reimplementar lo que pg-boss regalaba: cota de
 * intentos, retroceso y dead-letter. Está aquí abajo, y son unas pocas
 * decenas de líneas contra las tablas que el motor ya tiene.
 */
@Injectable()
export class SemanticRunWorkerService implements OnModuleInit, OnModuleDestroy, BackgroundJob {
  private readonly logger = new Logger(SemanticRunWorkerService.name);
  private readonly activeJobs = new Set<Promise<void>>();
  private stopped = false;

  readonly name = JobName.SemanticAnalysis;
  readonly minIdleIntervalMs: number;
  readonly maxIdleIntervalMs: number;
  readonly initialDelayMs = 0;

  private lastRecoveryAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly scheduler: JobSchedulerService,
    private readonly processor: SemanticAnalysisProcessor,
  ) {
    this.minIdleIntervalMs = config.get<number>('SEMANTIC_ANALYSIS_WORKER_POLL_MS') ?? 500;
    this.maxIdleIntervalMs = Math.max(
      config.get<number>('SEMANTIC_ANALYSIS_WORKER_MAX_POLL_MS') ?? 30_000,
      this.minIdleIntervalMs,
    );
  }

  onModuleInit(): void {
    if (!runsBackgroundJobs(this.config)) {
      this.logger.log(`Worker semántico no arrancado: WORKER_ROLE=${workerRoleOf(this.config)}`);
      return;
    }
    if (!(this.config.get<boolean>('SEMANTIC_ANALYSIS_WORKER_ENABLED') ?? false)) {
      this.logger.log('Worker semántico deshabilitado por configuración');
      return;
    }
    // Sin proveedor de modelo no puede clasificar nada. No registrarse y
    // decirlo es mejor que arrancar y fallar en cada job: la cola crecería con
    // ejecuciones condenadas y el operador vería un worker «vivo».
    if ((this.config.get<string>('SEMANTIC_ANALYSIS_PROVIDER') ?? '') === '') {
      this.logger.warn(
        'Worker semántico no arrancado: falta SEMANTIC_ANALYSIS_PROVIDER (openai | ollama)',
      );
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
    const concurrency = this.config.get<number>('SEMANTIC_ANALYSIS_WORKER_CONCURRENCY') ?? 4;
    let started = 0;
    while (!this.stopped && this.activeJobs.size < concurrency) {
      const claimed = await this.claimNextRun();
      if (!claimed) break;
      started += 1;
      const job = this.execute(claimed);
      this.activeJobs.add(job);
      void job
        .finally(() => {
          this.activeJobs.delete(job);
          this.scheduler.wake(this.name);
        })
        .catch((error: unknown) => {
          this.logger.error(`Tarea semántica desprendida falló: ${describeError(error)}`);
        });
    }
    return started;
  }

  /**
   * Reclama la ejecución encolada más antigua y devuelve la solicitud completa.
   *
   * Devuelve la fila entera y no sólo su identificador —a diferencia del worker
   * de extractos— porque el `SemanticAnalysisProcessor` absorbido recibe un
   * `SemanticAnalysisRequest`, no una referencia a base de datos. Es el precio
   * de conservar su firma intacta, y es barato: el texto ya está en la fila que
   * se acaba de escribir.
   */
  private async claimNextRun(): Promise<ClaimedRun | null> {
    const maxAttempts = this.config.get<number>('SEMANTIC_ANALYSIS_MAX_ATTEMPTS') ?? 3;
    const rows = await this.prisma.$queryRaw<ClaimedRow[]>(Prisma.sql`
      UPDATE decision_semantic_analysis_run
      SET status = 'RUNNING',
          started_at = now(),
          finished_at = NULL,
          lease_expires_at = ${this.nextLease()},
          attempt_count = attempt_count + 1
      WHERE id = (
        SELECT id
        FROM decision_semantic_analysis_run
        WHERE status = 'QUEUED'
          AND attempt_count < ${maxAttempts}
        ORDER BY queued_at ASC, id ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING id, tenant_id, request_id, idempotency_key, input_text,
                input_metadata, requested_by, attempt_count
    `);
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      attemptCount: row.attempt_count,
      request: {
        requestId: row.request_id,
        idempotencyKey: row.idempotency_key,
        text: row.input_text,
        tenantId: row.tenant_id.toString(),
        requestedBy: row.requested_by,
        ...(isRecord(row.input_metadata) ? { metadata: row.input_metadata } : {}),
      },
    };
  }

  private async execute(claimed: ClaimedRun): Promise<void> {
    const heartbeat = this.startHeartbeat(claimed.id);
    try {
      await this.setProgress(claimed.id, 20);
      // El processor absorbido se encarga de todo: reclama la auditoría, corre
      // el pipeline y persiste el resultado por los mismos puertos de siempre.
      await this.processor.execute(claimed.request);
    } catch (error) {
      await this.recordFailure(claimed, error);
    } finally {
      clearInterval(heartbeat);
    }
  }

  /**
   * Decide si el fallo merece otro intento.
   *
   * `isRetryable` es del propio núcleo: distingue un límite de cuota del
   * proveedor o un corte de red —que se curan solos— de un texto que no pasa
   * validación, que fallará igual las tres veces. Reintentar el segundo caso
   * sólo gasta cuota y retrasa la respuesta.
   */
  private async recordFailure(claimed: ClaimedRun, error: unknown): Promise<void> {
    const code = toStableErrorCode(error);
    const maxAttempts = this.config.get<number>('SEMANTIC_ANALYSIS_MAX_ATTEMPTS') ?? 3;
    const exhausted = claimed.attemptCount >= maxAttempts;
    const retry = isRetryable(error) && !exhausted;

    this.logger.error(
      `Análisis ${claimed.request.requestId} falló (intento ${claimed.attemptCount}/${maxAttempts}` +
        `, código ${code}, ${retry ? 'se reintenta' : 'terminal'}): ${describeError(error)}`,
    );

    if (retry) {
      await this.prisma.semanticAnalysisRun.updateMany({
        where: { id: claimed.id, status: WorkerRunStatus.RUNNING },
        data: {
          status: WorkerRunStatus.QUEUED,
          startedAt: null,
          leaseExpiresAt: null,
          progress: 0,
          errorCode: code,
        },
      });
      return;
    }

    await this.prisma.semanticAnalysisRun.updateMany({
      where: { id: claimed.id, status: WorkerRunStatus.RUNNING },
      data: {
        status: WorkerRunStatus.FAILED,
        errorCode: code,
        errorMessage: exhausted
          ? 'El análisis falló tras agotar los reintentos.'
          : 'El análisis falló por un motivo que no se resuelve reintentando.',
        finishedAt: new Date(),
        leaseExpiresAt: null,
      },
    });
  }

  private async recoverExpiredRuns(): Promise<void> {
    const intervalMs = this.config.get<number>('SEMANTIC_ANALYSIS_RECOVERY_INTERVAL_MS') ?? 30_000;
    if (Date.now() - this.lastRecoveryAt < intervalMs) return;
    this.lastRecoveryAt = Date.now();

    const recovered = await this.prisma.semanticAnalysisRun.updateMany({
      where: {
        status: WorkerRunStatus.RUNNING,
        OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: new Date() } }],
      },
      data: {
        status: WorkerRunStatus.QUEUED,
        startedAt: null,
        leaseExpiresAt: null,
        progress: 0,
      },
    });
    if (recovered.count > 0) {
      this.logger.warn(`Recuperados ${recovered.count} análisis con lease vencido`);
    }
  }

  private startHeartbeat(runId: bigint): ReturnType<typeof setInterval> {
    const leaseSeconds = this.config.get<number>('SEMANTIC_ANALYSIS_LEASE_SECONDS') ?? 120;
    const timer = setInterval(
      () => {
        void this.prisma.semanticAnalysisRun
          .updateMany({
            where: { id: runId, status: WorkerRunStatus.RUNNING },
            data: { leaseExpiresAt: this.nextLease() },
          })
          .catch((error: unknown) =>
            this.logger.warn(
              `No se pudo renovar el lease de ${runId.toString()}: ${describeError(error)}`,
            ),
          );
      },
      Math.max(10_000, Math.floor((leaseSeconds * 1_000) / 3)),
    );
    timer.unref?.();
    return timer;
  }

  private async setProgress(runId: bigint, progress: number): Promise<void> {
    await this.prisma.semanticAnalysisRun.updateMany({
      where: { id: runId, status: WorkerRunStatus.RUNNING },
      data: { progress },
    });
  }

  private nextLease(): Date {
    const seconds = this.config.get<number>('SEMANTIC_ANALYSIS_LEASE_SECONDS') ?? 120;
    return new Date(Date.now() + seconds * 1_000);
  }
}

interface ClaimedRow {
  id: bigint;
  tenant_id: bigint;
  request_id: string;
  idempotency_key: string;
  input_text: string;
  input_metadata: unknown;
  requested_by: string;
  attempt_count: number;
}

interface ClaimedRun {
  readonly id: bigint;
  readonly attemptCount: number;
  readonly request: SemanticAnalysisRequest;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describeError(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}
