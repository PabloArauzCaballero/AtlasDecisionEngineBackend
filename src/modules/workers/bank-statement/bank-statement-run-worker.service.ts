import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, WorkerRunStatus } from '@prisma/client';
import { runsBackgroundJobs, workerRoleOf } from '../../../common/config/worker-role';
import { BackgroundJob } from '../../../common/jobs/background-job';
import { JobName } from '../../../common/jobs/job-names';
import { JobSchedulerService } from '../../../common/jobs/job-scheduler.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { StatementProcessingError } from './core/domain/errors';
import { createStatementEngine, type StatementEngine } from './core/statement-engine';
import { MessagingTraceService } from '../../../common/observability/messaging-trace.service';
import {
  APP_ATTRIBUTES,
  MESSAGING_SYSTEM,
} from '../../../common/observability/telemetry.constants';

/**
 * Worker de conversión de extractos bancarios.
 *
 * Sigue el mismo procedimiento que `TestRunWorkerService`, que es el patrón
 * aprobado del motor: el orquestador decide cuándo se reclama, aquí sólo queda
 * el reclamo atómico y la ejecución. No hay temporizador propio, no hay bucle
 * de sondeo propio y no hay una segunda forma de apagarse.
 *
 * Lo que este worker añade sobre aquel es la parte que el paquete original no
 * tenía —era síncrono sobre HTTP—: cota de intentos, distinción entre fallo de
 * negocio y fallo de infraestructura, y borrado del documento al terminar.
 */
@Injectable()
export class BankStatementRunWorkerService implements OnModuleInit, OnModuleDestroy, BackgroundJob {
  private readonly logger = new Logger(BankStatementRunWorkerService.name);
  private readonly activeJobs = new Set<Promise<void>>();
  private stopped = false;

  readonly name = JobName.BankStatement;
  readonly minIdleIntervalMs: number;
  readonly maxIdleIntervalMs: number;
  readonly initialDelayMs = 0;

