import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, StatementReviewReason, WorkerRunStatus } from '@prisma/client';
import { runsBackgroundJobs, workerRoleOf } from '../../../common/config/worker-role';
import { BackgroundJob } from '../../../common/jobs/background-job';
import { JobName } from '../../../common/jobs/job-names';
import { JobSchedulerService } from '../../../common/jobs/job-scheduler.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { StatementProcessingError } from './core/domain/errors';
import { InstitutionCatalogService } from './institutions/institution-catalog.service';
import { createStatementEngine, type StatementEngine } from './core/statement-engine';
import {
  outcomeForError,
  outcomeForResult,
  toReview,
  type StatementOutcome,
} from './statement-outcome';
import { MessagingTraceService } from '../../../common/observability/messaging-trace.service';
import {
  APP_ATTRIBUTES,
  MESSAGING_SYSTEM,
} from '../../../common/observability/telemetry.constants';
import type { NormalizedBankStatement } from './core/engine/normalized/normalized-model';

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
   *
   * Hay uno POR TENANT, y no es un detalle de implementación: el padrón de
   * entidades es tenant-scoped, así que un motor compartido atribuiría los
   * documentos de un cliente contra las entidades que administró otro. Son unos
   * pocos objetos sin estado por tenant; el coste es despreciable al lado de esa
   * confusión.
   */
  private readonly engines = new Map<string, StatementEngine>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly scheduler: JobSchedulerService,
    private readonly messagingTrace: MessagingTraceService,
    private readonly institutions: InstitutionCatalogService,
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
          tenantId: true,
          fileBytes: true,
          fileName: true,
          attemptCount: true,
          correlationId: true,
        },
      });
      if (!run?.fileBytes) {
        // La fila existe pero su documento ya no: cancelada a mitad, o un
        // intento anterior lo borró. No es reintentable, y tampoco es culpa del
        // documento: es un fallo del motor y se cuenta como tal.
        await this.closeRun(
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
      await this.setProgress(runId, 25);
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
      await this.setProgress(runId, 80);

      const warnings = normalized.quality.warnings;
      const outcome = outcomeForResult(normalized.quality, this.minimumExtractionConfidence());
      await this.prisma.bankStatementRun.update({
        where: { id: runId },
        data: {
          ...this.outcomeFields(outcome),
          progress: 100,
          resultJson: normalized as unknown as Prisma.InputJsonValue,
          warningsJson: warnings as unknown as Prisma.InputJsonValue,
          confidence: normalized.quality.overallConfidence,
          // La confianza de CLASIFICACIÓN viaja aparte de la de extracción: es la
          // que separa «no sabemos leerlo» de «no es esto». Ver ADR y el enum
          // `StatementRejectionReason`.
          documentTypeConfidence: normalized.quality.documentConfidence,
          institutionId: normalized.institution.id,
          transactionCount: normalized.transactions.length,
          ...affordabilityColumns(normalized),
          leaseExpiresAt: null,
        },
      });
    } catch (error) {
      await this.recordFailure(runId, error);
    } finally {
      clearInterval(heartbeat);
    }
  }

  /**
   * Traduce un desenlace a las columnas que lo describen, con dos reglas que no
   * pueden quedar a criterio de quien escriba la próxima llamada:
   *
   * - **`finishedAt` sólo cuando el caso TERMINA.** Un pendiente no ha terminado;
   *   marcarlo cerrado haría que el «tiempo pendiente» de la cola contara desde
   *   un final que no ocurrió, y que las métricas de latencia del worker
   *   promediaran esperas humanas con tiempos de máquina.
   * - **Una ejecución que TERMINA deja el progreso al 100.** El motor lo dejaba
   *   donde estuviera al decidir el desenlace —25 % en un PDF rechazado, que es
   *   lo que había avanzado al leer la carátula— y la consola pintaba esa barra
   *   a un cuarto, quieta, bajo la insignia del rechazo: se leía como un worker
   *   colgado cuando lo que hubo fue un fallo rápido y deliberado. Un pendiente
   *   NO lo toca: ahí todavía queda trabajo, sólo que lo hace una persona.
   * - **El documento se conserva mientras alguien tenga que mirarlo.** La regla
   *   de privacidad del módulo es borrar el PDF en la misma transacción que
   *   cierra la ejecución, y sigue intacta: un caso en revisión no está cerrado.
   *   Sin esto, la cola ofrecería «reprocesar» y «ver el documento» sobre una
   *   fila que ya no tiene documento, que es peor que no ofrecerlo.
   */
  private outcomeFields(outcome: StatementOutcome): Prisma.BankStatementRunUpdateInput {
    const enRevision = outcome.status === WorkerRunStatus.PENDING_REVIEW;
    return {
      status: outcome.status,
      reviewReason: outcome.reviewReason,
      rejectionReason: outcome.rejectionReason,
      reviewPriority: outcome.reviewPriority,
      reviewOpenedAt: enRevision ? new Date() : null,
      finishedAt: enRevision ? null : new Date(),
      progress: enRevision ? undefined : 100,
      fileBytes: enRevision ? undefined : null,
    };
  }

  /**
   * Distingue el fallo que no tiene arreglo del que sí.
   *
   * Un PDF que no es un estado de cuenta va a fallar igual las tres veces:
   * reintentarlo sólo gasta el worker y retrasa la respuesta al usuario. Un
   * corte de base de datos, en cambio, se cura solo. Tratarlos igual es lo que
   * convierte una cola en un bucle.
   *
   * Lo que este método ya NO hace es meterlo todo en `FAILED`. Un fallo de
   * negocio tiene tres desenlaces posibles —rechazo, revisión o fallo— y quién
   * es cuál lo decide `outcomeForError`, no este `catch`.
   */
  private async recordFailure(runId: bigint, error: unknown): Promise<void> {
    const businessFailure = error instanceof StatementProcessingError;
    if (businessFailure) {
      await this.closeRun(
        runId,
        outcomeForError(error.code, error.disposition),
        error.code,
        error.message,
      );
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
      await this.closeRun(
        runId,
        {
          status: WorkerRunStatus.FAILED,
          reviewReason: null,
          rejectionReason: null,
          reviewPriority: null,
        },
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

  /**
   * Cierra una ejecución en curso con el desenlace que le corresponda.
   *
   * El código y el mensaje se conservan SIEMPRE, también cuando el desenlace es
   * revisión o rechazo: son lo que la cola enseña como «motivo técnico» y lo que
   * permite responder por qué un documento acabó donde acabó meses después. Un
   * pendiente sin código sería una fila que dice «alguien mírame» sin decir qué.
   */
  private async closeRun(
    runId: bigint,
    outcome: StatementOutcome,
    code: string,
    message: string,
  ): Promise<void> {
    await this.prisma.bankStatementRun.updateMany({
      where: { id: runId, status: WorkerRunStatus.RUNNING },
      data: {
        ...(this.outcomeFields(outcome) as Prisma.BankStatementRunUpdateManyMutationInput),
        errorCode: code,
        errorMessage: message,
        leaseExpiresAt: null,
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
        progress: 100,
        leaseExpiresAt: null,
        fileBytes: null,
      },
    });
    if (agotadas.count > 0) {
      this.logger.warn(`Cerradas ${agotadas.count} conversión(es) sin reintentos disponibles`);
    }

    await this.deriveLongWaits();
  }

  /**
   * Deriva a revisión lo que lleva demasiado tiempo esperando SIN QUE NADIE LO
   * HAYA TOMADO.
   *
   * Es el hueco que el presupuesto de procesamiento no puede cubrir: aquél corta
   * un análisis que EMPEZÓ, y esto ataja el caso en que no empezó ninguno —más
   * cola que capacidad, o réplicas saturadas—. Sin esto, «tarda mucho» y «nadie
   * la va a tomar en un rato» se ven exactamente igual desde la pantalla: «En
   * cola», indefinidamente, sobre un documento por el que alguien espera.
   *
   * Lo que NO cubre, y conviene no creerse lo contrario: si ninguna réplica tiene
   * el worker encendido, esto tampoco corre —cuelga de `runOnce`—. Ese caso lo
   * delata el panel de salud del worker, que es donde se mira, y no una fila que
   * se derivaría sola a una cola que nadie está atendiendo.
   *
   * Sale de la cola del worker y entra en la de personas, que es lo honesto: el
   * documento sigue siendo válido y lo que falló fue la capacidad de procesarlo
   * a tiempo. El PDF se conserva —el caso no está cerrado— para que se pueda
   * reprocesar desde la propia cola cuando el worker se recupere.
   */
  private async deriveLongWaits(): Promise<void> {
    const budgetMs = this.config.get<number>('BANK_STATEMENT_QUEUE_WAIT_BUDGET_MS') ?? 180_000;
    const outcome = toReview(StatementReviewReason.TIMEOUT);
    const derived = await this.prisma.bankStatementRun.updateMany({
      where: {
        status: WorkerRunStatus.QUEUED,
        queuedAt: { lt: new Date(Date.now() - budgetMs) },
      },
      data: {
        status: outcome.status,
        reviewReason: outcome.reviewReason,
        reviewPriority: outcome.reviewPriority,
        reviewOpenedAt: new Date(),
        progress: 0,
        leaseExpiresAt: null,
        errorCode: 'BANK_STATEMENT_QUEUE_WAIT_EXCEEDED',
        errorMessage: `La conversión esperó más de ${String(Math.round(budgetMs / 1_000))} s sin que ningún worker la tomara.`,
      },
    });
    if (derived.count > 0) {
      this.logger.warn(
        `Derivadas a revisión ${derived.count} conversión(es) por espera en cola excesiva`,
      );
    }
  }

  /** Confianza de extracción por debajo de la cual el resultado no se firma solo. */
  private minimumExtractionConfidence(): number {
    return this.config.get<number>('BANK_STATEMENT_REVIEW_EXTRACTION_CONFIDENCE') ?? 0.5;
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

  private engineInstance(tenantId: bigint): StatementEngine {
    const key = tenantId.toString();
    let engine = this.engines.get(key);
    if (engine) return engine;
    engine = createStatementEngine({
      limits: {
        maxFileSizeBytes: this.config.get<number>('BANK_STATEMENT_MAX_UPLOAD_BYTES') ?? 10_485_760,
        maxPageCount: 60,
        processingTimeoutMs: this.config.get<number>('BANK_STATEMENT_TIMEOUT_MS') ?? 60_000,
      },
      // Las fronteras del triage se leen del entorno y no se compilan: son lo
      // primero que hay que recalibrar cuando entren documentos reales.
      triage: {
        accept: this.config.get<number>('BANK_STATEMENT_DOCUMENT_ACCEPT_CONFIDENCE'),
        review: this.config.get<number>('BANK_STATEMENT_DOCUMENT_REVIEW_CONFIDENCE'),
      },
      // El padrón administrable del tenant, resuelto en cada documento: revocar
      // una licencia desde el portal no puede exigir reiniciar el worker.
      institutions: this.institutions.registryFor(tenantId),
      issuerGate: {
        requireLicensedIssuer:
          this.config.get<boolean>('BANK_STATEMENT_REQUIRE_LICENSED_ISSUER') ?? true,
      },
    });
    this.engines.set(key, engine);
    return engine;
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

/**
 * Las columnas de capacidad de pago que acompañan al resultado.
 *
 * Se escriben con la MISMA sentencia que el resultado, y no en un segundo
 * `update`: dos escrituras dejarían un instante en el que la ejecución publica
 * movimientos sin la evaluación que los interpreta, y una pantalla que lea justo
 * ahí enseñaría un extracto aceptado con capacidad cero — que se lee como un
 * rechazo y no lo es.
 *
 * `affordabilityJson` guarda la evaluación entera y las demás columnas repiten
 * lo que se filtra y se ordena. La duplicación es deliberada; ver el modelo.
 */
function affordabilityColumns(
  normalized: NormalizedBankStatement,
): Prisma.BankStatementRunUpdateInput {
  const affordability = normalized.affordability;
  return {
    affordabilityJson: affordability as unknown as Prisma.InputJsonValue,
    monthsComplete: affordability.coverage.monthsComplete,
    /*
     * Puntaje y banda sólo cuando la evaluación es ELEGIBLE. Un extracto que no
     * llega a los meses mínimos no tiene capacidad de pago «cero»: no tiene
     * capacidad de pago medida, y escribir 0 en la columna por la que después se
     * ordena convertiría una ausencia de dato en la peor calificación posible.
     */
    affordabilityScore: affordability.eligible ? affordability.score : null,
    affordabilityBand: affordability.eligible ? affordability.band : null,
    monthlyIncome: affordability.eligible ? affordability.income.monthlyRecognized : null,
    monthlyObligations: affordability.eligible ? affordability.obligations.monthly : null,
    maxAffordableInstallment: affordability.eligible
      ? affordability.capacity.maxAffordableInstallment
      : null,
    authenticityVerdict: normalized.authenticity.verdict,
    authenticityScore: normalized.authenticity.suspicionScore,
  };
}
