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
import { IdentityDecision, IdentityDocumentType } from './core/domain/identity-enums';
import { IdentityDomainError } from './core/domain/identity-domain.error';
import { outcomeForIdentityError, type IdentityRunOutcome } from './identity-outcome';
import { IdentityPipelineService } from './identity-pipeline.service';

/**
 * Worker de verificación de identidad.
 *
 * Mismo procedimiento que `BankStatementRunWorkerService`, que es el patrón
 * aprobado del motor: el orquestador decide cuándo se reclama, aquí sólo queda
 * el reclamo atómico y la ejecución. Sin temporizador propio, sin bucle de
 * sondeo propio y sin una segunda forma de apagarse.
 *
 * El paquete original repartía esto entre cuatro trabajos de pg-boss con
 * checkpoints entre ellos, porque su captura llega en varios pasos. Aquí las
 * dos imágenes llegan juntas, así que lo que se conserva de aquel diseño es lo
 * que importa: la cota de intentos, la distinción entre fallo de negocio y de
 * infraestructura, y el borrado de las imágenes al terminar.
 */
@Injectable()
export class IdentityRunWorkerService implements OnModuleInit, OnModuleDestroy, BackgroundJob {
  private readonly logger = new Logger(IdentityRunWorkerService.name);
  private readonly activeJobs = new Set<Promise<void>>();
  private stopped = false;

  readonly name = JobName.IdentityVerification;
  readonly minIdleIntervalMs: number;
  readonly maxIdleIntervalMs: number;
  readonly initialDelayMs = 0;

