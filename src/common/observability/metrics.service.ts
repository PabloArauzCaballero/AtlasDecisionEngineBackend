import { Injectable } from '@nestjs/common';

interface RequestMetric {
  count: number;
  durationMsTotal: number;
  durationMsMax: number;
}

/**
 * In-process metrics registry rendered in Prometheus exposition format.
 *
 * Labels are intentionally bounded to known route, outcome and provider dimensions.
 */
@Injectable()
export class MetricsService {
  private readonly startedAt = Date.now();
  private readonly requests = new Map<string, RequestMetric>();
  private readonly decisions = new Map<string, number>();
  private readonly providerFailures = new Map<string, number>();

  recordRequest(method: string, route: string, status: number, durationMs: number): void {
    const key = JSON.stringify([method, route, String(status)]);
    const current = this.requests.get(key) ?? { count: 0, durationMsTotal: 0, durationMsMax: 0 };
    current.count += 1;
    current.durationMsTotal += durationMs;
    current.durationMsMax = Math.max(current.durationMsMax, durationMs);
    this.requests.set(key, current);
  }

  recordDecision(outcome: string, status: string): void {
    const key = JSON.stringify([outcome || 'UNKNOWN', status || 'UNKNOWN']);
    this.decisions.set(key, (this.decisions.get(key) ?? 0) + 1);
  }

  /** Increments an external-provider failure counter by provider and normalized reason. */
  recordProviderFailure(provider: string, reason: string): void {
    const key = JSON.stringify([provider || 'UNKNOWN', reason || 'UNKNOWN']);
    this.providerFailures.set(key, (this.providerFailures.get(key) ?? 0) + 1);
  }

  /** Renders the current registry using the Prometheus text exposition format. */
  renderPrometheus(): string {
    const lines = [
      '# HELP atlas_process_uptime_seconds Process uptime in seconds.',
      '# TYPE atlas_process_uptime_seconds gauge',
      `atlas_process_uptime_seconds ${Math.floor((Date.now() - this.startedAt) / 1000)}`,
      '# HELP atlas_http_requests_total Total HTTP requests.',
      '# TYPE atlas_http_requests_total counter',
    ];

    for (const [key, metric] of this.requests) {
      const [method, route, status] = JSON.parse(key) as string[];
      const labels = `method="${this.escape(method)}",route="${this.escape(route)}",status="${this.escape(status)}"`;
      lines.push(`atlas_http_requests_total{${labels}} ${metric.count}`);
      lines.push(`atlas_http_request_duration_ms_sum{${labels}} ${metric.durationMsTotal.toFixed(3)}`);
      lines.push(`atlas_http_request_duration_ms_count{${labels}} ${metric.count}`);
      lines.push(`atlas_http_request_duration_ms_max{${labels}} ${metric.durationMsMax.toFixed(3)}`);
    }

    lines.push('# HELP atlas_decisions_total Total decision executions by outcome and status.');
    lines.push('# TYPE atlas_decisions_total counter');
    for (const [key, count] of this.decisions) {
      const [outcome, status] = JSON.parse(key) as string[];
      lines.push(`atlas_decisions_total{outcome="${this.escape(outcome)}",status="${this.escape(status)}"} ${count}`);
    }

    lines.push('# HELP atlas_provider_failures_total External provider resolution failures.');
    lines.push('# TYPE atlas_provider_failures_total counter');
    for (const [key, count] of this.providerFailures) {
      const [provider, reason] = JSON.parse(key) as string[];
      lines.push(`atlas_provider_failures_total{provider="${this.escape(provider)}",reason="${this.escape(reason)}"} ${count}`);
    }
    return `${lines.join('\n')}\n`;
  }

  private escape(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
  }
}
