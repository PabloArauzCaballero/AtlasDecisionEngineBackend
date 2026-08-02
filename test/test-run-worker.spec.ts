import { ConfigService } from '@nestjs/config';
import type { JobSchedulerService } from '../src/common/jobs/job-scheduler.service';
import type { PrismaService } from '../src/common/prisma/prisma.service';
import type { TestExecutionService } from '../src/modules/testing/test-execution.service';
import { TestRunWorkerService } from '../src/modules/testing/test-run-worker.service';

/** El orquestador no interviene en estas pruebas: solo se ejercen los métodos internos. */
const fakeScheduler = { register: jest.fn(), wake: jest.fn() } as unknown as JobSchedulerService;

describe('TestRunWorkerService', () => {
  function worker(prisma: unknown): TestRunWorkerService {
    return new TestRunWorkerService(
      prisma as unknown as PrismaService,
      {} as TestExecutionService,
      new ConfigService({}),
      fakeScheduler,
    );
  }

  it('claims the row returned by the FOR UPDATE SKIP LOCKED select', async () => {
    const $queryRaw = jest.fn().mockResolvedValue([{ id: 42n }]);
    const runId = await (
      worker({ $queryRaw }) as unknown as { claimNextRun: () => Promise<bigint | null> }
    ).claimNextRun();

    expect(runId).toBe(42n);
    expect($queryRaw).toHaveBeenCalledTimes(1);
  });

  it('returns null when no queued run is available to claim', async () => {
    const $queryRaw = jest.fn().mockResolvedValue([]);
    const runId = await (
      worker({ $queryRaw }) as unknown as { claimNextRun: () => Promise<bigint | null> }
    ).claimNextRun();

    expect(runId).toBeNull();
  });

  it('recovers legacy RUNNING jobs without a lease and clears partial evidence', async () => {
    const tx = {
      decisionTestRun: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      decisionTestCoverage: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
      decisionTestCaseRun: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const prisma = {
      decisionTestRun: { findMany: jest.fn().mockResolvedValue([{ id: 15n }]) },
      $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<void>) => callback(tx)),
    };
    const worker = new TestRunWorkerService(
      prisma as unknown as PrismaService,
      {} as TestExecutionService,
      new ConfigService({ TEST_RUN_WORKER_CONCURRENCY: 2 }),
      fakeScheduler,
    );

    // El barrido de leases vencidos ahora se acota por intervalo (ver
    // TEST_RUN_RECOVERY_INTERVAL_MS); forzar lastRecoveryAt a 0 reproduce la primera pasada
    // que este test ejercita, sin depender de un temporizador real.
    (worker as unknown as { lastRecoveryAt: number }).lastRecoveryAt = 0;
    await (worker as unknown as { recoverExpiredRuns: () => Promise<void> }).recoverExpiredRuns();

    expect(prisma.decisionTestRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: 'RUNNING',
          OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: expect.any(Date) } }],
        },
      }),
    );
    expect(tx.decisionTestRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 15n, status: 'RUNNING' }),
        data: expect.objectContaining({ status: 'QUEUED', startedAt: null, leaseExpiresAt: null }),
      }),
    );
    expect(tx.decisionTestCoverage.deleteMany).toHaveBeenCalledWith({
      where: { testRunId: 15n },
    });
    expect(tx.decisionTestCaseRun.deleteMany).toHaveBeenCalledWith({
      where: { testRunId: 15n },
    });
  });

  describe('runOnce (orchestrator entry point)', () => {
    it('claims runs up to the configured concurrency and returns how many it started', async () => {
      const claimed = [10n, 11n];
      const $queryRaw = jest.fn(async () => (claimed.length ? [{ id: claimed.shift() }] : []));
      const executeQueuedRun = jest.fn().mockResolvedValue(undefined);
      const prisma = {
        $queryRaw,
        decisionTestRun: { findMany: jest.fn().mockResolvedValue([]) },
      };
      const testWorker = new TestRunWorkerService(
        prisma as unknown as PrismaService,
        { executeQueuedRun } as unknown as TestExecutionService,
        new ConfigService({ TEST_RUN_WORKER_CONCURRENCY: 2 }),
        fakeScheduler,
      );

      const started = await testWorker.runOnce();

      expect(started).toBe(2);
      expect($queryRaw).toHaveBeenCalledTimes(3); // two claims + one that finds nothing
      await new Promise((resolve) => setImmediate(resolve));
      expect(executeQueuedRun).toHaveBeenCalledWith(10n);
      expect(executeQueuedRun).toHaveBeenCalledWith(11n);
      expect(fakeScheduler.wake).toHaveBeenCalledWith('test-run');
    });

    it('returns zero without claiming when the queue is empty', async () => {
      const $queryRaw = jest.fn().mockResolvedValue([]);
      const prisma = {
        $queryRaw,
        decisionTestRun: { findMany: jest.fn().mockResolvedValue([]) },
      };
      const testWorker = new TestRunWorkerService(
        prisma as unknown as PrismaService,
        {} as TestExecutionService,
        new ConfigService({}),
        fakeScheduler,
      );

      expect(await testWorker.runOnce()).toBe(0);
    });
  });
});