  private lastRecoveryAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly scheduler: JobSchedulerService,
    private readonly messagingTrace: MessagingTraceService,
    private readonly pipeline: IdentityPipelineService,
  ) {
    this.minIdleIntervalMs = config.get<number>('IDENTITY_WORKER_POLL_MS') ?? 500;
    this.maxIdleIntervalMs = Math.max(
      config.get<number>('IDENTITY_WORKER_MAX_POLL_MS') ?? 30_000,
      this.minIdleIntervalMs,
    );
  }

  onModuleInit(): void {
    if (!runsBackgroundJobs(this.config)) {
      this.logger.log(`Worker de identidad no arrancado: WORKER_ROLE=${workerRoleOf(this.config)}`);
      return;
    }
    if (!(this.config.get<boolean>('IDENTITY_VERIFICATION_WORKER_ENABLED') ?? false)) {
      this.logger.log('Worker de identidad deshabilitado por configuración');
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
    const concurrency = this.config.get<number>('IDENTITY_WORKER_CONCURRENCY') ?? 2;
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
          this.logger.error(`Tarea de identidad desprendida falló: ${describeError(error)}`);
        });
    }
    return started;
  }

  /**
   * Reclama la verificación encolada más antigua, de forma atómica.
   *
   * `FOR UPDATE SKIP LOCKED` bloquea exactamente una fila y pasa por encima de
   * las que otro worker está reclamando, así que varias réplicas compiten sin
   * bloquearse. La cota de intentos va en el `WHERE`: una ejecución que agotó
   * sus reintentos no debe volver a reclamarse nunca.
   */
  private async claimNextRun(): Promise<ClaimedRun | null> {
    const maxAttempts = this.config.get<number>('IDENTITY_MAX_ATTEMPTS') ?? 3;
    // `$transaction` obligatorio: la tabla tiene RLS FORZADA y una sentencia
    // cruda suelta no fija `app.tenant_id`, así que sobre una conexión del pool
    // que ya sirvió a un tenant la política aborta con 22P02.
    const [rows] = await this.prisma.$transaction([
      this.prisma.$queryRaw<Array<{ id: bigint; trace_carrier: unknown }>>(Prisma.sql`
      UPDATE decision_identity_verification_run
      SET status = 'RUNNING',
          started_at = now(),
          finished_at = NULL,
          lease_expires_at = ${this.nextLease()},
          attempt_count = attempt_count + 1
      WHERE id = (
        SELECT id
        FROM decision_identity_verification_run
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

  /** Continúa la traza de quien subió las imágenes. */
  private executeTraced(claimed: ClaimedRun): Promise<void> {
    return this.messagingTrace.runAsConsumer(
      'identity-verification.process',
      claimed.trace_carrier,
      {
        'messaging.system': MESSAGING_SYSTEM,
        'messaging.destination.name': 'decision_identity_verification_run',
        'messaging.operation.type': 'process',
        'messaging.message.id': claimed.id.toString(),
        [APP_ATTRIBUTES.module]: 'identity-verification',
        [APP_ATTRIBUTES.operation]: 'process',
        [APP_ATTRIBUTES.jobName]: this.name,
      },
      () => this.execute(claimed.id),
    );
  }

  private async execute(runId: bigint): Promise<void> {
    const heartbeat = this.startHeartbeat(runId);
    try {
      const run = await this.prisma.identityVerificationRun.findUnique({
        where: { id: runId },
        select: {
          documentBytes: true,
          documentBackBytes: true,
          selfieBytes: true,
          documentCountry: true,
          fixtureCode: true,
          correlationId: true,
          // Las dos que dicen si este caso YA lo arbitró alguien. Se leen juntas
          // a propósito: el tipo sin el resolutor sería el que proyectó una
          // ejecución anterior, y saltarse la puerta por eso convertiría una
          // clasificación automática en una confirmación humana.
          reviewResolvedBy: true,
          documentType: true,
        },
      });
      if (!run?.documentBytes || !run.selfieBytes) {
        // La fila existe pero sus imágenes ya no: cancelada a mitad, o un
        // intento anterior las borró. No es reintentable.
        await this.failRun(
          runId,
          'IDENTITY_INPUT_MISSING',
          'Las imágenes de entrada ya no están disponibles.',
        );
        return;
      }

      /*
       * Un escenario recorre EL MISMO camino que un archivo subido.
       *
       * Aquí se buscaba el escenario en el catálogo para pasarle su pista a los
       * proveedores, que elegían el desenlace por ella. Ya no: los proveedores
       * son reales y miran las imágenes, así que un escenario no es un atajo con
       * un resultado escrito, es un par de imágenes generadas. Que no quede
       * ninguna vía por la que el origen de la petición cambie el veredicto es
       * justamente lo que hace que probar con un escenario pruebe algo.
       */
      const outcome = await this.pipeline.run({
        documentImage: Buffer.from(run.documentBytes),
        documentBackImage: run.documentBackBytes ? Buffer.from(run.documentBackBytes) : null,
        selfieImage: Buffer.from(run.selfieBytes),
        documentCountry: run.documentCountry,
        correlationId: run.correlationId,
        // Lo pone el SERVIDOR, a partir de que la ejecución naciera del catálogo
        // de escenarios. Quien sube archivos no puede activarlo.
        entradaGenerada: Boolean(run.fixtureCode),
        // El veredicto de quien arbitró, si lo hubo. La puerta no vuelve a
        // preguntar por un documento que una persona ya identificó.
        arbitratedDocumentType:
          run.reviewResolvedBy !== null && run.documentType !== null
            ? (run.documentType as IdentityDocumentType)
            : null,
        onProgress: (progress) => this.setProgress(runId, progress),
      });

      const warnings = [...new Set([...outcome.reasonCodes, ...outcome.riskFlags])];
      await this.prisma.identityVerificationRun.update({
        where: { id: runId },
        data: {
          /*
           * Un `NO VERIFICADO` es una ejecución CORRECTA con veredicto
           * negativo, no un fallo: el worker hizo su trabajo. Marcarlo `FAILED`
           * confundiría «el rostro no coincide» con «el proveedor se cayó», que
           * es la diferencia entre una decisión y una avería.
           */
          status:
            outcome.decision === IdentityDecision.VERIFIED
              ? WorkerRunStatus.SUCCEEDED
              : WorkerRunStatus.SUCCEEDED_WITH_WARNINGS,
          progress: 100,
          resultJson: outcome as unknown as Prisma.InputJsonValue,
          warningsJson: warnings as unknown as Prisma.InputJsonValue,
          decision: outcome.decision,
          documentType: outcome.documentType,
          // La evidencia se proyecta a columna para poder medir la puerta sin
          // abrir el JSON de cada ejecución: es el número que dice si los
          // umbrales están bien puestos.
          documentTypeConfidence: outcome.documentEvidence.confidence,
          similarityScore: outcome.faceMatch?.similarityScore ?? null,
          finishedAt: new Date(),
          leaseExpiresAt: null,
          // Las imágenes dejan de conservarse en cuanto hay veredicto. Lo que
          // queda es la decisión y su evidencia, con el documento enmascarado.
          documentBytes: null,
          documentBackBytes: null,
          selfieBytes: null,
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
   * Una foto borrosa va a estar borrosa las tres veces: reintentarla sólo gasta
   * el worker y retrasa el aviso. Un proveedor saturado, en cambio, se cura
   * solo. Esa es la razón de que `IdentityDomainError` traiga `retryable`: la
   * categoría la fija el núcleo absorbido, no una lista de códigos aquí.
   */
  private async recordFailure(runId: bigint, error: unknown): Promise<void> {
    /*
     * Antes que nada: ¿esto es un fallo, o es el worker acertando?
     *
     * Rechazar la foto de un recibo y derivar una cédula dudosa a una persona
     * NO son averías, y marcarlas `FAILED` mezclaba «esto no es un documento»
     * con «el proveedor biométrico se cayó» en la misma columna y en la misma
     * métrica. La tasa de fallos del worker subía cada vez que alguien subía una
     * foto equivocada, que es la forma más rápida de que nadie mire el tablero.
     */
    const desenlace = outcomeForIdentityError(error);
    if (desenlace !== null) {
      await this.closeWithOutcome(runId, error as IdentityDomainError, desenlace);
      return;
    }

    if (error instanceof IdentityDomainError && !error.retryable) {
      await this.failRun(runId, error.code, error.message);
      return;
    }

    const maxAttempts = this.config.get<number>('IDENTITY_MAX_ATTEMPTS') ?? 3;
    const current = await this.prisma.identityVerificationRun.findUnique({
      where: { id: runId },
      select: { attemptCount: true },
    });
    const exhausted = (current?.attemptCount ?? maxAttempts) >= maxAttempts;

    this.logger.error(
      `Verificación ${runId.toString()} falló (intento ` +
        `${current?.attemptCount ?? 0}/${maxAttempts}): ${describeError(error)}`,
    );

    if (exhausted) {
      await this.failRun(
        runId,
        error instanceof IdentityDomainError ? error.code : 'IDENTITY_PROCESSING_FAILED',
        'La verificación falló tras agotar los reintentos.',
      );
      return;
    }
    await this.prisma.identityVerificationRun.updateMany({
      where: { id: runId, status: WorkerRunStatus.RUNNING },
      data: {
        status: WorkerRunStatus.QUEUED,
        startedAt: null,
        leaseExpiresAt: null,
        progress: 0,
      },
    });
  }

  /**
   * Cierra la ejecución en el estado que su desenlace dicta.
   *
   * Dos diferencias con `failRun`, y las dos importan:
   *
   * - **Un pendiente CONSERVA las imágenes.** La regla de privacidad —borrarlas
   *   al cerrar— sigue intacta porque un caso en revisión no está cerrado: sin
   *   ellas, la pestaña ofrecería «resolver» sobre una fila sin nada que mirar.
   *   Un rechazo, en cambio, es terminal y las borra como cualquier veredicto.
   * - **El mensaje se guarda en `errorMessage` también aquí.** Es lo que la
   *   pantalla enseña a quien subió la foto, y es exactamente la instrucción que
   *   necesita: «esto era un recibo» o «la cédula quedó a la espera de revisión».
   */
  private async closeWithOutcome(
    runId: bigint,
    error: IdentityDomainError,
    outcome: IdentityRunOutcome,
  ): Promise<void> {
    const enRevision = outcome.status === WorkerRunStatus.PENDING_REVIEW;
    await this.prisma.identityVerificationRun.updateMany({
      where: { id: runId, status: WorkerRunStatus.RUNNING },
      data: {
        status: outcome.status,
        errorCode: error.code,
        errorMessage: error.message,
        reviewReason: outcome.reviewReason,
        rejectionReason: outcome.rejectionReason,
        arbitrationMode: outcome.arbitrationMode,
        reviewPriority: outcome.reviewPriority,
        reviewOpenedAt: enRevision ? new Date() : null,
        finishedAt: enRevision ? null : new Date(),
        leaseExpiresAt: null,
        ...(enRevision ? {} : { documentBytes: null, documentBackBytes: null, selfieBytes: null }),
      },
    });
    this.logger.log(
      `Verificación ${runId.toString()} cerrada como ${outcome.status}` +
        `${outcome.reviewReason ? ` (${outcome.reviewReason})` : ''}` +
        `${outcome.rejectionReason ? ` (${outcome.rejectionReason})` : ''}.`,
    );
  }

  private async failRun(runId: bigint, code: string, message: string): Promise<void> {
    await this.prisma.identityVerificationRun.updateMany({
      where: { id: runId, status: WorkerRunStatus.RUNNING },
      data: {
        status: WorkerRunStatus.FAILED,
        errorCode: code,
        errorMessage: message,
        finishedAt: new Date(),
        leaseExpiresAt: null,
        documentBytes: null,
        documentBackBytes: null,
        selfieBytes: null,
      },
    });
  }

  /**
   * Devuelve a la cola lo que perdió su lease porque el proceso que lo tenía
   * murió, y CIERRA lo que ya agotó sus intentos: `claimNextRun` filtra por
   * `attempt_count < maxAttempts`, así que devolver a QUEUED una ejecución
   * agotada la dejaría ahí para siempre enseñando «En cola».
   */
  private async recoverExpiredRuns(): Promise<void> {
    const intervalMs = this.config.get<number>('IDENTITY_RECOVERY_INTERVAL_MS') ?? 30_000;
    if (Date.now() - this.lastRecoveryAt < intervalMs) return;
    this.lastRecoveryAt = Date.now();

    const maxAttempts = this.config.get<number>('IDENTITY_MAX_ATTEMPTS') ?? 3;
    const leaseVencido = {
      status: WorkerRunStatus.RUNNING,
      OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: new Date() } }],
    };

    const recovered = await this.prisma.identityVerificationRun.updateMany({
      where: { ...leaseVencido, attemptCount: { lt: maxAttempts } },
      data: {
        status: WorkerRunStatus.QUEUED,
        startedAt: null,
        leaseExpiresAt: null,
        progress: 0,
      },
    });
    if (recovered.count > 0) {
      this.logger.warn(`Recuperadas ${recovered.count} verificación(es) con lease vencido`);
    }

    const agotadas = await this.prisma.identityVerificationRun.updateMany({
      where: {
        attemptCount: { gte: maxAttempts },
        OR: [leaseVencido, { status: WorkerRunStatus.QUEUED }],
      },
      data: {
        status: WorkerRunStatus.FAILED,
        errorCode: 'IDENTITY_RETRIES_EXHAUSTED',
        errorMessage: 'La verificación se interrumpió y ya no quedaban reintentos.',
        finishedAt: new Date(),
        leaseExpiresAt: null,
        documentBytes: null,
        documentBackBytes: null,
        selfieBytes: null,
      },
    });
    if (agotadas.count > 0) {
      this.logger.warn(`Cerradas ${agotadas.count} verificación(es) sin reintentos disponibles`);
    }
  }

  /**
   * Renueva el lease mientras el job trabaja. Sin esto, una verificación que
   * tarde más que el lease sería recuperada por otra réplica y procesada dos
   * veces —dos veces contra el proveedor, y dos veces la foto de la misma
   * persona—.
   */
  private startHeartbeat(runId: bigint): ReturnType<typeof setInterval> {
    const leaseSeconds = this.config.get<number>('IDENTITY_LEASE_SECONDS') ?? 300;
    const timer = setInterval(
      () => {
        void this.prisma.identityVerificationRun
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
    await this.prisma.identityVerificationRun.updateMany({
      where: { id: runId, status: WorkerRunStatus.RUNNING },
      data: { progress },
    });
  }

  private nextLease(): Date {
    const seconds = this.config.get<number>('IDENTITY_LEASE_SECONDS') ?? 300;
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
