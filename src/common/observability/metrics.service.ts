import { Injectable } from '@nestjs/common';
import { Counter, Gauge, Histogram } from 'prom-client';
import { MetricsRegistry } from './metrics-registry';

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
  private readonly startedAt = Date.now();

  private readonly httpRequests = new Counter({
    name: 'atlas_http_requests_total',
    help: 'Total HTTP requests.',
    labelNames: ['method', 'route', 'status'],
    registers: [],
  });

  // Buckets in milliseconds, tuned for an online decision endpoint: dense below 250ms
  // where the SLO lives, then coarser out to the timeout ceiling.
  private readonly httpDuration = new Histogram({
    name: 'atlas_http_request_duration_ms',
    help: 'HTTP request duration in milliseconds.',
    labelNames: ['method', 'route', 'status'],
    buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
    registers: [],
  });

  private readonly decisions = new Counter({
    name: 'atlas_decisions_total',
    help: 'Total decision executions by outcome and status.',
    labelNames: ['outcome', 'status'],
    registers: [],
  });

  private readonly providerFailures = new Counter({
    name: 'atlas_provider_failures_total',
    help: 'External provider resolution failures.',
    labelNames: ['provider', 'reason'],
    registers: [],
  });

  private readonly errors = new Counter({
    name: 'atlas_errors_total',
    help: 'Handled errors by domain code.',
    labelNames: ['code'],
    registers: [],
  });

  private readonly uptime = new Gauge({
    name: 'atlas_process_uptime_seconds',
    help: 'Process uptime in seconds.',
    registers: [],
  });

  // --- §12: observabilidad de contratos, intermedias, campos calculados y QA ---

  private readonly contractViolations = new Counter({
    name: 'atlas_contract_violations_total',
    help: 'Violaciones de contrato por ámbito (INPUT/INTERMEDIATE/OUTPUT) y restricción incumplida.',
    labelNames: ['scope', 'constraint'],
    registers: [],
  });

  private readonly intermediateEvents = new Counter({
    name: 'atlas_intermediate_variable_events_total',
    help: 'Ciclo de vida de las variables intermedias: creadas, consumidas o nunca usadas.',
    labelNames: ['event'],
    registers: [],
  });

  private readonly missingRequiredOutputs = new Counter({
    name: 'atlas_missing_required_output_total',
    help: 'Ejecuciones que terminaron sin producir una salida obligatoria.',
    labelNames: ['artifact_code'],
    registers: [],
  });

  /**
   * Reservas de idempotencia que otra petición reclamó mientras su titular seguía ejecutando.
   * Cualquier valor distinto de cero significa que hay decisiones tardando más que
   * `IDEMPOTENCY_LEASE_SECONDS`: la respuesta no se cachea y el reintento vuelve a ejecutar.
   */
  private readonly idempotencyLeasesLost = new Counter({
    name: 'atlas_idempotency_lease_lost_total',
    help: 'Reservas de idempotencia perdidas porque el lease venció durante la ejecución.',
    registers: [],
  });

  private readonly calculatedFields = new Counter({
    name: 'atlas_calculated_field_executions_total',
    help: 'Ejecuciones de campos calculados por resultado.',
    labelNames: ['field_code', 'outcome'],
    registers: [],
  });

  private readonly calculatedFieldDuration = new Histogram({
    name: 'atlas_calculated_field_duration_ms',
    help: 'Duración de la ejecución de un campo calculado, en milisegundos.',
    labelNames: ['field_code'],
    buckets: [1, 2, 5, 10, 25, 50, 100, 250, 500],
    registers: [],
  });

  private readonly workerNodeCalls = new Counter({
    name: 'atlas_worker_node_calls_total',
    help: 'Llamadas a servicios de worker hechas desde un nodo del grafo, por resultado.',
    labelNames: ['service', 'operation', 'outcome'],
    registers: [],
  });

  /**
   * Duración de la llamada, no de la decisión. Sus cubos llegan a un minuto porque un nodo
   * de servicio ejecuta trabajo real —convertir un PDF, clasificar un texto— dentro de la
   * decisión: medirlo con los cubos de un campo calculado dejaría todo en el último.
   */
  private readonly workerNodeCallDuration = new Histogram({
    name: 'atlas_worker_node_call_duration_ms',
    help: 'Duración de una llamada a un servicio de worker desde un nodo, en milisegundos.',
    labelNames: ['service', 'operation'],
    buckets: [25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 15_000, 60_000],
    registers: [],
  });

  private readonly chainDepth = new Histogram({
    name: 'atlas_chained_artifact_depth',
    help: 'Profundidad alcanzada al encadenar artefactos en una ejecución.',
    buckets: [1, 2, 3, 4, 5, 8, 12],
    registers: [],
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
    registers: [],
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
    registers: [],
  });

  private readonly blockedCycles = new Counter({
    name: 'atlas_blocked_reference_cycles_total',
    help: 'Referencias entre artefactos rechazadas por crear un ciclo o exceder la profundidad.',
    labelNames: ['reason'],
    registers: [],
  });

  private readonly qaCases = new Counter({
    name: 'atlas_qa_generated_cases_total',
    help: 'Casos generados por el QA Lab, por resultado.',
    labelNames: ['outcome'],
    registers: [],
  });

  private readonly qaCounterexamples = new Counter({
    name: 'atlas_qa_counterexamples_total',
    help: 'Contraejemplos mínimos almacenados, por propiedad violada.',
    labelNames: ['property'],
    registers: [],
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

  recordIdempotencyLeaseLost(): void {
    this.idempotencyLeasesLost.inc();
  }

  recordCalculatedField(fieldCode: string, outcome: string, durationMs: number): void {
    this.calculatedFields.inc({ field_code: fieldCode || 'UNKNOWN', outcome });
    this.calculatedFieldDuration.observe({ field_code: fieldCode || 'UNKNOWN' }, durationMs);
  }

  /** `outcome` ∈ SUCCEEDED | SUCCEEDED_WITH_WARNINGS | ERROR. */
  recordWorkerCall(service: string, operation: string, outcome: string, durationMs: number): void {
    const labels = { service: service || 'UNKNOWN', operation: operation || 'UNKNOWN' };
    this.workerNodeCalls.inc({ ...labels, outcome });
    this.workerNodeCallDuration.observe(labels, durationMs);
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

  constructor(private readonly shared: MetricsRegistry = new MetricsRegistry()) {
    shared.registry.registerMetric(this.httpRequests);
    shared.registry.registerMetric(this.httpDuration);
    shared.registry.registerMetric(this.decisions);
    shared.registry.registerMetric(this.providerFailures);
    shared.registry.registerMetric(this.errors);
    shared.registry.registerMetric(this.uptime);
    shared.registry.registerMetric(this.contractViolations);
    shared.registry.registerMetric(this.intermediateEvents);
    shared.registry.registerMetric(this.missingRequiredOutputs);
    shared.registry.registerMetric(this.idempotencyLeasesLost);
    shared.registry.registerMetric(this.calculatedFields);
    shared.registry.registerMetric(this.calculatedFieldDuration);
    shared.registry.registerMetric(this.workerNodeCalls);
    shared.registry.registerMetric(this.workerNodeCallDuration);
    shared.registry.registerMetric(this.chainDepth);
    shared.registry.registerMetric(this.auditChainLockWait);
    shared.registry.registerMetric(this.devProdResultDiff);
    shared.registry.registerMetric(this.blockedCycles);
    shared.registry.registerMetric(this.qaCases);
    shared.registry.registerMetric(this.qaCounterexamples);
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

  /** Renders the registry in the Prometheus text exposition format. */
  async renderPrometheus(): Promise<string> {
    this.uptime.set(Math.floor((Date.now() - this.startedAt) / 1000));
    return this.shared.scrape();
  }
}
