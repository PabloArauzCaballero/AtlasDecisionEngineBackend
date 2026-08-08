import { ConfigService } from '@nestjs/config';
import type { BackgroundJob } from '../src/common/jobs/background-job';
import { JobSchedulerService } from '../src/common/jobs/job-scheduler.service';
import type { JobSignalService } from '../src/common/jobs/job-signal.service';
import type { MetricsService } from '../src/common/observability/metrics.service';
import { TracingService } from '../src/common/observability/tracing.service';

/**
 * `JobSchedulerService` promete explícitamente una cosa sobre concurrencia: «dentro de un
 * proceso no hay dos ejecuciones simultáneas del mismo trabajo». `runNow` no la cumplía —
 * esperaba a `inFlight` pero no ocupaba la ranura ni cancelaba el temporizador pendiente, así
 * que un ciclo agendado podía arrancar el MISMO trabajo en paralelo. Medido antes del
 * arreglo: dos ejecuciones vivas a la vez.
 *
 * Con lotes que se reclaman por `FOR UPDATE SKIP LOCKED` eso no corrompe datos, pero duplica
 * el trabajo y vuelve intermitente cualquier prueba que use `runNow` — y deja escrita en el
 * comentario de la clase una garantía que no se cumplía.
 *
 * Va en un fichero aparte de `job-scheduler.spec.ts` a propósito: cubre una propiedad
 * concreta y así no compite por el mismo fichero con el trabajo en curso sobre los trabajos
 * de fondo.
 */
function fakeSignal(): JobSignalService {
  return {
    enabled: false,
    connected: false,
    onWake: jest.fn().mockReturnValue(() => undefined),
    startListening: jest.fn(),
    notify: jest.fn().mockResolvedValue(undefined),
    notifyDetached: jest.fn(),
  } as unknown as JobSignalService;
}

function fakeMetrics(): MetricsService {
  return {
    recordJobRun: jest.fn(),
    recordJobWake: jest.fn(),
    setJobLastSuccess: jest.fn(),
  } as unknown as MetricsService;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('JobSchedulerService: exclusión mutua dentro del proceso', () => {
  /** Trabajo lento que lleva la cuenta de cuántas ejecuciones suyas están vivas a la vez. */
  function countingJob(durationMs: number, processed = 0) {
    const state = { active: 0, maxActive: 0, runs: 0 };
    const job: BackgroundJob = {
      name: 'counting-job',
      runOnce: async () => {
        state.active += 1;
        state.runs += 1;
        state.maxActive = Math.max(state.maxActive, state.active);
        await sleep(durationMs);
        state.active -= 1;
        return processed;
      },
    };
    return { job, state };
  }

  function makeScheduler() {
    const scheduler = new JobSchedulerService(
      new ConfigService({
        WORKER_ROLE: 'ALL',
        JOB_INITIAL_DELAY_MS: 5,
        JOB_MIN_IDLE_INTERVAL_MS: 5,
        JOB_MAX_IDLE_INTERVAL_MS: 20,
      }),
      fakeSignal(),
      fakeMetrics(),
      new TracingService(),
    );
    return scheduler;
  }

  it('runNow no se solapa con el ciclo agendado', async () => {
    const scheduler = makeScheduler();
    const { job, state } = countingJob(60);
    scheduler.register(job);
    scheduler.onModuleInit();
    scheduler.onApplicationBootstrap();

    // Deja correr el ciclo normal para que quede un temporizador pendiente, y fuerza una
    // ejecución manual justo encima: ese es el solape que se medía antes.
    await sleep(80);
    await scheduler.runNow('counting-job');
    await sleep(120);
    await scheduler.onModuleDestroy();

    expect(state.maxActive).toBe(1);
    expect(state.runs).toBeGreaterThan(1);
  }, 15_000);

  it('el trabajo sigue sondeando después de una ejecución manual', async () => {
    // `runNow` cancela el temporizador pendiente para tomar la ranura; si no lo repusiera,
    // una sola ejecución manual dejaría el trabajo sin sondear el resto de la vida del proceso.
    const scheduler = makeScheduler();
    const { job, state } = countingJob(5);
    scheduler.register(job);
    scheduler.onModuleInit();
    scheduler.onApplicationBootstrap();

    await sleep(40);
    await scheduler.runNow('counting-job');
    const afterManual = state.runs;
    await sleep(150);
    await scheduler.onModuleDestroy();

    expect(state.runs).toBeGreaterThan(afterManual);
  }, 15_000);

  it('dos runNow simultáneos se serializan entre sí', async () => {
    const scheduler = makeScheduler();
    const { job, state } = countingJob(40);
    scheduler.register(job);
    scheduler.onModuleInit();
    // Sin arrancar: aísla el solape entre dos llamadas manuales del que provoca el temporizador.

    await Promise.all([scheduler.runNow('counting-job'), scheduler.runNow('counting-job')]);
    await scheduler.onModuleDestroy();

    expect(state.runs).toBe(2);
    expect(state.maxActive).toBe(1);
  }, 15_000);

  it('sigue rechazando un trabajo que no existe', async () => {
    const scheduler = makeScheduler();
    scheduler.onModuleInit();
    await expect(scheduler.runNow('missing-job')).rejects.toThrow(/missing-job/);
  });
});
