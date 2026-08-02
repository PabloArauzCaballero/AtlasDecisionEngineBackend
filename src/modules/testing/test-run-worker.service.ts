import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, TestRunStatus } from '@prisma/client';
import { runsBackgroundJobs, workerRoleOf } from '../../common/config/worker-role';
import { BackgroundJob } from '../../common/jobs/background-job';
import { JobName } from '../../common/jobs/job-names';
import { JobSchedulerService } from '../../common/jobs/job-scheduler.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TestExecutionService } from './test-execution.service';

/**
 * Database-backed worker with atomic claims, bounded concurrency and expiring leases.
 *
 * El orquestador ({@link JobSchedulerService}) decide cuándo se reclama; aquí solo queda el
 * reclamo y la ejecución. Una corrida encolada anuncia su llegada con `pg_notify` dentro de
 * la misma transacción que la crea, así que arranca al ritmo del commit y no al del sondeo:
 * el intervalo de 500 ms que este worker usaba dejó de ser la cota de latencia y pasó a ser
 * solo el suelo de la red de seguridad.
 */
@Injectable()
export class TestRunWorkerService implements OnModuleInit, OnModuleDestroy, BackgroundJob {
  private readonly logger = new Logger(TestRunWorkerService.name);
  private readonly activeJobs = new Set<Promise<void>>();
  private stopped = false;

  readonly name = JobName.TestRun;
  readonly minIdleIntervalMs: number;
  readonly maxIdleIntervalMs: number;
  readonly initialDelayMs = 0;

