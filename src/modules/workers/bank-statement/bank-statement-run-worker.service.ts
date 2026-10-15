import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WorkerRunStatus } from '@prisma/client';
import { runsBackgroundJobs, workerRoleOf } from '../../../common/config/worker-role';
import { BackgroundJob } from '../../../common/jobs/background-job';
import { JobName } from '../../../common/jobs/job-names';
import { JobSchedulerService } from '../../../common/jobs/job-scheduler.service';
import { StatementProcessingError } from './core/domain/errors';
import { InstitutionCatalogService } from './institutions/institution-catalog.service';
import { createStatementEngine, type StatementEngine } from './core/statement-engine';
import { BankStatementRunRecovery } from './bank-statement-run-recovery';
import { BankStatementRunStore, describeError, type ClaimedRun } from './bank-statement-run.store';
import { columnAdvisorOption, statementEngineOptions } from './statement-engine-options';
import { outcomeForError, outcomeForResult } from './statement-outcome';
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

  /**
   * El motor se construye una sola vez y se reutiliza: registrar los siete
   * analizadores y los perfiles por cada job convertiría el arranque del
   * análisis en la parte cara de convertir un PDF.
   *
   * Perezoso porque construirlo arrastra `pdfjs-dist`: un proceso con el worker
   * apagado no debe pagar esa carga.
   *
   * Hay uno POR TENANT, y no es un detalle de implementación: el padrón de
   * entidades es tenant-scoped, así que un motor compartido atribuiría los
   * documentos de un cliente contra las entidades que administró otro. Son unos
   * pocos objetos sin estado por tenant; el coste es despreciable al lado de esa
   * confusión.
   */
  private readonly engines = new Map<string, StatementEngine>();

  constructor(
    private readonly config: ConfigService,
    private readonly scheduler: JobSchedulerService,
    private readonly messagingTrace: MessagingTraceService,
    private readonly institutions: InstitutionCatalogService,
    private readonly store: BankStatementRunStore,
    private readonly recovery: BankStatementRunRecovery,
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
    await this.recovery.recoverExpiredRuns();
    const concurrency = this.config.get<number>('BANK_STATEMENT_WORKER_CONCURRENCY') ?? 2;
    let started = 0;
    while (!this.stopped && this.activeJobs.size < concurrency) {
      const claimed = await this.store.claimNext();
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
    const heartbeat = this.store.startHeartbeat(runId);
    try {
      const run = await this.store.loadInput(runId);
      if (!run?.fileBytes) {
        // La fila existe pero su documento ya no: cancelada a mitad, o un
        // intento anterior lo borró. No es reintentable, y tampoco es culpa del
        // documento: es un fallo del motor y se cuenta como tal.
        await this.store.closeRun(
          runId,
          {
            status: WorkerRunStatus.FAILED,
            reviewReason: null,
            rejectionReason: null,
            reviewPriority: null,
          },
          'BANK_STATEMENT_INPUT_MISSING',
          'El documento de entrada ya no está disponible.',
        );
        return;
      }

      /*
       * El padrón del tenant, cargado ANTES de analizar y sólo la primera vez.
       *
       * Sin esto, el primer documento de cada proceso encuentra el padrón sin cargar, la compuerta
       * de emisor lo toma —correctamente— como «no pude comprobar la licencia» y lo manda a la cola
       * con un motivo que apunta a la entidad. Se curaba solo en el siguiente documento, que es lo
       * que hacía imposible diagnosticarlo: pasaba una vez por despliegue y no volvía.
       */
      await this.institutions.ensureLoaded(run.tenantId);
      await this.store.setProgress(runId, 25);
      // El `correlationId` viaja al motor para que sus trazas se puedan unir a
      // la petición que originó la conversión. El motor lo sanea antes de
      // registrarlo, porque su origen último es una cabecera HTTP.
      const normalized = await this.engineInstance(run.tenantId).normalize(
        Buffer.from(run.fileBytes),
        {
          fileName: run.fileName,
          correlationId: run.correlationId,
        },
      );
      await this.store.setProgress(runId, 80);

      const outcome = outcomeForResult(normalized.quality, this.minimumExtractionConfidence());
      await this.store.complete(runId, normalized, outcome);
    } catch (error) {
      await this.recordFailure(runId, error);
    } finally {
      clearInterval(heartbeat);
    }
  }

  /**
   * Un fallo de negocio tiene tres desenlaces posibles —rechazo, revisión o fallo— y quién
   * es cuál lo decide `outcomeForError`, no este `catch`. Lo demás es infraestructura y se
   * reintenta con cota (ver `BankStatementRunStore.failOrRequeue`).
   */
  private async recordFailure(runId: bigint, error: unknown): Promise<void> {
    if (error instanceof StatementProcessingError) {
      await this.store.closeRun(
        runId,
        outcomeForError(error.code, error.disposition),
        error.code,
        error.message,
      );
      return;
    }
    await this.store.failOrRequeue(runId, error);
  }

  /** Confianza de extracción por debajo de la cual el resultado no se firma solo. */
  private minimumExtractionConfidence(): number {
    return this.config.get<number>('BANK_STATEMENT_REVIEW_EXTRACTION_CONFIDENCE') ?? 0.5;
  }

  private engineInstance(tenantId: bigint): StatementEngine {
    const key = tenantId.toString();
    let engine = this.engines.get(key);
    if (engine) return engine;
    engine = createStatementEngine({
      ...statementEngineOptions(this.config, this.institutions, tenantId),
      ...columnAdvisorOption(this.config),
    });
    this.engines.set(key, engine);
    return engine;
  }
}
