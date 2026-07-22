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