  private lastRecoveryAt = 0;
  /**
   * El motor se construye una sola vez y se reutiliza: registrar los siete
   * analizadores y los perfiles por cada job convertiría el arranque del
   * análisis en la parte cara de convertir un PDF.
   *
   * Perezoso porque construirlo arrastra `pdfjs-dist`: un proceso con el worker
   * apagado no debe pagar esa carga.
   */
  private engine?: StatementEngine;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly scheduler: JobSchedulerService,
    private readonly messagingTrace: MessagingTraceService,
  ) {
    this.minIdleIntervalMs = config.get<number>('BANK_STATEMENT_WORKER_POLL_MS') ?? 500;
    this.maxIdleIntervalMs = Math.max(
      config.get<number>('BANK_STATEMENT_WORKER_MAX_POLL_MS') ?? 30_000,
      this.minIdleIntervalMs,
    );
  }

  onModuleInit(): void {
    if (!runsBackgroundJobs(this.config)) {
      this.logger.log(`Worker de extractos no arrancado: WORKER_ROLE=${workerRoleOf(this.config)}`);
      return;
    }
    if (!(this.config.get<boolean>('BANK_STATEMENT_WORKER_ENABLED') ?? false)) {
      this.logger.log('Worker de extractos deshabilitado por configuración');
      return;
    }
    this.scheduler.register(this);
  }

  async onModuleDestroy(): Promise<void> {
    // Dejar de reclamar es lo primero: lo que no se reclamó sigue en QUEUED y
    // otra réplica lo tomará. Lo que ya está en vuelo se espera.
    this.stopped = true;
    await Promise.allSettled(this.activeJobs);
  }

  async runOnce(): Promise<number> {
    await this.recoverExpiredRuns();
    const concurrency = this.config.get<number>('BANK_STATEMENT_WORKER_CONCURRENCY') ?? 2;
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
          // Se liberó una ranura: puede haber cola esperándola, y esperar el
          // retroceso dejaría el worker ocioso con trabajo disponible.
          this.scheduler.wake(this.name);
        })
        .catch((error: unknown) => {
          this.logger.error(`Tarea de extracto desprendida falló: ${describeError(error)}`);
        });
    }
    return started;
  }

  /**
   * Reclama la ejecución encolada más antigua, de forma atómica.
   *
   * `FOR UPDATE SKIP LOCKED` bloquea exactamente una fila y pasa por encima de
   * las que otro worker está reclamando, así que varias réplicas compiten sin
   * bloquearse. La cota de intentos va en el `WHERE`: una ejecución que agotó
   * sus reintentos no debe volver a reclamarse nunca.
   */
  private async claimNextRun(): Promise<ClaimedRun | null> {
    const maxAttempts = this.config.get<number>('BANK_STATEMENT_MAX_ATTEMPTS') ?? 3;
    // `$transaction` obligatorio: `decision_bank_statement_run` tiene RLS FORZADA y una
    // sentencia cruda suelta no fija `app.tenant_id`, así que sobre una conexión del pool
    // que ya sirvió a un tenant la política aborta con 22P02. Ver `outbox-relay.service.ts`.
    const [rows] = await this.prisma.$transaction([
      this.prisma.$queryRaw<Array<{ id: bigint; trace_carrier: unknown }>>(Prisma.sql`
      UPDATE decision_bank_statement_run
      SET status = 'RUNNING',
          started_at = now(),
          finished_at = NULL,
          lease_expires_at = ${this.nextLease()},
          attempt_count = attempt_count + 1
      WHERE id = (
        SELECT id
        FROM decision_bank_statement_run
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

  /**
   * Continúa la traza de quien subió el extracto.
   *
   * El portador se guardó al encolar, en el proceso de API; sin él este trabajo aparecería en
   * Jaeger como una traza suelta, sin relación con la petición que lo pidió. Una fila sin
   * portador abre una traza raíz y se procesa igual.
   */
  private executeTraced(claimed: ClaimedRun): Promise<void> {
    return this.messagingTrace.runAsConsumer(
      'bank-statement.process',
      claimed.trace_carrier,
      {
        'messaging.system': MESSAGING_SYSTEM,
        'messaging.destination.name': 'decision_bank_statement_run',
        'messaging.operation.type': 'process',
        'messaging.message.id': claimed.id.toString(),
        [APP_ATTRIBUTES.module]: 'bank-statement',
        [APP_ATTRIBUTES.operation]: 'process',
        [APP_ATTRIBUTES.jobName]: this.name,
      },
      () => this.execute(claimed.id),
    );
  }

  private async execute(runId: bigint): Promise<void> {
    const heartbeat = this.startHeartbeat(runId);
    try {
      const run = await this.prisma.bankStatementRun.findUnique({
        where: { id: runId },
        select: {
          fileBytes: true,
          fileName: true,
          attemptCount: true,
          correlationId: true,
        },
      });
      if (!run?.fileBytes) {
        // La fila existe pero su documento ya no: cancelada a mitad, o un
        // intento anterior lo borró. No es reintentable.
        await this.failRun(
          runId,
          'BANK_STATEMENT_INPUT_MISSING',
          'El documento de entrada ya no está disponible.',
        );
        return;
      }

      await this.setProgress(runId, 25);
      // El `correlationId` viaja al motor para que sus trazas se puedan unir a
      // la petición que originó la conversión. El motor lo sanea antes de
      // registrarlo, porque su origen último es una cabecera HTTP.
      const normalized = await this.engineInstance().normalize(Buffer.from(run.fileBytes), {
        fileName: run.fileName,
        correlationId: run.correlationId,
      });
      await this.setProgress(runId, 80);

      const warnings = normalized.quality.warnings;
      await this.prisma.bankStatementRun.update({
        where: { id: runId },
        data: {
          status:
            warnings.length > 0
              ? WorkerRunStatus.SUCCEEDED_WITH_WARNINGS
              : WorkerRunStatus.SUCCEEDED,
          progress: 100,
          resultJson: normalized as unknown as Prisma.InputJsonValue,
          warningsJson: warnings as unknown as Prisma.InputJsonValue,
          confidence: normalized.quality.overallConfidence,
          institutionId: normalized.institution.id,
          transactionCount: normalized.transactions.length,
          finishedAt: new Date(),
          leaseExpiresAt: null,
          // El extracto deja de conservarse en cuanto hay resultado. Lo que se
          // guarda es el contrato normalizado, que ya viene enmascarado.
          fileBytes: null,
        },
      });
    } catch (error) {
      await this.recordFailure(runId, error);
    } finally {
      clearInterval(heartbeat);
    }
  }

  /**
   * Distingue el fallo que no tiene arreglo del que sí.
   *
   * Un PDF que no es un estado de cuenta va a fallar igual las tres veces:
   * reintentarlo sólo gasta el worker y retrasa la respuesta al usuario. Un
   * corte de base de datos, en cambio, se cura solo. Tratarlos igual es lo que
   * convierte una cola en un bucle.
   */
  private async recordFailure(runId: bigint, error: unknown): Promise<void> {
    const businessFailure = error instanceof StatementProcessingError;
    if (businessFailure) {
      await this.failRun(runId, error.code, error.message);
      return;
    }

    const maxAttempts = this.config.get<number>('BANK_STATEMENT_MAX_ATTEMPTS') ?? 3;
    const current = await this.prisma.bankStatementRun.findUnique({
      where: { id: runId },
      select: { attemptCount: true },
    });
    const exhausted = (current?.attemptCount ?? maxAttempts) >= maxAttempts;

    this.logger.error(
      `Ejecución de extracto ${runId.toString()} falló (intento ` +
        `${current?.attemptCount ?? 0}/${maxAttempts}): ${describeError(error)}`,
    );

    if (exhausted) {
      await this.failRun(
        runId,
        'BANK_STATEMENT_PROCESSING_FAILED',
        'La conversión falló tras agotar los reintentos.',
      );
      return;
    }
    // Vuelve a la cola liberando el lease. El contador de intentos ya subió al
    // reclamarla, así que no puede girar indefinidamente.
    await this.prisma.bankStatementRun.updateMany({
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
    await this.prisma.bankStatementRun.updateMany({
      where: { id: runId, status: WorkerRunStatus.RUNNING },
      data: {
        status: WorkerRunStatus.FAILED,
        errorCode: code,
        errorMessage: message,
        finishedAt: new Date(),
        leaseExpiresAt: null,
        fileBytes: null,
      },
    });
  }

  /**
   * Devuelve a la cola lo que perdió su lease porque el proceso que lo tenía
   * murió. Se ejecuta como mucho una vez por intervalo, no en cada ciclo: un
   * lease dura minutos, así que buscar vencidos dos veces por segundo sólo
   * puede encontrar nada.
   */
  private async recoverExpiredRuns(): Promise<void> {
    const intervalMs = this.config.get<number>('BANK_STATEMENT_RECOVERY_INTERVAL_MS') ?? 30_000;
    if (Date.now() - this.lastRecoveryAt < intervalMs) return;
    this.lastRecoveryAt = Date.now();

    const maxAttempts = this.config.get<number>('BANK_STATEMENT_MAX_ATTEMPTS') ?? 3;
    const leaseVencido = {
      status: WorkerRunStatus.RUNNING,
      OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: new Date() } }],
    };

    const recovered = await this.prisma.bankStatementRun.updateMany({
      where: { ...leaseVencido, attemptCount: { lt: maxAttempts } },
      data: {
        status: WorkerRunStatus.QUEUED,
        startedAt: null,
        leaseExpiresAt: null,
        progress: 0,
      },
    });
    if (recovered.count > 0) {
      this.logger.warn(
        `Recuperadas ${recovered.count} ejecución(es) de extracto con lease vencido`,
      );
    }

    /*
     * Lo que ya agotó sus intentos se CIERRA, no vuelve a la cola.
     *
     * `claimNextRun` filtra por `attempt_count < maxAttempts`: devolver a QUEUED
     * una ejecución agotada la deja ahí para siempre, enseñando «En cola» sobre
     * un trabajo que nadie va a hacer. Se barre también lo que ya estaba en
     * QUEUED con los intentos agotados, que es el residuo de recuperaciones
     * anteriores; reclamarlo es imposible, así que cerrarlo no compite con nadie.
     *
     * El documento se borra al cerrar, igual que en cualquier otro final: una
     * ejecución que no va a procesarse no tiene por qué seguir guardando el PDF
     * de nadie.
     */
    const agotadas = await this.prisma.bankStatementRun.updateMany({
      where: {
        attemptCount: { gte: maxAttempts },
        OR: [leaseVencido, { status: WorkerRunStatus.QUEUED }],
      },
      data: {
        status: WorkerRunStatus.FAILED,
        errorCode: 'BANK_STATEMENT_RETRIES_EXHAUSTED',
        errorMessage: 'La conversión se interrumpió y ya no quedaban reintentos.',
        finishedAt: new Date(),
        leaseExpiresAt: null,
        fileBytes: null,
      },
    });
    if (agotadas.count > 0) {
      this.logger.warn(`Cerradas ${agotadas.count} conversión(es) sin reintentos disponibles`);
    }
  }

  /**
   * Renueva el lease mientras el job trabaja. Sin esto, un PDF que tarda más
   * que el lease sería recuperado por otra réplica y procesado dos veces.
   */
  private startHeartbeat(runId: bigint): ReturnType<typeof setInterval> {
    const leaseSeconds = this.config.get<number>('BANK_STATEMENT_LEASE_SECONDS') ?? 300;
    const timer = setInterval(
      () => {
        void this.prisma.bankStatementRun
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
    await this.prisma.bankStatementRun.updateMany({
      where: { id: runId, status: WorkerRunStatus.RUNNING },
      data: { progress },
    });
  }

  private engineInstance(): StatementEngine {
    this.engine ??= createStatementEngine({
      limits: {
        maxFileSizeBytes: this.config.get<number>('BANK_STATEMENT_MAX_UPLOAD_BYTES') ?? 10_485_760,
        maxPageCount: 60,
        processingTimeoutMs: this.config.get<number>('BANK_STATEMENT_TIMEOUT_MS') ?? 60_000,
      },
    });
    return this.engine;
  }

  private nextLease(): Date {
    const seconds = this.config.get<number>('BANK_STATEMENT_LEASE_SECONDS') ?? 300;
    return new Date(Date.now() + seconds * 1_000);
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}

/** Fila reclamada por el worker, con el portador de traza que viajó con ella. */
interface ClaimedRun {
  readonly id: bigint;
  readonly trace_carrier: unknown;
}
