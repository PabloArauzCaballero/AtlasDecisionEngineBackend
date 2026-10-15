import { z } from 'zod';
import { booleanFromString, optionalUrl, optionalSecret } from './helpers';

export const httpAndObservabilityEnv = {
  CORS_ALLOWED_ORIGINS: z.string().default(''),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(1),
  BODY_LIMIT_BYTES: z.coerce.number().int().min(1_024).max(10_485_760).default(1_048_576),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().min(500).max(120_000).default(15_000),
  // Plazo total del apagado ordenado. El 80 % acota el drenaje de lotes en vuelo del
  // orquestador de trabajos y el resto queda para cerrar los pools y vaciar las trazas;
  // agotado el plazo, el proceso fuerza la salida. Debe quedar POR DEBAJO del
  // terminationGracePeriodSeconds del orquestador: si lo supera, el SIGKILL llega antes que
  // el vigilante y se pierde el motivo del apagado, que es justo lo que se quería salvar.
  SHUTDOWN_GRACE_MS: z.coerce.number().int().min(1_000).max(120_000).default(20_000),

  RATE_LIMIT_ENABLED: booleanFromString.default(true),
  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(1).max(3_600).default(60),
  RATE_LIMIT_MANAGEMENT_REQUESTS: z.coerce.number().int().min(1).max(100_000).default(300),
  RATE_LIMIT_RUNTIME_REQUESTS: z.coerce.number().int().min(1).max(100_000).default(1_500),
  AUTH_FAILURE_RATE_LIMIT: z.coerce.number().int().min(1).max(10_000).default(20),

  SWAGGER_ENABLED: booleanFromString.default(false),
  METRICS_ENABLED: booleanFromString.default(true),
  METRICS_TOKEN: optionalSecret,
  LOG_LEVEL: z.enum(['error', 'warn', 'log', 'debug', 'verbose']).default('log'),
  // Containers run with a read-only root filesystem, so writing a log file must be an
  // explicit opt-in backed by a mounted volume.
  LOG_OUTPUT: z.enum(['stdout', 'stdout_and_file']).default('stdout'),
  LOG_FILE_PATH: z.string().min(1).default('logs/atlas-decision-engine.log'),
  ACCESS_AUDIT_ENABLED: booleanFromString.default(true),
  // Authentication denials are buffered only long enough to bridge a transient database
  // outage. Bounds prevent an attacker from turning the safety net into unbounded memory.
  ACCESS_AUDIT_QUEUE_MAX: z.coerce.number().int().min(10).max(100_000).default(1_000),
  ACCESS_AUDIT_RETRY_SECONDS: z.coerce.number().int().min(1).max(3_600).default(15),

  // Distributed tracing. Read directly from process.env by observability/tracing.ts (it runs
  // before the Nest container exists); declared here so the values are still validated and
  // documented rather than being undeclared magic strings.
  OTEL_ENABLED: booleanFromString.default(false),
  OTEL_SERVICE_NAME: z.string().max(120).default('atlas-decision-engine'),
  // Agrupa API y worker bajo el mismo producto en el grafo de servicios de Jaeger.
  OTEL_SERVICE_NAMESPACE: z.string().max(120).default('atlas'),
  // Por defecto se toma BUILD_VERSION; esta variable sólo existe para despliegues que
  // versionan la telemetría por separado del artefacto.
  OTEL_SERVICE_VERSION: z.string().max(60).optional(),
  OTEL_DEPLOYMENT_ENVIRONMENT: z.string().max(60).optional(),
  OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: optionalUrl,
  OTEL_EXPORT_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(10_000),
  // Muestreo basado en el padre: se respeta la decisión de un servicio aguas arriba, porque
  // media traza no sirve para nada. La proporción sólo gobierna las trazas que nacen aquí.
  OTEL_TRACES_SAMPLER: z.string().max(60).default('parentbased_traceidratio'),
  OTEL_TRACES_SAMPLER_ARG: z.coerce.number().min(0).max(1).default(1),
  OTEL_PROPAGATORS: z.string().max(120).default('tracecontext,baggage'),
  OTEL_DIAG_LOG_LEVEL: z
    .enum(['NONE', 'ERROR', 'WARN', 'INFO', 'DEBUG', 'VERBOSE', 'ALL'])
    .default('ERROR'),
};
