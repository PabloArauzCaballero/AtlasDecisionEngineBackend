import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TestRunStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TestExecutionService } from './test-execution.service';

/** Database-backed worker with atomic claims, bounded concurrency and expiring leases. */
@Injectable()
export class TestRunWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TestRunWorkerService.name);
  private readonly activeJobs = new Set<Promise<void>>();
  private pollTimer?: ReturnType<typeof setTimeout>;
  private stopped = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly execution: TestExecutionService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    this.schedule(0);
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    await Promise.allSettled(this.activeJobs);
  }

  private schedule(delay = this.config.get<number>('TEST_RUN_WORKER_POLL_MS') ?? 500): void {
    if (this.stopped || this.pollTimer) return;
    this.pollTimer = setTimeout(() => {
      this.pollTimer = undefined;
      void this.poll();
    }, delay);
    this.pollTimer.unref?.();
  }

  private async poll(): Promise<void> {
    try {
      await this.recoverExpiredRuns();
      const concurrency = this.config.get<number>('TEST_RUN_WORKER_CONCURRENCY') ?? 2;
      while (!this.stopped && this.activeJobs.size < concurrency) {
        const runId = await this.claimNextRun();
        if (!runId) break;
        const job = this.execute(runId);
        this.activeJobs.add(job);
        void job
          .finally(() => {
            this.activeJobs.delete(job);
            this.schedule(0);
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
    } catch (error) {
      this.logger.error(
        `Test-run worker poll failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.schedule();
    }
  }

  private async claimNextRun(): Promise<bigint | null> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const candidate = await this.prisma.decisionTestRun.findFirst({
        where: { status: TestRunStatus.QUEUED },
        orderBy: [{ queuedAt: 'asc' }, { id: 'asc' }],
        select: { id: true },
      });
      if (!candidate) return null;

      const claimed = await this.prisma.decisionTestRun.updateMany({
        where: { id: candidate.id, status: TestRunStatus.QUEUED },
        data: {
          status: TestRunStatus.RUNNING,
          startedAt: new Date(),
          finishedAt: null,
          leaseExpiresAt: this.nextLease(),
          attemptCount: { increment: 1 },
        },
      });
      if (claimed.count === 1) return candidate.id;
    }
    return null;
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

  private async recoverExpiredRuns(): Promise<void> {
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
