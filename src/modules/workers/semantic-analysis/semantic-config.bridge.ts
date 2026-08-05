import type { ConfigService } from '@nestjs/config';
import type { SemanticWorkerConfig } from './core/config/semantic-worker.config';

/**
 * Traduce la configuración del motor a la que espera el núcleo semántico.
 *
 * El paquete original leía sus propias variables (`SEMANTIC_WORKER_*`,
 * `SEMANTIC_QUEUE_NAME`, `DATABASE_POOL_MAX`…) directamente de `process.env`.
 * Conservar ese juego habría dejado el despliegue con **dos nomenclaturas** y
 * dos sitios donde mirar cuando algo no arranca, y además con variables que ya
 * no gobiernan nada: la cola, el pool y el SSL de la base los administra ahora
 * el motor.
 *
 * Este puente hace explícito qué se conserva, qué se redirige y qué queda
 * vestigial. Es preferible a una capa de compatibilidad silenciosa: aquí se ve
 * de un vistazo qué variable del motor manda sobre cada opción del núcleo.
 *
 * | Opción del núcleo            | De dónde sale ahora                          |
 * | ---------------------------- | -------------------------------------------- |
 * | `concurrency`                | `SEMANTIC_ANALYSIS_WORKER_CONCURRENCY`       |
 * | `maxRetries`                 | `SEMANTIC_ANALYSIS_MAX_ATTEMPTS`             |
 * | `analysisTimeoutSeconds`     | `SEMANTIC_ANALYSIS_LEASE_SECONDS`            |
 * | `tenantMaxAnalysesPerWindow` | `SEMANTIC_ANALYSIS_BUDGET_MAX_ANALYSES`      |
 * | `tenantBudgetWindowSeconds`  | `SEMANTIC_ANALYSIS_BUDGET_WINDOW_SECONDS`    |
 * | `auditRetentionDays`         | `SEMANTIC_ANALYSIS_AUDIT_RETENTION_DAYS`     |
 * | `queueName`, `databaseUrl`…  | **vestigiales** — los administra el motor    |
 */
/**
 * Presupuesto de análisis que hace falta para que el proveedor quepa.
 *
 * `assertProviderTimeoutFitsAnalysis` (en `core/config/openai-provider.config.ts`)
 * exige `timeout × intentos × 2 tiers ≤ analysisTimeoutSeconds`, y con razón: si
 * no se cumple, el análisis se corta SIEMPRE antes de que el proveedor agote sus
 * intentos, el job expira y se reintenta eternamente sin producir nada.
 *
 * El puente derivaba el presupuesto del lease y nada comprobaba la desigualdad.
 * Con los valores por defecto de OpenAI —30 s × 3 intentos × 2 tiers = 180 s— y
 * un lease de 120 s, el presupuesto salía 110 s y **la primera clasificación
 * fallaba** con `SemanticConfigurationError`.
 *
 * Se resuelve subiendo el presupuesto, no recortando al proveedor: reducir sus
 * intentos cambia el comportamiento del worker ante un modelo lento —abandona
 * antes—, mientras que ampliar el presupuesto sólo alarga el techo del peor
 * caso. El lease se eleva en consecuencia, porque un lease más corto que el
 * trabajo que ampara haría que otra réplica reclamara un job todavía vivo.
 */
function providerWorstCaseSeconds(config: ConfigService): number {
  const timeoutMs = config.get<number>('SEMANTIC_PROVIDER_TIMEOUT_MS') ?? 30_000;
  const attempts = config.get<number>('SEMANTIC_PROVIDER_MAX_ATTEMPTS') ?? 3;
  const TIERS = 2;
  return Math.ceil((timeoutMs * attempts * TIERS) / 1_000);
}

