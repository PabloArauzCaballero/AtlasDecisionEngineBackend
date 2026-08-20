import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { runsBackgroundJobs, workerRoleOf } from '../../common/config/worker-role';
import { BackgroundJob } from '../../common/jobs/background-job';
import { JobName } from '../../common/jobs/job-names';
import { JobSchedulerService } from '../../common/jobs/job-scheduler.service';
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
 * Es un trabajo puramente periódico: no lo despierta nadie (`wakeChannel: null`), porque
 * nada «ocurre» que lo haga urgente — solo pasa el tiempo. El {@link JobSchedulerService} le
 * da su cadencia y, como cada ciclo purga UN lote y devuelve cuántas filas borró, un backlog
 * grande se drena lote a lote sin que ningún ciclo mantenga un bloqueo largo ni bloquee el
 * apagado a mitad de un bucle interno.
 */
@Injectable()
export class RetentionSweeperService implements OnModuleInit, BackgroundJob {
  private readonly logger = new Logger(RetentionSweeperService.name);
  private readonly enabled: boolean;
  private readonly graceMs: number;
  private readonly batchSize: number;
  private readonly role: string;

  readonly name = JobName.RuntimeRetention;
  /** Ningún productor puede hacer esta purga urgente: solo la hace urgente el reloj. */
  readonly wakeChannel = null;
  readonly minIdleIntervalMs: number;
  readonly maxIdleIntervalMs: number;
  readonly initialDelayMs: number;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
    private readonly scheduler: JobSchedulerService,
  ) {
    this.role = workerRoleOf(config);
    this.enabled =
      runsBackgroundJobs(config) &&
      (config.get<boolean>('RUNTIME_RETENTION_SWEEP_ENABLED') ?? true);
    const intervalMs = config.get<number>('RUNTIME_RETENTION_SWEEP_INTERVAL_MS') ?? 3_600_000;
    // Mínimo y máximo iguales: la purga tiene una cadencia fija, no un retroceso adaptativo.
    this.minIdleIntervalMs = intervalMs;
    this.maxIdleIntervalMs = intervalMs;
    // Retrasa la primera pasada para que no compita con el arranque.
    this.initialDelayMs = Math.min(intervalMs, 60_000);
    this.graceMs =
      (config.get<number>('RUNTIME_IDEMPOTENCY_RETENTION_GRACE_HOURS') ?? 24) * 60 * 60 * 1_000;
    this.batchSize = config.get<number>('RUNTIME_RETENTION_SWEEP_BATCH') ?? 1_000;
  }

  onModuleInit(): void {
    if (!this.enabled) {
      this.logger.log(`Runtime retention sweep not started (WORKER_ROLE=${this.role})`);
      return;
    }
    this.scheduler.register(this);
  }

  /** Un ciclo del orquestador: purga un lote. Devolver `>0` encadena el siguiente lote. */
  async runOnce(): Promise<number> {
    return this.sweep();
  }

  /**
   * Deletes one bounded batch of expired idempotency rows and returns how many. Exposed for
   * tests and ops. A failure is operationally benign — the rows are simply retried on the
   * next cycle — so it is logged and swallowed instead of crashing the process; devolver 0
   * hace además que el orquestador espere el intervalo completo antes de reintentar, en vez
   * de encadenar borrados contra una base de datos que acaba de rechazar uno.
   */
  async sweep(): Promise<number> {
    const cutoff = new Date(Date.now() - this.graceMs);
    try {
      // Dentro de `$transaction` porque `decision_runtime_idempotency` tiene RLS FORZADA y
      // una sentencia cruda suelta no fija `app.tenant_id`: sobre una conexión del pool que
      // ya sirvió a un tenant la política evalúa `''::bigint` y aborta con 22P02. Ver la
      // nota extensa en `outbox-relay.service.ts`. El `catch` de abajo lo convertía en un
      // «barrido fallido» periódico que nunca purgaba nada.
      const [purged] = await this.prisma.$transaction([
        this.prisma.$executeRaw(Prisma.sql`
        DELETE FROM decision_runtime_idempotency
        WHERE id IN (
          SELECT id
          FROM decision_runtime_idempotency
          WHERE expires_at < ${cutoff}
          ORDER BY expires_at ASC
          LIMIT ${this.batchSize}
        )
      `),
      ]);
      if (purged > 0) {
        this.logger.log(`Purged ${purged} expired runtime idempotency row(s)`);
      }
      return purged;
    } catch (error) {
      this.logger.error(
        `Runtime retention sweep failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 0;
    }
  }
}
