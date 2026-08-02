import { Injectable } from '@nestjs/common';
import { Counter, Gauge, Histogram, Registry } from 'prom-client';

/**
 * Prometheus metrics backed by prom-client.
 *
 * The previous in-process Map tracked only sum/count/max per route, so there was no way
 * to compute p95/p99 — the SLI that actually matters for an online decision engine — and
 * the max gauge was monotonic for the life of the process (it never decayed, so a single
 * slow request made the panel look permanently degraded). A Histogram with latency
 * buckets lets Prometheus derive real quantiles, and per-replica scraping aggregates
 * correctly across pods.
 *
 * Each instance owns its Registry rather than the global default one, so constructing a
 * second service (in tests, or a second Nest context) never trips prom-client's
 * "metric already registered" guard.
 */
@Injectable()
export class MetricsService {
  private readonly registry = new Registry();
  private readonly startedAt = Date.now();

  private readonly httpRequests = new Counter({
    name: 'atlas_http_requests_total',
    help: 'Total HTTP requests.',
    labelNames: ['method', 'route', 'status'],
    registers: [this.registry],
  });

  // Buckets in milliseconds, tuned for an online decision endpoint: dense below 250ms
  // where the SLO lives, then coarser out to the timeout ceiling.
  private readonly httpDuration = new Histogram({
    name: 'atlas_http_request_duration_ms',
    help: 'HTTP request duration in milliseconds.',
    labelNames: ['method', 'route', 'status'],
    buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
    registers: [this.registry],
  });

  private readonly decisions = new Counter({
    name: 'atlas_decisions_total',
    help: 'Total decision executions by outcome and status.',
    labelNames: ['outcome', 'status'],
    registers: [this.registry],
  });

  private readonly providerFailures = new Counter({
    name: 'atlas_provider_failures_total',
    help: 'External provider resolution failures.',
    labelNames: ['provider', 'reason'],
    registers: [this.registry],
  });

  private readonly errors = new Counter({
    name: 'atlas_errors_total',
    help: 'Handled errors by domain code.',
    labelNames: ['code'],
    registers: [this.registry],
  });

  private readonly uptime = new Gauge({
    name: 'atlas_process_uptime_seconds',
    help: 'Process uptime in seconds.',
    registers: [this.registry],
  });

  // Depth of the transactional outbox backlog. Sampled by the relay on every poll; a
  // sustained climb means dispatch is failing or cannot keep up with producers.
  private readonly outboxPending = new Gauge({
    name: 'atlas_outbox_pending',
    help: 'Outbox events currently PENDING dispatch.',
    registers: [this.registry],
  });

  private readonly outboxDispatched = new Counter({
    name: 'atlas_outbox_dispatched_total',
    help: 'Outbox events successfully dispatched to the event bus.',
    labelNames: ['event_type'],
    registers: [this.registry],
  });

  private readonly outboxDead = new Counter({
    name: 'atlas_outbox_dead_total',
    help: 'Outbox events moved to the DEAD letter state after exhausting retries.',
    labelNames: ['event_type'],
    registers: [this.registry],
  });

  private readonly notificationsCreated = new Counter({
    name: 'atlas_notification_created_total',
    help: 'Notifications projected into the inbox, by originating event type.',
    labelNames: ['event_type'],
    registers: [this.registry],
  });

  // --- §12: observabilidad de contratos, intermedias, campos calculados y QA ---

  private readonly contractViolations = new Counter({
    name: 'atlas_contract_violations_total',
    help: 'Violaciones de contrato por ámbito (INPUT/INTERMEDIATE/OUTPUT) y restricción incumplida.',
    labelNames: ['scope', 'constraint'],
    registers: [this.registry],
  });

  private readonly intermediateEvents = new Counter({
    name: 'atlas_intermediate_variable_events_total',
    help: 'Ciclo de vida de las variables intermedias: creadas, consumidas o nunca usadas.',
    labelNames: ['event'],
    registers: [this.registry],
  });

  private readonly missingRequiredOutputs = new Counter({
    name: 'atlas_missing_required_output_total',
    help: 'Ejecuciones que terminaron sin producir una salida obligatoria.',
    labelNames: ['artifact_code'],
    registers: [this.registry],
  });

