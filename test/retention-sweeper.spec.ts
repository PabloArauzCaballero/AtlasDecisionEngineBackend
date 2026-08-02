import { ConfigService } from '@nestjs/config';
import type { JobSchedulerService } from '../src/common/jobs/job-scheduler.service';
import type { PrismaService } from '../src/common/prisma/prisma.service';
import { RetentionSweeperService } from '../src/modules/runtime/retention-sweeper.service';

const fakeScheduler = { register: jest.fn() } as unknown as JobSchedulerService;

describe('RetentionSweeperService', () => {
  function sweeper(prisma: unknown): RetentionSweeperService {
    return new RetentionSweeperService(
      prisma as PrismaService,
      new ConfigService({ RUNTIME_RETENTION_SWEEP_BATCH: 100 }),
      fakeScheduler,
    );
  }

  // El orquestador —no el servicio— es quien ahora encadena lotes sucesivos mientras
  // sweep() devuelva > 0; una sola llamada aquí ejercita exactamente un lote.
  it('purges one bounded batch and returns how many rows it deleted', async () => {
    const $executeRaw = jest.fn().mockResolvedValueOnce(100);
    const purged = await sweeper({ $executeRaw }).sweep();

    expect(purged).toBe(100);
    expect($executeRaw).toHaveBeenCalledTimes(1);
  });

  it('returns zero when nothing is due', async () => {
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
