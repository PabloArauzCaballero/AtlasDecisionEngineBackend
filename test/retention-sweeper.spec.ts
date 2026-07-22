import { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../src/common/prisma/prisma.service';
import { RetentionSweeperService } from '../src/modules/runtime/retention-sweeper.service';

describe('RetentionSweeperService', () => {
  function sweeper(prisma: unknown): RetentionSweeperService {
    return new RetentionSweeperService(
      prisma as PrismaService,
      new ConfigService({ RUNTIME_RETENTION_SWEEP_BATCH: 100 }),
    );
  }

  it('purges expired rows in bounded batches until a short batch is returned', async () => {
    const $executeRaw = jest
      .fn()
      .mockResolvedValueOnce(100)
      .mockResolvedValueOnce(100)
      .mockResolvedValueOnce(42);
    const purged = await sweeper({ $executeRaw }).sweep();

    expect(purged).toBe(242);
    expect($executeRaw).toHaveBeenCalledTimes(3);
  });

  it('stops after a single full-batch-then-empty cycle', async () => {
    const $executeRaw = jest.fn().mockResolvedValueOnce(0);
    const purged = await sweeper({ $executeRaw }).sweep();

    expect(purged).toBe(0);
    expect($executeRaw).toHaveBeenCalledTimes(1);
  });

  it('swallows a database failure instead of throwing', async () => {
    const $executeRaw = jest.fn().mockRejectedValue(new Error('connection reset'));

    await expect(sweeper({ $executeRaw }).sweep()).resolves.toBe(0);
  });
});
