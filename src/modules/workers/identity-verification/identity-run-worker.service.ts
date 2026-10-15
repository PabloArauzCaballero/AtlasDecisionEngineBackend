import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
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
import { IdentityDocumentType } from './core/domain/identity-enums';
import { outcomeForIdentityVerdict, timestampsForOutcome } from './identity-outcome';
import { IdentityPipelineService } from './identity-pipeline.service';
import { describeError } from './describe-error';
import { IdentityRunFailureService } from './identity-run-failure.service';
import { IdentityRunLeaseService, type ClaimedRun } from './identity-run-lease.service';

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

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly scheduler: JobSchedulerService,
    private readonly messagingTrace: MessagingTraceService,
    private readonly pipeline: IdentityPipelineService,
    private readonly lease: IdentityRunLeaseService,
    private readonly failures: IdentityRunFailureService,
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
    await this.lease.recoverExpiredRuns();
    const concurrency = this.config.get<number>('IDENTITY_WORKER_CONCURRENCY') ?? 2;
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
          this.logger.error(`Tarea de identidad desprendida falló: ${describeError(error)}`);
        });
    }
    return started;
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
    const heartbeat = this.lease.startHeartbeat(runId);
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
        await this.failures.failRun(
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
        onProgress: (progress) => this.lease.setProgress(runId, progress),
      });

      const warnings = [...new Set([...outcome.reasonCodes, ...outcome.riskFlags])];
      const desenlace = outcomeForIdentityVerdict(outcome.decision, outcome.reasonCodes);
      await this.prisma.identityVerificationRun.update({
        where: { id: runId },
        data: {
          /*
           * Un `NO VERIFICADO` es una ejecución CORRECTA con veredicto
           * negativo, no un fallo: el worker hizo su trabajo. Marcarlo `FAILED`
           * confundiría «el rostro no coincide» con «el proveedor se cayó», que
           * es la diferencia entre una decisión y una avería.
           */
          status: desenlace.status,
          // Un veredicto de revisión entra en la BANDEJA, con su motivo y su prioridad. Antes
          // terminaba en un estado terminal y el caso no aparecía en ninguna: la cola existía y
          // sólo la alimentaban los errores de la puerta.
          reviewReason: desenlace.reviewReason,
          reviewPriority: desenlace.reviewPriority,
          arbitrationMode: desenlace.arbitrationMode,
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
          ...timestampsForOutcome(desenlace.status),
          leaseExpiresAt: null,
          // Las imágenes dejan de conservarse en cuanto hay veredicto. Lo que
          // queda es la decisión y su evidencia, con el documento enmascarado.
          documentBytes: null,
          documentBackBytes: null,
          selfieBytes: null,
        },
      });
    } catch (error) {
      await this.failures.recordFailure(runId, error);
    } finally {
      clearInterval(heartbeat);
    }
  }
}
