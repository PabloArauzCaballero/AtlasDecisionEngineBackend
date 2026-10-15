import { Injectable } from '@nestjs/common';
import { Counter, Gauge, Histogram } from 'prom-client';
import { MetricsRegistry } from './metrics-registry';

/**
 * Métricas de los trabajos de fondo (common/jobs): ciclos, duración, despertares por señal y último éxito.
 */
@Injectable()
export class JobMetrics {
  // --- Orquestación de trabajos de fondo (common/jobs) ---
  //
  // El reparto entre `work` e `idle` es el dato que justifica la cadencia: si casi todas
  // las corridas son `idle`, el techo de retroceso puede subir; si el ratio se invierte,
  // el worker va justo y toca escalarlo. Sin esa separación solo se ve «el trabajo corrió».

  private readonly jobRuns = new Counter({
    name: 'atlas_job_runs_total',
    help: 'Ciclos de un trabajo de fondo, por resultado (work | idle | error).',
    labelNames: ['job', 'outcome'],
    registers: [],
  });

  private readonly jobItems = new Counter({
    name: 'atlas_job_items_total',
    help: 'Unidades de trabajo procesadas por un trabajo de fondo.',
    labelNames: ['job'],
    registers: [],
  });

  private readonly jobDuration = new Histogram({
    name: 'atlas_job_duration_ms',
    help: 'Duración de un ciclo de trabajo de fondo, en milisegundos.',
    labelNames: ['job'],
    buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1_000, 5_000, 30_000],
    registers: [],
  });

  private readonly jobWakeups = new Counter({
    name: 'atlas_job_wakeups_total',
    help: 'Despertares por señal (pg_notify) recibidos por un trabajo de fondo.',
    labelNames: ['job'],
    registers: [],
  });

  /**
   * Marca temporal del último ciclo sin error. Es la señal de alerta útil del worker: un
   * contador de errores puede quedarse quieto porque el trabajo dejó de ejecutarse, cosa
   * que solo se ve si además se observa cuánto hace que no termina bien.
   */
  private readonly jobLastSuccess = new Gauge({
    name: 'atlas_job_last_success_timestamp_seconds',
    help: 'Marca Unix del último ciclo completado sin error, por trabajo de fondo.',
    labelNames: ['job'],
    registers: [],
  });

  constructor(shared: MetricsRegistry = new MetricsRegistry()) {
    shared.registry.registerMetric(this.jobRuns);
    shared.registry.registerMetric(this.jobItems);
    shared.registry.registerMetric(this.jobDuration);
    shared.registry.registerMetric(this.jobWakeups);
    shared.registry.registerMetric(this.jobLastSuccess);
  }

  /** Registra un ciclo de trabajo de fondo. `outcome` ∈ work | idle | error. */
  recordJobRun(
    job: string,
    outcome: 'work' | 'idle' | 'error',
    durationMs: number,
    items: number,
  ): void {
    this.jobRuns.inc({ job, outcome });
    this.jobDuration.observe({ job }, durationMs);
    if (items > 0) this.jobItems.inc({ job }, items);
  }

  /** Cuenta un despertar por señal, para poder leer cuánto aporta frente al sondeo. */
  recordJobWake(job: string): void {
    this.jobWakeups.inc({ job });
  }

  setJobLastSuccess(job: string, unixSeconds: number): void {
    this.jobLastSuccess.set({ job }, unixSeconds);
  }
}