  private readonly calculatedFields = new Counter({
    name: 'atlas_calculated_field_executions_total',
    help: 'Ejecuciones de campos calculados por resultado.',
    labelNames: ['field_code', 'outcome'],
    registers: [this.registry],
  });

  private readonly calculatedFieldDuration = new Histogram({
    name: 'atlas_calculated_field_duration_ms',
    help: 'Duración de la ejecución de un campo calculado, en milisegundos.',
    labelNames: ['field_code'],
    buckets: [1, 2, 5, 10, 25, 50, 100, 250, 500],
    registers: [this.registry],
  });

  private readonly chainDepth = new Histogram({
    name: 'atlas_chained_artifact_depth',
    help: 'Profundidad alcanzada al encadenar artefactos en una ejecución.',
    buckets: [1, 2, 3, 4, 5, 8, 12],
    registers: [this.registry],
  });

  /**
   * Espera por el bloqueo de la cadena de auditoría. La cadena está encadenada por hash, así
   * que las escrituras auditadas de un mismo tenant se serializan por diseño; lo que no había
   * era forma de saber cuánto cuesta eso en producción. Sin este dato, "la auditoría es el
   * cuello de botella" es folclore, y la alternativa (agrupar la cadena) es una reescritura
   * que nadie debería emprender sin una medida.
   */
  private readonly auditChainLockWait = new Histogram({
    name: 'atlas_audit_chain_lock_wait_ms',
    help: 'Tiempo esperando el bloqueo de la cadena de auditoría del tenant, en milisegundos.',
    buckets: [0.5, 1, 2, 5, 10, 25, 50, 100, 250, 1_000],
    registers: [this.registry],
  });

  /**
   * Divergencias entre lo que decide un ambiente no productivo y lo que decidiría PROD con
   * las MISMAS entradas (§12). `difference` dice en qué se separan: el resultado principal,
   * el resto de la salida, los códigos de razón, o `NONE` cuando coinciden — contar también
   * las coincidencias es lo que permite leer la métrica como una tasa y no como un número
   * suelto sin denominador.
   */
  private readonly devProdResultDiff = new Counter({
    name: 'atlas_dev_prod_result_diff_total',
    help: 'Comparaciones entre una simulación y el artefacto activo en PROD, por tipo de diferencia.',
    labelNames: ['artifact_code', 'difference'],
    registers: [this.registry],
  });

  private readonly blockedCycles = new Counter({
    name: 'atlas_blocked_reference_cycles_total',
    help: 'Referencias entre artefactos rechazadas por crear un ciclo o exceder la profundidad.',
    labelNames: ['reason'],
    registers: [this.registry],
  });

  private readonly qaCases = new Counter({
    name: 'atlas_qa_generated_cases_total',
    help: 'Casos generados por el QA Lab, por resultado.',
    labelNames: ['outcome'],
    registers: [this.registry],
  });

  private readonly qaCounterexamples = new Counter({
    name: 'atlas_qa_counterexamples_total',
    help: 'Contraejemplos mínimos almacenados, por propiedad violada.',
    labelNames: ['property'],
    registers: [this.registry],
  });

  // --- Orquestación de trabajos de fondo (common/jobs) ---
  //
  // El reparto entre `work` e `idle` es el dato que justifica la cadencia: si casi todas
  // las corridas son `idle`, el techo de retroceso puede subir; si el ratio se invierte,
  // el worker va justo y toca escalarlo. Sin esa separación solo se ve «el trabajo corrió».

  private readonly jobRuns = new Counter({
    name: 'atlas_job_runs_total',
    help: 'Ciclos de un trabajo de fondo, por resultado (work | idle | error).',
    labelNames: ['job', 'outcome'],
    registers: [this.registry],
  });

  private readonly jobItems = new Counter({
    name: 'atlas_job_items_total',
    help: 'Unidades de trabajo procesadas por un trabajo de fondo.',
    labelNames: ['job'],
    registers: [this.registry],
  });

