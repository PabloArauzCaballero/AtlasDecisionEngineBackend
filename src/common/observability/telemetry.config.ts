import { DEFAULT_SERVICE_NAMESPACE } from './telemetry.constants';
import type { TelemetryConfig } from './telemetry.types';

/**
 * Lectura de la configuración de telemetría.
 *
 * Lee `process.env` y **no** `ConfigService` a propósito: esto corre antes de que exista el
 * contenedor de NestJS, porque las instrumentaciones tienen que parchear `http`, `pg` e
 * `ioredis` en el momento en que se requieren. Los mismos valores están declarados en
 * `common/config/env.schema.ts`, de modo que quedan validados y documentados en vez de ser
 * cadenas mágicas sueltas.
 *
 * El entorno se pasa como argumento para poder probar sin tocar el proceso.
 */
export function readTelemetryConfig(
  environment: NodeJS.ProcessEnv = process.env,
  defaultServiceName = 'atlas-decision-engine',
): TelemetryConfig {
  return {
    enabled: readBoolean(environment.OTEL_ENABLED),
    serviceName: nonEmpty(environment.OTEL_SERVICE_NAME) ?? defaultServiceName,
    serviceNamespace: nonEmpty(environment.OTEL_SERVICE_NAMESPACE) ?? DEFAULT_SERVICE_NAMESPACE,
    serviceVersion:
      nonEmpty(environment.OTEL_SERVICE_VERSION) ?? nonEmpty(environment.BUILD_VERSION) ?? '2.0.0',
    deploymentEnvironment:
      nonEmpty(environment.OTEL_DEPLOYMENT_ENVIRONMENT) ??
      nonEmpty(environment.NODE_ENV) ??
      'development',
    tracesEndpoint: nonEmpty(environment.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT),
    exportTimeoutMs: readInteger(environment.OTEL_EXPORT_TIMEOUT_MS, 10_000, 1_000, 120_000),
    samplerRatio: readRatio(environment.OTEL_TRACES_SAMPLER_ARG),
    propagators: readPropagators(environment.OTEL_PROPAGATORS),
    diagLogLevel: (nonEmpty(environment.OTEL_DIAG_LOG_LEVEL) ?? 'ERROR').toUpperCase(),
  };
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === '' ? undefined : trimmed;
}

/** Sólo un `true`/`1`/`yes` explícito habilita la telemetría: el silencio la deja apagada. */
function readBoolean(value: string | undefined): boolean {
  const raw = (value ?? '').trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes';
}

function readInteger(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

/**
 * Proporción de muestreo, acotada a [0, 1].
 *
 * Un valor ilegible cae a `1`: perder trazas en silencio por una errata de configuración es
 * peor que exportar de más, porque el síntoma —«Jaeger no recibe nada»— no apunta a su causa.
 */
function readRatio(value: string | undefined): number {
  const parsed = Number.parseFloat(value ?? '');
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(Math.max(parsed, 0), 1);
}

/**
 * Propagadores declarados. `tracecontext` y `baggage` son el estándar W3C y el valor por
 * defecto; se admite B3 sólo para compatibilidad heredada, nunca como opción por defecto.
 */
function readPropagators(value: string | undefined): readonly string[] {
  const declared = (value ?? '')
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
  return declared.length > 0 ? declared : ['tracecontext', 'baggage'];
}
