/**
 * Constantes de la capa de observabilidad.
 *
 * Un nombre de span o de atributo divergente entre productor y consumidor rompe la lectura de
 * la traza **sin producir ningún error**, así que existen una sola vez y aquí.
 */

/** Emisor de trazas del motor. Identifica el origen de los spans manuales en Jaeger. */
export const TRACER_NAME = 'atlas-decision-engine';

/** Namespace por defecto; agrupa API y worker bajo el mismo producto en el grafo de servicios. */
export const DEFAULT_SERVICE_NAMESPACE = 'atlas';

/** Destino OTLP por defecto: la convención del colector como sidecar. */
export const DEFAULT_OTLP_TRACES_ENDPOINT = 'http://localhost:4318/v1/traces';

/**
 * Rutas que nunca generan trazas. Son sondas de infraestructura: se consultan cada pocos
 * segundos y no describen ninguna operación de negocio, así que dominarían el volumen sin
 * aportar un solo diagnóstico.
 */
export const UNTRACED_HTTP_PATHS: readonly string[] = [
  '/health',
  '/health/live',
  '/health/ready',
  '/healthz',
  '/ready',
  '/readiness',
  '/liveness',
  '/metrics',
  '/favicon.ico',
];

/**
 * Clave del sobre que transporta el contexto de traza junto al trabajo encolado.
 *
 * Viaja **fuera** del objeto de dominio: los esquemas zod del motor descartan las claves
 * desconocidas en silencio, de modo que un `traceparent` colocado dentro se perdería sin aviso.
 */
export const TRACE_CARRIER_KEY = '_otel';

/** Cabecera de respuesta con el identificador de traza para soporte técnico. */
export const TRACE_ID_HEADER = 'x-trace-id';

/**
 * Nombres de span de negocio: `<dominio>.<acción>`, estables y **sin identificadores**.
 * Un nombre construido con un id crea una serie por ejecución e inutiliza toda agregación.
 */
export const SPAN_NAMES = {
  decisionExecute: 'decision.execute',
  decisionSimulate: 'decision.simulate',
  outboxPublish: 'outbox.publish',
  outboxDispatch: 'outbox.dispatch',
  jobRun: 'job.run',
} as const;

/**
 * Atributos propios, con namespace `app.*` para no colisionar con las convenciones semánticas.
 * Ninguno admite variables de decisión, contenido analizado ni secretos:
 * ver `docs/observability/04-data-privacy-policy.md`.
 */
export const APP_ATTRIBUTES = {
  module: 'app.module',
  operation: 'app.operation',
  tenantId: 'app.tenant.id',
  entityType: 'app.entity.type',
  entityId: 'app.entity.id',
  jobName: 'app.job.name',
  jobAttempt: 'app.job.attempt',
  jobOutcome: 'app.job.outcome',
  jobProcessed: 'app.job.processed.count',
  eventType: 'app.event.type',
  errorRetryable: 'app.error.retryable',
} as const;

/** Atributos de decisión. Todos de cardinalidad acotada salvo el id opaco de ejecución. */
export const DECISION_ATTRIBUTES = {
  artifactCode: 'decision.artifact.code',
  environment: 'decision.environment',
  outcome: 'decision.outcome',
  steps: 'decision.steps.count',
} as const;

/**
 * `messaging.system` para el outbox transaccional. No hay broker: el transporte es la propia
 * tabla, y decirlo así es más honesto que reutilizar el nombre de una cola que no existe.
 */
export const MESSAGING_SYSTEM = 'atlas-outbox';
