import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import { JobSignalService } from '../src/common/jobs/job-signal.service';
import type { PrismaService } from '../src/common/prisma/prisma.service';

describe('JobSignalService', () => {
  function service(prisma: unknown, config: Record<string, unknown> = {}): JobSignalService {
    return new JobSignalService(prisma as PrismaService, new ConfigService(config));
  }

  it('notify() sends the job name on the configured channel, inside the caller transaction', async () => {
    const $executeRaw = jest.fn().mockResolvedValue(undefined);
    const tx = { $executeRaw } as unknown as Prisma.TransactionClient;
    const signal = service({}, { JOB_WAKE_CHANNEL: 'atlas_jobs' });

    await signal.notify(tx, 'outbox-relay');

    expect($executeRaw).toHaveBeenCalledTimes(1);
    const sql = $executeRaw.mock.calls[0][0] as { values: unknown[] };
    expect(sql.values).toEqual(['atlas_jobs', 'outbox-relay']);
  });

  it('falls back to the default channel when the configured one is not a valid identifier', async () => {
    const $executeRaw = jest.fn().mockResolvedValue(undefined);
    const tx = { $executeRaw } as unknown as Prisma.TransactionClient;
    // Contains characters LISTEN/NOTIFY channel names cannot safely carry unquoted.
    const signal = service({}, { JOB_WAKE_CHANNEL: 'bad; DROP TABLE x --' });

    await signal.notify(tx, 'outbox-relay');

    const sql = $executeRaw.mock.calls[0][0] as { values: unknown[] };
    expect(sql.values[0]).toBe('atlas_jobs');
  });

  it('notify() is a no-op for a job name that is not a valid channel token', async () => {
    const $executeRaw = jest.fn();
    const tx = { $executeRaw } as unknown as Prisma.TransactionClient;
    const signal = service({});

    await signal.notify(tx, 'not a valid name!');

    expect($executeRaw).not.toHaveBeenCalled();
  });

  it('notifyDetached() fires and forgets through the shared Prisma client', async () => {
    const $executeRaw = jest.fn().mockResolvedValue(undefined);
    const signal = service({ $executeRaw });

    signal.notifyDetached('test-run');
    // Fire-and-forget: give the microtask queue a turn to run the promise chain.
    await Promise.resolve();
    await Promise.resolve();

    expect($executeRaw).toHaveBeenCalledTimes(1);
    const sql = $executeRaw.mock.calls[0][0] as { values: unknown[] };
    expect(sql.values).toEqual(['atlas_jobs', 'test-run']);
  });

  it('notifyDetached() never throws even when the underlying write rejects', async () => {
    const $executeRaw = jest.fn().mockRejectedValue(new Error('connection reset'));
    const signal = service({ $executeRaw });

    expect(() => signal.notifyDetached('test-run')).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
  });

  it('enabled reflects JOB_WAKE_ENABLED, defaulting to true', () => {
    expect(service({}).enabled).toBe(true);
    expect(service({}, { JOB_WAKE_ENABLED: false }).enabled).toBe(false);
  });

  it('connected is false until a listening connection is actually established', () => {
    expect(service({}).connected).toBe(false);
  });

  it('onWake registers a listener and the returned function unsubscribes it', () => {
    const signal = service({});
    const received: string[] = [];
    const unsubscribe = signal.onWake((channel) => received.push(channel));

    // No public way to fire a notification without a real connection; exercise the
    // registration contract directly, the way the scheduler consumes it.
    const listeners = (signal as unknown as { listeners: Set<(c: string) => void> }).listeners;
    expect(listeners.size).toBe(1);
    unsubscribe();
    expect(listeners.size).toBe(0);
    expect(received).toEqual([]);
  });

  it('onModuleDestroy is safe to call when no listening connection was ever opened', async () => {
    await expect(service({}).onModuleDestroy()).resolves.toBeUndefined();
  });
});
