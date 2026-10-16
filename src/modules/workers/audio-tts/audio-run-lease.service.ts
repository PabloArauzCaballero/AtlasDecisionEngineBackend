import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, WorkerRunStatus } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { describeError } from './describe-error';

export interface ClaimedRun {
  id: bigint;
  trace_carrier: unknown;
}

/** El arrendamiento de una locución: reclamarla, renovarlo mientras trabaja y recuperar las que lo perdieron. */
@Injectable()
export class AudioRunLeaseService {
  private readonly logger = new Logger(AudioRunLeaseService.name);
  private lastRecoveryAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Reclama la ejecución encolada más antigua, de forma atómica.
   *
   * `FOR UPDATE SKIP LOCKED` bloquea exactamente una fila y pasa por encima de
   * las que otra réplica está reclamando. `$transaction` es obligatorio: la
   * tabla tiene RLS forzada y una sentencia cruda suelta no fija `app.tenant_id`.
   */
  async claimNextRun(): Promise<ClaimedRun | null> {
    const maxAttempts = this.maxAttempts();
    const [rows] = await this.prisma.$transaction([
      this.prisma.$queryRaw<ClaimedRun[]>(Prisma.sql`
      UPDATE decision_audio_tts_run
      SET status = 'RUNNING',
          started_at = now(),
          finished_at = NULL,
          lease_expires_at = ${this.nextLease()},
          attempt_count = attempt_count + 1
      WHERE id = (
        SELECT id
        FROM decision_audio_tts_run
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

  /** Devuelve a la cola lo que perdió su arrendamiento, y cierra lo agotado. */
  async recoverExpiredRuns(): Promise<void> {
    const intervalMs = this.config.get<number>('AUDIO_TTS_RECOVERY_INTERVAL_MS') ?? 30_000;
    if (Date.now() - this.lastRecoveryAt < intervalMs) return;
    this.lastRecoveryAt = Date.now();

    const maxAttempts = this.maxAttempts();
    const vencido = {
      status: WorkerRunStatus.RUNNING,
      OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: new Date() } }],
    };

    const recovered = await this.prisma.audioTtsRun.updateMany({
      where: { ...vencido, attemptCount: { lt: maxAttempts } },
      data: {
        status: WorkerRunStatus.QUEUED,
        startedAt: null,
        leaseExpiresAt: null,
        progress: 0,
      },
    });
    if (recovered.count > 0) {
      this.logger.warn(`Recuperadas ${recovered.count} locución(es) con arrendamiento vencido`);
    }

    // Lo que agotó sus intentos se CIERRA, no vuelve a la cola: `claimNextRun`
    // filtra por `attempt_count < maxAttempts`, así que devolverlo a QUEUED lo
    // dejaría ahí para siempre enseñando «En cola» sobre trabajo que nadie hará.
    const agotadas = await this.prisma.audioTtsRun.updateMany({
      where: {
        attemptCount: { gte: maxAttempts },
        OR: [vencido, { status: WorkerRunStatus.QUEUED }],
      },
      data: {
        status: WorkerRunStatus.FAILED,
        errorCode: 'AUDIO_RETRIES_EXHAUSTED',
        errorMessage: 'La locución se interrumpió y ya no quedaban reintentos.',
        finishedAt: new Date(),
        leaseExpiresAt: null,
      },
    });
    if (agotadas.count > 0) {
      this.logger.warn(`Cerradas ${agotadas.count} locución(es) sin reintentos disponibles`);
    }
  }

  /** Renueva el arrendamiento mientras el proveedor sintetiza. */
  startHeartbeat(runId: bigint): ReturnType<typeof setInterval> {
    const leaseSeconds = this.leaseSeconds();
    const timer = setInterval(
      () => {
        void this.prisma.audioTtsRun
          .updateMany({
            where: { id: runId, status: WorkerRunStatus.RUNNING },
            data: { leaseExpiresAt: this.nextLease() },
          })
          .catch((error: unknown) =>
            this.logger.warn(
              `No se pudo renovar el arrendamiento de ${runId.toString()}: ${describeError(error)}`,
            ),
          );
      },
      Math.max(10_000, Math.floor((leaseSeconds * 1_000) / 3)),
    );
    timer.unref?.();
    return timer;
  }

  async setProgress(runId: bigint, progress: number): Promise<void> {
    await this.prisma.audioTtsRun.updateMany({
      where: { id: runId, status: WorkerRunStatus.RUNNING },
      data: { progress },
    });
  }

  maxAttempts(): number {
    return this.config.get<number>('AUDIO_TTS_MAX_ATTEMPTS') ?? 3;
  }

  leaseSeconds(): number {
    return this.config.get<number>('AUDIO_TTS_LEASE_SECONDS') ?? 300;
  }

  nextLease(): Date {
    return new Date(Date.now() + this.leaseSeconds() * 1_000);
  }
}