export function buildSemanticWorkerConfig(config: ConfigService): SemanticWorkerConfig {
  const worstCaseSeconds = providerWorstCaseSeconds(config);
  // El lease declarado es un SUELO, no un techo: si el proveedor puede tardar
  // más que él, se amplía. Un lease por debajo del peor caso deja que otra
  // réplica reclame un job que todavía se está procesando, y entonces el mismo
  // texto se clasifica dos veces y se paga dos veces.
  const leaseSeconds = Math.max(
    config.get<number>('SEMANTIC_ANALYSIS_LEASE_SECONDS') ?? 120,
    worstCaseSeconds + 20,
  );

  return {
    // --- Vestigiales -------------------------------------------------------
    // El núcleo los declara porque su versión autónoma abría su propia conexión
    // y su propia cola. Aquí la conexión la da `PrismaService` y la cola es una
    // tabla del motor, así que estos valores no llegan a usarse. Se rellenan
    // con constantes reconocibles en vez de con la configuración real: si algún
    // camino los leyera de verdad, el fallo debe ser evidente y no conectarse a
    // la base con parámetros paralelos a los del motor.
    databaseUrl: 'postgres://gestionado-por-el-motor',
    databaseSslMode: 'disable',
    databasePoolMax: 1,
    applicationName: 'atlas-decision-semantic',
    queueName: 'semantic-analysis',
    deadLetterQueueName: 'semantic-analysis-dead-letter',
    deadLetterDrainEnabled: false,
    jobTimeoutSeconds: leaseSeconds,
    pollingIntervalSeconds: 1,
    jobRetentionDays: 7,
    shutdownTimeoutSeconds: 30,
    healthPort: 0,

    // --- Efectivos ---------------------------------------------------------
    workerEnabled: config.get<boolean>('SEMANTIC_ANALYSIS_WORKER_ENABLED') ?? false,
    concurrency: config.get<number>('SEMANTIC_ANALYSIS_WORKER_CONCURRENCY') ?? 4,
    maxRetries: config.get<number>('SEMANTIC_ANALYSIS_MAX_ATTEMPTS') ?? 3,
    retryDelaySeconds: 5,
    retryBackoff: true,
    // El presupuesto del análisis se acota al lease: pasado ese punto otra
    // réplica puede reclamar la misma ejecución, así que seguir gastando cuota
    // del proveedor sólo produce trabajo duplicado. Se deja un margen para que
    // el corte lo dé el propio análisis y no el vencimiento del lease.
    // Diez segundos por debajo del lease para que el corte lo dé el propio
    // análisis y no el vencimiento del lease. Como el lease ya se elevó al peor
    // caso del proveedor + 20 s, esto queda siempre por encima de él y la
    // invariante se cumple por construcción.
    analysisTimeoutSeconds: Math.max(worstCaseSeconds, leaseSeconds - 10),
    candidateLimit: config.get<number>('SEMANTIC_ANALYSIS_CANDIDATE_LIMIT') ?? 8,
    ambiguityMargin: config.get<number>('SEMANTIC_ANALYSIS_AMBIGUITY_MARGIN') ?? 0.08,
    catalogCacheTtlSeconds: config.get<number>('SEMANTIC_ANALYSIS_CATALOG_TTL_SECONDS') ?? 300,
    // Léxico salvo que se pida lo contrario a propósito. El modo híbrido exige
    // un proveedor de embeddings, calcular y almacenar un vector por categoría,
    // y gasta cuota en cada análisis: no es un valor por defecto razonable, es
    // una decisión que alguien debe tomar sabiendo lo que cuesta.
    retrievalMode:
      config.get<string>('SEMANTIC_ANALYSIS_RETRIEVAL_MODE') === 'hybrid' ? 'hybrid' : 'lexical',
    retrievalSemanticWeight: config.get<number>('SEMANTIC_ANALYSIS_SEMANTIC_WEIGHT') ?? 0.5,
    auditRetentionDays: config.get<number>('SEMANTIC_ANALYSIS_AUDIT_RETENTION_DAYS') ?? 90,
    auditMinimizeAfterDays: config.get<number>('SEMANTIC_ANALYSIS_MINIMIZE_AFTER_DAYS') ?? 30,
    tenantMaxAnalysesPerWindow:
      config.get<number>('SEMANTIC_ANALYSIS_BUDGET_MAX_ANALYSES') ?? 1_000,
    tenantBudgetWindowSeconds:
      config.get<number>('SEMANTIC_ANALYSIS_BUDGET_WINDOW_SECONDS') ?? 3_600,
  } as SemanticWorkerConfig;
}
