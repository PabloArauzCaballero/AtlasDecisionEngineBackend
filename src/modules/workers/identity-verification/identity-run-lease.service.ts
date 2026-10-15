import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, WorkerRunStatus } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { describeError } from './describe-error';

/** Fila reclamada por el worker, con el portador de traza que viajó con ella. */
export interface ClaimedRun {
  readonly id: bigint;
  readonly trace_carrier: unknown;
}

/** El lease de una verificación: reclamarla, renovarla mientras trabaja y recuperar las que lo perdieron. */
@Injectable()
export class IdentityRunLeaseService {
  private readonly logger = new Logger(IdentityRunLeaseService.name);
  private lastRecoveryAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Reclama la verificación encolada más antigua, de forma atómica.
   *
   * `FOR UPDATE SKIP LOCKED` bloquea exactamente una fila y pasa por encima de
   * las que otro worker está reclamando, así que varias réplicas compiten sin
   * bloquearse. La cota de intentos va en el `WHERE`: una ejecución que agotó
   * sus reintentos no debe volver a reclamarse nunca.
   */
  async claimNextRun(): Promise<ClaimedRun | null> {
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

  /**
   * Devuelve a la cola lo que perdió su lease porque el proceso que lo tenía
   * murió, y CIERRA lo que ya agotó sus intentos: `claimNextRun` filtra por
   * `attempt_count < maxAttempts`, así que devolver a QUEUED una ejecución
   * agotada la dejaría ahí para siempre enseñando «En cola».
   */
  async recoverExpiredRuns(): Promise<void> {
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
        progress: 100,
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
  startHeartbeat(runId: bigint): ReturnType<typeof setInterval> {
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

  async setProgress(runId: bigint, progress: number): Promise<void> {
    await this.prisma.identityVerificationRun.updateMany({
      where: { id: runId, status: WorkerRunStatus.RUNNING },
      data: { progress },
    });
  }

  nextLease(): Date {
    const seconds = this.config.get<number>('IDENTITY_LEASE_SECONDS') ?? 300;
    return new Date(Date.now() + seconds * 1_000);
  }
}
