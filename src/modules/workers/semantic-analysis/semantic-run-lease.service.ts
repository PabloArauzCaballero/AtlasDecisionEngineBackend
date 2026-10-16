import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, WorkerRunStatus } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { describeError } from './describe-error';
import { isRecord, type ClaimedRow, type ClaimedRun } from './semantic-run.types';

/** El arrendamiento de un análisis: reclamarlo, renovarlo mientras trabaja y recuperar los que lo perdieron. */
@Injectable()
export class SemanticRunLeaseService {
  private readonly logger = new Logger(SemanticRunLeaseService.name);
  private lastRecoveryAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Reclama la ejecución encolada más antigua y devuelve la solicitud completa.
   *
   * Devuelve la fila entera y no sólo su identificador —a diferencia del worker
   * de extractos— porque el `SemanticAnalysisProcessor` absorbido recibe un
   * `SemanticAnalysisRequest`, no una referencia a base de datos. Es el precio
   * de conservar su firma intacta, y es barato: el texto ya está en la fila que
   * se acaba de escribir.
   */
  async claimNextRun(): Promise<ClaimedRun | null> {
    const maxAttempts = this.config.get<number>('SEMANTIC_ANALYSIS_MAX_ATTEMPTS') ?? 3;
    // `$transaction` obligatorio: `decision_semantic_analysis_run` tiene RLS FORZADA y una
    // sentencia cruda suelta no fija `app.tenant_id`, así que sobre una conexión del pool
    // que ya sirvió a un tenant la política aborta con 22P02. Ver `outbox-relay.service.ts`.
    const [rows] = await this.prisma.$transaction([
      this.prisma.$queryRaw<ClaimedRow[]>(Prisma.sql`
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
                input_metadata, requested_by, attempt_count, trace_carrier
    `),
    ]);
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      attemptCount: row.attempt_count,
      traceCarrier: row.trace_carrier,
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

  async recoverExpiredRuns(): Promise<void> {
    const intervalMs = this.config.get<number>('SEMANTIC_ANALYSIS_RECOVERY_INTERVAL_MS') ?? 30_000;
    if (Date.now() - this.lastRecoveryAt < intervalMs) return;
    this.lastRecoveryAt = Date.now();

    const maxAttempts = this.config.get<number>('SEMANTIC_ANALYSIS_MAX_ATTEMPTS') ?? 3;
    const leaseVencido = {
      status: WorkerRunStatus.RUNNING,
      OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: new Date() } }],
    };

    const recovered = await this.prisma.semanticAnalysisRun.updateMany({
      where: { ...leaseVencido, attemptCount: { lt: maxAttempts } },
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

    /*
     * Lo que ya agotó sus intentos se CIERRA, no vuelve a la cola.
     *
     * `claimNextRun` filtra por `attempt_count < maxAttempts`, así que devolver
     * a QUEUED una ejecución agotada la deja ahí para siempre: nadie la reclama
     * y nadie la cierra. En pantalla se lee «En cola», que es una promesa —
     * alguien la está esperando— sobre un trabajo que no va a ocurrir jamás.
     *
     * Se barre también lo que YA está en QUEUED con los intentos agotados, y no
     * sólo lo que acaba de perder el lease: esas filas son el residuo de las
     * recuperaciones anteriores y nada más las tocaría. Reclamarlas es imposible
     * por ese mismo filtro, así que cerrarlas no compite con ningún worker.
     */
    const agotadas = await this.prisma.semanticAnalysisRun.updateMany({
      where: {
        attemptCount: { gte: maxAttempts },
        OR: [leaseVencido, { status: WorkerRunStatus.QUEUED }],
      },
      data: {
        status: WorkerRunStatus.FAILED,
        errorCode: 'SEMANTIC_RETRIES_EXHAUSTED',
        errorMessage: 'El análisis se interrumpió y ya no quedaban reintentos.',
        finishedAt: new Date(),
        leaseExpiresAt: null,
      },
    });
    if (agotadas.count > 0) {
      this.logger.warn(`Cerrados ${agotadas.count} análisis sin reintentos disponibles`);
    }
  }

  startHeartbeat(runId: bigint): ReturnType<typeof setInterval> {
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

  async setProgress(runId: bigint, progress: number): Promise<void> {
    await this.prisma.semanticAnalysisRun.updateMany({
      where: { id: runId, status: WorkerRunStatus.RUNNING },
      data: { progress },
    });
  }

  nextLease(): Date {
    const seconds = this.config.get<number>('SEMANTIC_ANALYSIS_LEASE_SECONDS') ?? 120;
    return new Date(Date.now() + seconds * 1_000);
  }
}
