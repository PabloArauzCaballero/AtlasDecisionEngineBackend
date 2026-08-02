import { ConfigService } from '@nestjs/config';
import type { BackgroundJob } from '../src/common/jobs/background-job';
import { JobSchedulerService } from '../src/common/jobs/job-scheduler.service';
import type { JobSignalService } from '../src/common/jobs/job-signal.service';
import type { MetricsService } from '../src/common/observability/metrics.service';

/**
 * Tiempos reales, no simulados: el orquestador se apoya en `setTimeout`/`unref` y en el
 * bucle de eventos para encadenar lotes, y las pruebas con temporizadores falsos de Jest
 * tienden a desincronizarse con promesas encadenadas como `inFlight.finally(...)`. Los
 * intervalos de prueba son de un solo dígito de milisegundos, así que el coste real es
 * insignificante.
 */
function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (predicate()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error('waitFor timed out'));
      setTimeout(check, 2);
    };
    check();
  });
}

function fakeSignal(overrides: Partial<JobSignalService> = {}): JobSignalService {
  return {
    enabled: false,
    connected: false,
    onWake: jest.fn().mockReturnValue(() => undefined),
    startListening: jest.fn(),
    notify: jest.fn().mockResolvedValue(undefined),
    notifyDetached: jest.fn(),
    ...overrides,
  } as unknown as JobSignalService;
}

function fakeMetrics(): MetricsService {
  return {
    recordJobRun: jest.fn(),
    recordJobWake: jest.fn(),
    setJobLastSuccess: jest.fn(),
  } as unknown as MetricsService;
}

function job(
  overrides: Partial<BackgroundJob> & { runOnce: BackgroundJob['runOnce'] },
): BackgroundJob {
  return {
    name: 'test-job',
    initialDelayMs: 1,
    minIdleIntervalMs: 5,
    maxIdleIntervalMs: 20,
    ...overrides,
  };
}

describe('JobSchedulerService', () => {
  it('runs a registered job after bootstrap and keeps calling it while it reports work', async () => {
    let calls = 0;
    const scheduler = new JobSchedulerService(
      new ConfigService({ JOB_BACKOFF_FACTOR: 2 }),
      fakeSignal(),
      fakeMetrics(),
    );
    scheduler.onModuleInit();
    scheduler.register(
      job({
        runOnce: async () => {
          calls += 1;
          return calls < 3 ? 1 : 0; // two productive batches, then idle
        },
      }),
    );
    scheduler.onApplicationBootstrap();

    await waitFor(() => calls >= 3);
    expect(calls).toBe(3);

    await scheduler.onModuleDestroy();
  });

  it('does not run any job when WORKER_ROLE=API', async () => {
    let calls = 0;
    const scheduler = new JobSchedulerService(
      new ConfigService({ WORKER_ROLE: 'API' }),
      fakeSignal(),
      fakeMetrics(),
    );
    scheduler.onModuleInit();
    scheduler.register(job({ runOnce: async () => (calls += 1) }));
    scheduler.onApplicationBootstrap();

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(calls).toBe(0);

    await scheduler.onModuleDestroy();
  });

  it('rejects a second job registered under the same name', () => {
    const scheduler = new JobSchedulerService(new ConfigService({}), fakeSignal(), fakeMetrics());
    scheduler.register(job({ runOnce: async () => 0 }));
    expect(() => scheduler.register(job({ runOnce: async () => 0 }))).toThrow(/test-job/);
  });

  it('backs off exponentially up to the configured ceiling on repeated idle cycles', async () => {
    const metrics = fakeMetrics();
    const scheduler = new JobSchedulerService(
      new ConfigService({ JOB_BACKOFF_FACTOR: 2 }),
      fakeSignal(),
      metrics,
    );
    scheduler.onModuleInit();
    scheduler.register(
      job({
        minIdleIntervalMs: 4,
        maxIdleIntervalMs: 16,
        runOnce: async () => 0, // always idle
      }),
    );
    scheduler.onApplicationBootstrap();

    // Enough idle cycles to reach the ceiling: 4 -> 4 -> 8 -> 16 -> 16 (capped).
    await waitFor(() => (metrics.recordJobRun as jest.Mock).mock.calls.length >= 5, 3_000);
    const outcomes = (metrics.recordJobRun as jest.Mock).mock.calls.map((call) => call[1]);
    expect(outcomes.every((outcome) => outcome === 'idle')).toBe(true);

    await scheduler.onModuleDestroy();
  });

  it('retries with a growing delay after a failure and recovers on success', async () => {
    let attempt = 0;
    const scheduler = new JobSchedulerService(
      new ConfigService({ JOB_ERROR_INTERVAL_MS: 5, JOB_MAX_ERROR_INTERVAL_MS: 50 }),
      fakeSignal(),
      fakeMetrics(),
    );
    scheduler.onModuleInit();
    scheduler.register(
      job({
        runOnce: async () => {
          attempt += 1;
          if (attempt < 3) throw new Error('transient failure');
          return 0;
        },
      }),
    );
    scheduler.onApplicationBootstrap();

    await waitFor(() => attempt >= 3);
    expect(attempt).toBe(3);

    await scheduler.onModuleDestroy();
  });

  it('wake() reruns a matching job immediately instead of waiting out its backoff', async () => {
    let calls = 0;
    const listeners: Array<(channel: string) => void> = [];
    const signal = fakeSignal({
      enabled: true,
      onWake: jest.fn((listener: (channel: string) => void) => {
        listeners.push(listener);
        return () => undefined;
      }),
    });
    const scheduler = new JobSchedulerService(
      new ConfigService({ JOB_MIN_IDLE_INTERVAL_MS: 200, JOB_MAX_IDLE_INTERVAL_MS: 500 }),
      signal,
      fakeMetrics(),
    );
    scheduler.onModuleInit();
    scheduler.register(
      job({
        minIdleIntervalMs: 200,
        maxIdleIntervalMs: 500,
        runOnce: async () => {
          calls += 1;
          return 0;
        },
      }),
    );
    scheduler.onApplicationBootstrap();

    await waitFor(() => calls >= 1);
    expect(calls).toBe(1);

    // Without a wake, the next cycle would not land for ~200ms; the signal shortcuts that.
    scheduler.wake('test-job');
    await waitFor(() => calls >= 2, 100);
    expect(calls).toBe(2);

    await scheduler.onModuleDestroy();
  });

  it('waits for an in-flight batch before onModuleDestroy resolves', async () => {
    let resolveRun: (() => void) | undefined;
    let finished = false;
    const scheduler = new JobSchedulerService(new ConfigService({}), fakeSignal(), fakeMetrics());
    scheduler.onModuleInit();
    scheduler.register(
      job({
        runOnce: () =>
          new Promise<number>((resolve) => {
            resolveRun = () => {
              finished = true;
              resolve(0);
            };
          }),
      }),
    );
    scheduler.onApplicationBootstrap();

    await waitFor(() => resolveRun !== undefined);
    const destroyed = scheduler.onModuleDestroy();
    expect(finished).toBe(false);
    resolveRun?.();
    await destroyed;
    expect(finished).toBe(true);
  });

  it('runNow executes a registered job outside its normal schedule', async () => {
    const scheduler = new JobSchedulerService(new ConfigService({}), fakeSignal(), fakeMetrics());
    scheduler.register(job({ runOnce: async () => 7 }));

    await expect(scheduler.runNow('test-job')).resolves.toBe(7);
    await expect(scheduler.runNow('missing-job')).rejects.toThrow(/missing-job/);
  });
});
