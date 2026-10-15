import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, WorkerRunStatus } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { NormalizedBankStatement } from './core/engine/normalized/normalized-model';
import type { StatementOutcome } from './statement-outcome';
import { affordabilityColumns, outcomeFields } from './bank-statement-run-columns';

/** Fila reclamada por el worker, con el portador de traza que viajó con ella. */
export interface ClaimedRun {
  readonly id: bigint;
  readonly trace_carrier: unknown;
}

/**
 * El ciclo de vida persistido de una conversión de extracto: reclamo atómico, lease,
 * progreso, cierre, reintento y recuperación. No sabe convertir nada; el worker decide
 * qué hacer con un documento y este almacén sólo escribe lo que le dicen en la fila.
 */
@Injectable()
export class BankStatementRunStore {
  private readonly logger = new Logger('BankStatementRunWorkerService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** Las columnas de la ejecución que el motor necesita para convertir el documento. */
  loadInput(runId: bigint) {
    return this.prisma.bankStatementRun.findUnique({
      where: { id: runId },
      select: {
        tenantId: true,
        fileBytes: true,
        fileName: true,
        attemptCount: true,
        correlationId: true,
      },
    });
  }

  /**
   * Reclama la ejecución encolada más antigua, de forma atómica.
   *
   * `FOR UPDATE SKIP LOCKED` bloquea exactamente una fila y pasa por encima de
   * las que otro worker está reclamando, así que varias réplicas compiten sin
   * bloquearse. La cota de intentos va en el `WHERE`: una ejecución que agotó
   * sus reintentos no debe volver a reclamarse nunca.
   */
  async claimNext(): Promise<ClaimedRun | null> {
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

  /** Guarda el resultado de una conversión terminada y suelta el lease. */
  async complete(
    runId: bigint,
    normalized: NormalizedBankStatement,
    outcome: StatementOutcome,
  ): Promise<void> {
    await this.prisma.bankStatementRun.update({
      where: { id: runId },
      data: {
        ...outcomeFields(outcome),
        progress: 100,
        resultJson: normalized as unknown as Prisma.InputJsonValue,
        warningsJson: normalized.quality.warnings as unknown as Prisma.InputJsonValue,
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
  }

  /**
   * Distingue el fallo que no tiene arreglo del que sí, para el que no es de negocio.
   *
   * Un corte de base de datos se cura solo: se reintenta hasta agotar la cota y entonces se
   * cierra. Tratarlo como un fallo de negocio —o reintentar sin cota— es lo que convierte una
   * cola en un bucle.
   */
  async failOrRequeue(runId: bigint, error: unknown): Promise<void> {
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
        // Mismo motivo que en la recuperación: la espera de un reintento empieza al reencolar.
        queuedAt: new Date(),
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
  async closeRun(
    runId: bigint,
    outcome: StatementOutcome,
    code: string,
    message: string,
  ): Promise<void> {
    await this.prisma.bankStatementRun.updateMany({
      where: { id: runId, status: WorkerRunStatus.RUNNING },
      data: {
        ...(outcomeFields(outcome) as Prisma.BankStatementRunUpdateManyMutationInput),
        errorCode: code,
        errorMessage: message,
        leaseExpiresAt: null,
      },
    });
  }

  /**
   * Renueva el lease mientras el job trabaja. Sin esto, un PDF que tarda más
   * que el lease sería recuperado por otra réplica y procesado dos veces.
   */
  startHeartbeat(runId: bigint): ReturnType<typeof setInterval> {
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

  async setProgress(runId: bigint, progress: number): Promise<void> {
    await this.prisma.bankStatementRun.updateMany({
      where: { id: runId, status: WorkerRunStatus.RUNNING },
      data: { progress },
    });
  }

  private nextLease(): Date {
    const seconds = this.config.get<number>('BANK_STATEMENT_LEASE_SECONDS') ?? 300;
    return new Date(Date.now() + seconds * 1_000);
  }
}

export function describeError(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}
