/**
 * Vocabulario de trazas **propio del análisis semántico**.
 *
 * La mecánica de trazado —fachada, propagación entre procesos, lectura del contexto, marcado de
 * errores— vive en `src/common/observability/` y la comparte todo el motor. Aquí sólo quedan los
 * nombres y atributos que este worker aporta, que es lo que de verdad es específico suyo.
 *
 * Lo que este fichero traía y ya no: el arranque del SDK (lo hace `common/observability/tracing.ts`
 * para todo el proceso), los nombres de servicio por proceso (este worker corre **dentro** de
 * `atlas-worker` y se distingue por `app.module`, no por un servicio aparte) y las constantes de
 * pg-boss, que desapareció al absorber el paquete: la cola es ahora una tabla del motor.
 */
import { APP_ATTRIBUTES } from '../../../../../common/observability/telemetry.constants';

// Se reexporta para que los ficheros del núcleo conserven su import local, con una única
// definición detrás: dos listas de atributos `app.*` que divergen rompen las consultas de Jaeger
// sin producir ningún error.
export { APP_ATTRIBUTES };

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

/** Atributos de dominio, todos de cardinalidad acotada. */
export const SEMANTIC_ATTRIBUTES = {
  tier: 'semantic.tier',
  escalated: 'semantic.escalated',
  status: 'semantic.status',
  candidateCount: 'semantic.candidate.count',
  retrievalMode: 'semantic.retrieval.mode',
  model: 'semantic.model',
  /**
   * El despliegue FÍSICO que atendió la llamada, cuando lo hay detrás de un alias.
   *
   * Va en el span y no en una etiqueta de Prometheus a propósito: con un gateway
   * que reparte entre varios proveedores su cardinalidad la fija `config.yaml`, no
   * el motor, y una etiqueta que crece con un fichero que este repositorio no
   * controla es exactamente la que tumba al recolector.
   */
  resolvedModel: 'semantic.model.resolved',
  /*
   * Consumo y coste por llamada. Numéricos de alta variabilidad: pertenecen a la
   * traza, donde se leen por llamada, y no a un contador agregado.
   */
  inputTokens: 'semantic.usage.input_tokens',
  outputTokens: 'semantic.usage.output_tokens',
  totalTokens: 'semantic.usage.total_tokens',
  estimatedCost: 'semantic.usage.estimated_cost',
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
