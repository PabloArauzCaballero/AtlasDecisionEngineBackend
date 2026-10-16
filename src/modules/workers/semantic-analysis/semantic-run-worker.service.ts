import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WorkerRunStatus } from '@prisma/client';
import { runsBackgroundJobs, workerRoleOf } from '../../../common/config/worker-role';
import { BackgroundJob } from '../../../common/jobs/background-job';
import { JobName } from '../../../common/jobs/job-names';
import { JobSchedulerService } from '../../../common/jobs/job-scheduler.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { SemanticAnalysisProcessor } from './core/application/semantic-analysis.processor';
import { isRetryable, toStableErrorCode } from './core/domain/semantic-analysis.errors';
import { MessagingTraceService } from '../../../common/observability/messaging-trace.service';
import {
  APP_ATTRIBUTES,
  MESSAGING_SYSTEM,
} from '../../../common/observability/telemetry.constants';
import { describeError } from './describe-error';
import { SemanticRunLeaseService } from './semantic-run-lease.service';
import type { ClaimedRun } from './semantic-run.types';

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

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly scheduler: JobSchedulerService,
    private readonly processor: SemanticAnalysisProcessor,
    private readonly messagingTrace: MessagingTraceService,
    private readonly lease: SemanticRunLeaseService,
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
        'Worker semántico no arrancado: falta SEMANTIC_ANALYSIS_PROVIDER (openai | transformer)',
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
    await this.lease.recoverExpiredRuns();
    const concurrency = this.config.get<number>('SEMANTIC_ANALYSIS_WORKER_CONCURRENCY') ?? 4;
    let started = 0;
    while (!this.stopped && this.activeJobs.size < concurrency) {
      const claimed = await this.lease.claimNextRun();
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
          this.logger.error(`Tarea semántica desprendida falló: ${describeError(error)}`);
        });
    }
    return started;
  }

  /**
   * Continúa la traza de quien solicitó el análisis.
   *
   * El portador se capturó al encolar, en el proceso de API. Sin él —una fila anterior a la
   * columna, o encolada con la telemetría apagada— se abre una traza raíz y el análisis corre
   * igual: perder la correlación nunca puede costar el trabajo.
   */
  private executeTraced(claimed: ClaimedRun): Promise<void> {
    return this.messagingTrace.runAsConsumer(
      'semantic.consume',
      claimed.traceCarrier,
      {
        'messaging.system': MESSAGING_SYSTEM,
        'messaging.destination.name': 'decision_semantic_analysis_run',
        'messaging.operation.type': 'process',
        'messaging.message.id': claimed.id.toString(),
        [APP_ATTRIBUTES.module]: 'semantic-analysis',
        [APP_ATTRIBUTES.operation]: 'consume',
        [APP_ATTRIBUTES.jobName]: this.name,
        [APP_ATTRIBUTES.jobAttempt]: claimed.attemptCount,
      },
      () => this.execute(claimed),
    );
  }

  private async execute(claimed: ClaimedRun): Promise<void> {
    const heartbeat = this.lease.startHeartbeat(claimed.id);
    try {
      await this.lease.setProgress(claimed.id, 20);
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
}
