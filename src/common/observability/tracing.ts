import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

/**
 * Distributed tracing (plan P2), opt-in and inert unless explicitly switched on.
 *
 * This module is imported for its side effect BEFORE anything else in `main.ts`: the
 * instrumentations patch `http`, `express`, `pg` and `ioredis` as they are required, so
 * starting the SDK after Nest has loaded them would silently produce no spans.
 *
 * Reads plain `process.env` rather than ConfigService on purpose — it runs before the Nest
 * container exists. Everything stays off unless `OTEL_ENABLED` is true, so the default
 * deployment pays nothing: no exporter, no patching, no background connections.
 *
 * Health and metrics endpoints are not traced; they are polled continuously by the platform
 * and would dominate the trace volume without describing any decision.
 */
const UNTRACED_PATHS = ['/health', '/health/live', '/health/ready', '/ready', '/metrics'];

let sdk: NodeSDK | undefined;

function isEnabled(): boolean {
  const raw = (process.env.OTEL_ENABLED ?? '').trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes';
}

/** Starts tracing when enabled. Safe to call twice; a second call is a no-op. */
export function startTracing(): void {
  if (sdk || !isEnabled()) return;

  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME ?? 'atlas-decision-engine',
      [ATTR_SERVICE_VERSION]: process.env.BUILD_VERSION ?? '2.0.0',
      'deployment.environment.name': process.env.NODE_ENV ?? 'development',
    }),
    // No endpoint configured means the OTLP default (localhost:4318); that is the collector
    // sidecar convention, and an unreachable collector only drops spans, never requests.
    traceExporter: new OTLPTraceExporter({
      url: process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT,
    }),
    instrumentations: [
      new HttpInstrumentation({
        ignoreIncomingRequestHook: (request) => {
          const path = (request.url ?? '').split('?')[0];
          return UNTRACED_PATHS.includes(path);
        },
      }),
      new ExpressInstrumentation(),
      // Statement text is captured; parameter VALUES are not, so a traced query can never
      // leak the PII the redacting logger is careful to keep out of logs.
      new PgInstrumentation({ enhancedDatabaseReporting: false }),
      new IORedisInstrumentation(),
    ],
  });

  sdk.start();
}

/** Flushes and stops the exporter. Never throws: shutdown must not fail a clean exit. */
export async function stopTracing(): Promise<void> {
  if (!sdk) return;
  try {
    await sdk.shutdown();
  } catch {
    // A failed flush loses spans; it must not turn a graceful shutdown into a crash.
  } finally {
    sdk = undefined;
  }
}
