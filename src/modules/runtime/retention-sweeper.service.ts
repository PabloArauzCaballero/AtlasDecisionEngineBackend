import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Purges expired runtime idempotency rows on a background schedule.
 *
 * `decision_runtime_idempotency` is the highest-volume table in the platform: every
 * decision execution reserves a row. Each row carries an `expires_at`, but nothing
 * removed the expired ones, so the table grew without bound. This sweeper deletes rows
 * whose expiry has passed by a configurable grace margin, in bounded batches so no
 * single statement holds a long lock.
 *
 * A row is only ever purged once it can no longer serve a replay: past `expiresAt`, a
 * repeated request re-claims the key (see IdempotencyService.reserve), so deleting an
 * expired row changes no observable behaviour. The grace margin adds slack against a
 * replay racing the expiry boundary.
 *
 * The scheduling mirrors {@link TestRunWorkerService}: a self-rescheduling unref'd
 * timer, so the platform depends on no external scheduler and the timer never keeps the
 * process alive on shutdown.
 */
@Injectable()
export class RetentionSweeperService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RetentionSweeperService.name);
  private readonly enabled: boolean;
  private readonly intervalMs: number;
  private readonly graceMs: number;
  private readonly batchSize: number;
  private sweepTimer?: ReturnType<typeof setTimeout>;
  private running?: Promise<void>;
  private stopped = false;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.enabled = config.get<boolean>('RUNTIME_RETENTION_SWEEP_ENABLED') ?? true;
    this.intervalMs = config.get<number>('RUNTIME_RETENTION_SWEEP_INTERVAL_MS') ?? 3_600_000;
    this.graceMs =
      (config.get<number>('RUNTIME_IDEMPOTENCY_RETENTION_GRACE_HOURS') ?? 24) * 60 * 60 * 1_000;
    this.batchSize = config.get<number>('RUNTIME_RETENTION_SWEEP_BATCH') ?? 1_000;
  }

  onModuleInit(): void {
    if (!this.enabled) {
      this.logger.log('Runtime retention sweep disabled by configuration');
      return;
    }
    // Delay the first sweep so it never competes with startup work, then fall into the
    // steady cadence. Both are jittered by the same interval-relative delay.
    this.schedule(Math.min(this.intervalMs, 60_000));
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.sweepTimer) clearTimeout(this.sweepTimer);
    await this.running;
  }

  private schedule(delay = this.intervalMs): void {
    if (this.stopped || this.sweepTimer) return;
    this.sweepTimer = setTimeout(() => {
      this.sweepTimer = undefined;
      this.running = this.sweep()
        .then(() => undefined)
        .finally(() => {
          this.running = undefined;
          this.schedule();
        });
    }, delay);
    this.sweepTimer.unref?.();
  }

  /** Deletes expired idempotency rows in bounded batches. Exposed for tests and ops. */
  async sweep(): Promise<number> {
    const cutoff = new Date(Date.now() - this.graceMs);
    let purged = 0;
    try {
      for (;;) {
        if (this.stopped) break;
        const deleted = await this.prisma.$executeRaw(Prisma.sql`
          DELETE FROM decision_runtime_idempotency
          WHERE id IN (
            SELECT id
            FROM decision_runtime_idempotency
            WHERE expires_at < ${cutoff}
            ORDER BY expires_at ASC
            LIMIT ${this.batchSize}
          )
        `);
        purged += deleted;
        if (deleted < this.batchSize) break;
      }
      if (purged > 0) {
        this.logger.log(`Purged ${purged} expired runtime idempotency row(s)`);
      }
    } catch (error) {
      // A sweep failure is operationally benign — the rows are simply retried next
      // interval — and must never crash the process, so it is logged and swallowed.
      this.logger.error(
        `Runtime retention sweep failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return purged;
  }
}