  private readonly jobDuration = new Histogram({
    name: 'atlas_job_duration_ms',
    help: 'Duración de un ciclo de trabajo de fondo, en milisegundos.',
    labelNames: ['job'],
    buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1_000, 5_000, 30_000],
    registers: [this.registry],
  });

  private readonly jobWakeups = new Counter({
    name: 'atlas_job_wakeups_total',
    help: 'Despertares por señal (pg_notify) recibidos por un trabajo de fondo.',
    labelNames: ['job'],
    registers: [this.registry],
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
    registers: [this.registry],
  });

  /** Cuenta una violación de contrato. `constraint` es un catálogo cerrado del motor. */
  recordContractViolation(scope: string, constraint: string): void {
    this.contractViolations.inc({ scope: scope || 'UNKNOWN', constraint: constraint || 'UNKNOWN' });
  }

  /** `event` ∈ CREATED | CONSUMED | UNUSED. */
  recordIntermediateEvent(event: string, count = 1): void {
    if (count > 0) this.intermediateEvents.inc({ event }, count);
  }

  recordMissingRequiredOutput(artifactCode: string): void {
    this.missingRequiredOutputs.inc({ artifact_code: artifactCode || 'UNKNOWN' });
  }

  recordCalculatedField(fieldCode: string, outcome: string, durationMs: number): void {
    this.calculatedFields.inc({ field_code: fieldCode || 'UNKNOWN', outcome });
    this.calculatedFieldDuration.observe({ field_code: fieldCode || 'UNKNOWN' }, durationMs);
  }

  recordChainDepth(depth: number): void {
    this.chainDepth.observe(depth);
  }

  recordAuditChainLockWait(durationMs: number): void {
    this.auditChainLockWait.observe(durationMs);
  }

  recordDevProdDiff(artifactCode: string, difference: string): void {
    this.devProdResultDiff.inc({ artifact_code: artifactCode || 'UNKNOWN', difference });
  }

  recordBlockedCycle(reason: string): void {
    this.blockedCycles.inc({ reason });
  }

  recordQaCase(outcome: string, count = 1): void {
    if (count > 0) this.qaCases.inc({ outcome }, count);
  }

  recordQaCounterexample(property: string): void {
    this.qaCounterexamples.inc({ property: property || 'UNKNOWN' });
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

  recordRequest(method: string, route: string, status: number, durationMs: number): void {
    const labels = { method, route, status: String(status) };
    this.httpRequests.inc(labels);
    this.httpDuration.observe(labels, durationMs);
  }

  recordDecision(outcome: string, status: string): void {
    this.decisions.inc({ outcome: outcome || 'UNKNOWN', status: status || 'UNKNOWN' });
  }

  /** Increments an external-provider failure counter by provider and normalized reason. */
  recordProviderFailure(provider: string, reason: string): void {
    this.providerFailures.inc({ provider: provider || 'UNKNOWN', reason: reason || 'UNKNOWN' });
  }

  /**
   * Counts a handled error by its stable domain code (e.g. LOCK_CONFLICT, HTTP_404,
   * INTERNAL_ERROR). The code is a bounded, curated dimension — codes are string
   * constants in the codebase, not caller-controlled — so it is safe as a label.
   */
  recordError(code: string): void {
    this.errors.inc({ code: code || 'UNKNOWN' });
  }

  /** Records the current PENDING depth of the transactional outbox. */
  setOutboxPending(count: number): void {
    this.outboxPending.set(count);
  }

  /** Counts an outbox event delivered to the bus. Event types are catalogue constants, safe as labels. */
  recordOutboxDispatched(eventType: string): void {
    this.outboxDispatched.inc({ event_type: eventType || 'UNKNOWN' });
  }

  /** Counts an outbox event dead-lettered after exhausting its retry budget. */
  recordOutboxDead(eventType: string): void {
    this.outboxDead.inc({ event_type: eventType || 'UNKNOWN' });
  }

  /** Counts a notification projected into the inbox from a domain event. */
  recordNotificationCreated(eventType: string): void {
    this.notificationsCreated.inc({ event_type: eventType || 'UNKNOWN' });
  }

  /** Renders the registry in the Prometheus text exposition format. */
  async renderPrometheus(): Promise<string> {
    this.uptime.set(Math.floor((Date.now() - this.startedAt) / 1000));
    return this.registry.metrics();
  }
}
