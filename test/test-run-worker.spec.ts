import { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../src/common/prisma/prisma.service';
import type { TestExecutionService } from '../src/modules/testing/test-execution.service';
import { TestRunWorkerService } from '../src/modules/testing/test-run-worker.service';

describe('TestRunWorkerService', () => {
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
    );

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
});
