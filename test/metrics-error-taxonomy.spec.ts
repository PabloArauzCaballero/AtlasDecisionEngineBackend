import { MetricsService } from '../src/common/observability/metrics.service';

describe('MetricsService error taxonomy', () => {
  it('exports atlas_errors_total counters keyed by domain code', async () => {
    const metrics = new MetricsService();
    metrics.recordError('LOCK_CONFLICT');
    metrics.recordError('LOCK_CONFLICT');
    metrics.recordError('HTTP_404');
    metrics.recordError('INTERNAL_ERROR');

    const output = await metrics.renderPrometheus();

    expect(output).toContain('# TYPE atlas_errors_total counter');
    expect(output).toContain('atlas_errors_total{code="LOCK_CONFLICT"} 2');
    expect(output).toContain('atlas_errors_total{code="HTTP_404"} 1');
    expect(output).toContain('atlas_errors_total{code="INTERNAL_ERROR"} 1');
  });

  it('falls back to UNKNOWN for an empty code and escapes the label', async () => {
    const metrics = new MetricsService();
    metrics.recordError('');
    metrics.recordError('WEIRD"CODE');

    const output = await metrics.renderPrometheus();

    expect(output).toContain('atlas_errors_total{code="UNKNOWN"} 1');
    expect(output).toContain('atlas_errors_total{code="WEIRD\\"CODE"} 1');
  });
});

describe('MetricsService request histogram', () => {
  it('records latency into buckets so Prometheus can derive quantiles', async () => {
    const metrics = new MetricsService();
    metrics.recordRequest('POST', 'RuntimeController.execute', 200, 12);
    metrics.recordRequest('POST', 'RuntimeController.execute', 200, 480);

    const output = await metrics.renderPrometheus();

    // Histogram exposes cumulative buckets plus sum/count — the inputs a p95/p99 query needs.
    expect(output).toContain('# TYPE atlas_http_request_duration_ms histogram');
    expect(output).toContain('atlas_http_request_duration_ms_bucket');
    expect(output).toContain('le="+Inf"');
    expect(output).toContain(
      'atlas_http_request_duration_ms_count{method="POST",route="RuntimeController.execute",status="200"} 2',
    );
    expect(output).toContain(
      'atlas_http_request_duration_ms_sum{method="POST",route="RuntimeController.execute",status="200"} 492',
    );
    expect(output).toContain(
      'atlas_http_requests_total{method="POST",route="RuntimeController.execute",status="200"} 2',
    );
  });

  it('reports the other decision and provider metrics', async () => {
    const metrics = new MetricsService();
    metrics.recordDecision('APPROVED', 'SUCCEEDED');
    metrics.recordProviderFailure('variable_backend', 'timeout');

    const output = await metrics.renderPrometheus();

    expect(output).toContain('atlas_decisions_total{outcome="APPROVED",status="SUCCEEDED"} 1');
    expect(output).toContain(
      'atlas_provider_failures_total{provider="variable_backend",reason="timeout"} 1',
    );
    expect(output).toContain('atlas_process_uptime_seconds');
  });
});
