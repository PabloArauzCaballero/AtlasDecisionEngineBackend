/**
 * Constantes compartidas por la capa de observabilidad.
 *
 * Se centralizan aquí para que los nombres de span, los atributos y las exclusiones tengan una
 * única definición: un nombre divergente entre productor y consumidor rompe la lectura de la traza
 * sin producir ningún error.
 */

/** Nombre del emisor de trazas. Coincide con el paquete para localizar su origen en Jaeger. */
export const TRACER_NAME = '@business/semantic-analysis-worker';

/**
 * Nombres de servicio por proceso. Deben ser distintos: reutilizar el nombre de la API en un worker
 * haría inservible el grafo de dependencias de Jaeger.
 */
export const SERVICE_NAMES = {
  worker: 'semantic-analysis-worker',
  migrator: 'semantic-analysis-migrator',
  seeder: 'semantic-analysis-seeder',
  smoke: 'semantic-analysis-smoke',
} as const;

export const DEFAULT_SERVICE_NAMESPACE = 'platform';

/**
 * Versión declarada del paquete. Se mantiene como constante en lugar de leer `package.json` en
 * ejecución: un `require` del manifiesto desde `dist/` depende del empaquetado del host.
 * `OTEL_SERVICE_VERSION` la sobrescribe cuando el despliegue publica su propia versión.
 */
export const DEFAULT_SERVICE_VERSION = '1.0.0';

export const DEFAULT_OTLP_TRACES_ENDPOINT = 'http://localhost:4318/v1/traces';

/**
 * Rutas que nunca deben generar trazas. Son sondas de infraestructura: se consultan cada pocos
 * segundos y no describen ninguna operación de negocio.
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
  '/metrics.json',
  '/favicon.ico',
];

/**
 * Esquema de PostgreSQL que administra pg-boss. Su sondeo produce varias consultas por segundo por
 * réplica que no describen trabajo alguno; se excluyen por nombre además de por ausencia de padre.
 */
export const QUEUE_INTERNAL_SCHEMA = 'pgboss';

/**
 * Clave del sobre que transporta el contexto de traza junto al mensaje encolado.
 *
 * Vive **fuera** del objeto de dominio: `semanticAnalysisRequestSchema` es un `z.object` de zod v4 y
 * descarta las claves desconocidas en silencio, de modo que un `traceparent` colocado dentro del
 * objeto se perdería sin ningún aviso.
 */
export const TRACE_CARRIER_KEY = '_otel';

/** Nombres de span de negocio. Estables y sin identificadores dinámicos. */
export const SPAN_NAMES = {
  enqueue: 'semantic.enqueue',
  consume: 'semantic.consume',
  consumeDeadLetter: 'semantic.consume-dead-letter',
  process: 'semantic.process',
  analyze: 'semantic.analyze',
  classify: 'semantic.classify',
  retrieve: 'semantic.retrieve',
  catalogLoad: 'catalog.load',
  budgetReserve: 'tenant-budget.reserve',
  schedulerRetention: 'scheduler.audit-retention',
  schedulerQueueDepth: 'scheduler.queue-depth',
  migrationRun: 'migration.run',
} as const;

/**
 * Atributos propios, con namespace `app.*` para no colisionar con las convenciones semánticas.
 * Ninguno admite contenido analizado ni secretos: ver `docs/observability/04-data-privacy-policy.md`.
 */
export const APP_ATTRIBUTES = {
  module: 'app.module',
  operation: 'app.operation',
  tenantId: 'app.tenant.id',
  entityType: 'app.entity.type',
  entityId: 'app.entity.id',
  jobName: 'app.job.name',
  jobAttempt: 'app.job.attempt',
  eventType: 'app.event.type',
  errorRetryable: 'app.error.retryable',
} as const;

/** Atributos de dominio, todos de cardinalidad acotada. */
export const SEMANTIC_ATTRIBUTES = {
  tier: 'semantic.tier',
  escalated: 'semantic.escalated',
  status: 'semantic.status',
  candidateCount: 'semantic.candidate.count',
  retrievalMode: 'semantic.retrieval.mode',
  model: 'semantic.model',
  deduplicated: 'semantic.deduplicated',
  claimState: 'semantic.claim.state',
  catalogCacheHit: 'catalog.cache.hit',
  catalogCategoryCount: 'catalog.category.count',
  catalogAliasCount: 'catalog.alias.count',
  budgetAllowed: 'tenant.budget.allowed',
  retentionMinimized: 'retention.minimized.count',
  retentionDeleted: 'retention.deleted.count',
  queuePending: 'queue.pending.count',
  queueDeadLetter: 'queue.dead_letter.count',
  migrationsApplied: 'migration.applied.count',
} as const;

/** Valor de `messaging.system` para pg-boss, que no tiene un valor registrado en la especificación. */
export const MESSAGING_SYSTEM = 'pg-boss';