  /** Último barrido de leases vencidos; ver {@link recoverExpiredRuns}. */
  private lastRecoveryAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly execution: TestExecutionService,
    private readonly config: ConfigService,
    private readonly scheduler: JobSchedulerService,
  ) {
    this.minIdleIntervalMs = config.get<number>('TEST_RUN_WORKER_POLL_MS') ?? 500;
    this.maxIdleIntervalMs = Math.max(
      config.get<number>('TEST_RUN_WORKER_MAX_POLL_MS') ?? 30_000,
      this.minIdleIntervalMs,
    );
  }

  onModuleInit(): void {
    if (!runsBackgroundJobs(this.config)) {
      this.logger.log(`Test run worker not started: WORKER_ROLE=${workerRoleOf(this.config)}`);
      return;
    }
    if (!(this.config.get<boolean>('TEST_RUN_WORKER_ENABLED') ?? true)) {
      this.logger.log('Test run worker disabled by configuration');
      return;
    }
    this.scheduler.register(this);
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    await Promise.allSettled(this.activeJobs);
  }

  /**
   * Un ciclo: recupera leases vencidos si toca y reclama corridas hasta llenar la
   * concurrencia. Devuelve cuántas arrancó, de modo que el orquestador vuelva de inmediato
   * mientras siga habiendo cola y retroceda cuando se vacíe.
   */
  async runOnce(): Promise<number> {
    await this.recoverExpiredRuns();
    const concurrency = this.config.get<number>('TEST_RUN_WORKER_CONCURRENCY') ?? 2;
    let started = 0;
    while (!this.stopped && this.activeJobs.size < concurrency) {
      const runId = await this.claimNextRun();
      if (!runId) break;
      started += 1;
      const job = this.execute(runId);
      this.activeJobs.add(job);
      void job
        .finally(() => {
          this.activeJobs.delete(job);
          // Se liberó una ranura de concurrencia: puede haber cola esperándola, y esperar
          // el retroceso dejaría el worker ocioso con trabajo disponible.
          this.scheduler.wake(this.name);
        })
        .catch((error: unknown) => {
          // execute() already records the run failure; this protects the
          // detached worker task if even that final persistence step fails.
          this.logger.error(
            `Detached test-run task failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        });
    }
    return started;
  }

  /**
   * Claims the oldest queued run atomically. `FOR UPDATE SKIP LOCKED` lets the
   * inner select lock exactly one queued row while stepping over rows another
   * worker is already claiming, so the previous find-then-optimistic-update race
   * (and its bounded retry loop) disappears and the claim scales cleanly across
   * concurrent workers. Enum literals are untyped so Postgres resolves them against
   * the column's enum type; the lease is parameterized as a timestamptz.
   */
  private async claimNextRun(): Promise<bigint | null> {
    const rows = await this.prisma.$queryRaw<Array<{ id: bigint }>>(Prisma.sql`
      UPDATE decision_test_run
      SET status = 'RUNNING',
          started_at = now(),
          finished_at = NULL,
          lease_expires_at = ${this.nextLease()},
          attempt_count = attempt_count + 1
      WHERE id = (
        SELECT id
        FROM decision_test_run
        WHERE status = 'QUEUED'
        ORDER BY queued_at ASC, id ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING id
    `);
    return rows[0]?.id ?? null;
  }

  private async execute(runId: bigint): Promise<void> {
    const leaseSeconds = this.config.get<number>('TEST_RUN_LEASE_SECONDS') ?? 300;
    const heartbeat = setInterval(
      () => {
        void this.prisma.decisionTestRun
          .updateMany({
            where: { id: runId, status: TestRunStatus.RUNNING },
            data: { leaseExpiresAt: this.nextLease() },
          })
          .catch((error: unknown) =>
            this.logger.warn(
              `Could not renew lease for test run ${runId.toString()}: ${
                error instanceof Error ? error.message : String(error)
              }`,
            ),
          );
      },
      Math.max(10_000, Math.floor((leaseSeconds * 1_000) / 3)),
    );
    heartbeat.unref?.();

    try {
      await this.execution.executeQueuedRun(runId);
    } catch (error) {
      this.logger.error(
        `Test run ${runId.toString()} failed unexpectedly: ${
          error instanceof Error ? (error.stack ?? error.message) : String(error)
        }`,
      );
      await this.prisma.decisionTestRun.updateMany({
        where: { id: runId, status: TestRunStatus.RUNNING },
        data: {
          status: TestRunStatus.ERROR,
          finishedAt: new Date(),
          leaseExpiresAt: null,
        },
      });
    } finally {
      clearInterval(heartbeat);
    }
  }

  /**
   * Devuelve a la cola las corridas cuyo lease venció porque el proceso que las tenía murió.
   *
   * Se ejecuta como mucho una vez por `TEST_RUN_RECOVERY_INTERVAL_MS` y no en cada ciclo: un
   * lease dura minutos (`TEST_RUN_LEASE_SECONDS`, 300 s por defecto), así que buscar
   * vencidos dos veces por segundo no podía encontrar nada nuevo — era un `findMany` fijo
   * por réplica cuyo resultado estaba garantizado vacío el 99,9 % de las veces.
   */
  private async recoverExpiredRuns(): Promise<void> {
    const intervalMs = this.config.get<number>('TEST_RUN_RECOVERY_INTERVAL_MS') ?? 30_000;
    if (Date.now() - this.lastRecoveryAt < intervalMs) return;
    this.lastRecoveryAt = Date.now();

    const now = new Date();
    const expiredLease = {
      OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }],
    };
    const stale = await this.prisma.decisionTestRun.findMany({
      where: {
        status: TestRunStatus.RUNNING,
        ...expiredLease,
      },
      orderBy: { leaseExpiresAt: 'asc' },
      take: this.config.get<number>('TEST_RUN_WORKER_CONCURRENCY') ?? 2,
      select: { id: true },
    });

    for (const run of stale) {
      await this.prisma.$transaction(async (tx) => {
        const reset = await tx.decisionTestRun.updateMany({
          where: {
            id: run.id,
            status: TestRunStatus.RUNNING,
            ...expiredLease,
          },
          data: {
            status: TestRunStatus.QUEUED,
            queuedAt: new Date(),
            startedAt: null,
            finishedAt: null,
            leaseExpiresAt: null,
          },
        });
        if (!reset.count) return;
        await tx.decisionTestCoverage.deleteMany({
          where: { testRunId: run.id },
        });
        await tx.decisionTestCaseRun.deleteMany({
          where: { testRunId: run.id },
        });
      });
      this.logger.warn(`Recovered expired test run ${run.id.toString()}`);
    }
  }

  private nextLease(): Date {
    const seconds = this.config.get<number>('TEST_RUN_LEASE_SECONDS') ?? 300;
    return new Date(Date.now() + seconds * 1_000);
  }
}
