import type { ConfigService } from '@nestjs/config';
import type { SemanticWorkerConfig } from './core/config/semantic-worker.config';
import { booleanoDeConfig } from '../../../common/config/config-coercion.util';

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
 *
 * **Se mira el peor caso DEL PROVEEDOR ELEGIDO, no siempre el de OpenAI.** Cada
 * adaptador generativo declara su plazo y sus intentos en variables propias, y
 * `assertProviderTimeoutFitsAnalysis` comprueba la desigualdad con las suyas. Si
 * aquí se leyeran siempre las de OpenAI, un despliegue con el gateway y
 * `LITELLM_TIMEOUT_MS` por encima del valor por defecto derivaría un presupuesto
 * calculado sobre variables que ese despliegue no usa, y volvería a fallar en la
 * primera clasificación —justo el defecto que este cálculo existe para impedir,
 * reaparecido por la puerta de al lado—.
 */
function providerWorstCaseSeconds(config: ConfigService): number {
  const TIERS = 2;
  const selected = config.get<string>('SEMANTIC_ANALYSIS_PROVIDER') ?? '';
  const usaGateway = selected === 'litellm' || selected === 'cascade';

  const timeoutMs = usaGateway
    ? (config.get<number>('LITELLM_TIMEOUT_MS') ?? 30_000)
    : (config.get<number>('SEMANTIC_PROVIDER_TIMEOUT_MS') ?? 30_000);
  const attempts = usaGateway
    ? (config.get<number>('LITELLM_MAX_ATTEMPTS') ?? 3)
    : (config.get<number>('SEMANTIC_PROVIDER_MAX_ATTEMPTS') ?? 3);

  /*
   * En cascada los dos niveles NO los atiende el mismo adaptador: el rápido es el
   * codificador local —acotado por su propio plazo— y sólo el profundo llega al
   * gateway. El peor caso es por tanto «lo que se le espera al local» más UNA pasada
   * del remoto, no dos.
   *
   * Se calcula así y no con la fórmula de dos niveles del gateway porque sobrestimar
   * tampoco es gratis: infla el lease, y un lease largo retrasa la recuperación de
   * los trabajos que mueren de verdad.
   */
  if (selected === 'cascade') {
    const localMs = config.get<number>('SEMANTIC_CASCADE_LOCAL_TIMEOUT_MS') ?? 2_000;
    return Math.ceil((localMs + timeoutMs * attempts) / 1_000);
  }

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
    // Encendidos por defecto y apagables por entorno. Los dos existen para que
    // una glosa NUNCA se quede sin categoría: uno resuelve antes de preguntar,
    // el otro resuelve cuando preguntar tardó demasiado.
    ruleFastPathEnabled: booleanoDeConfig(config, 'SEMANTIC_ANALYSIS_RULE_FAST_PATH_ENABLED', true),
    timeoutRescueEnabled: booleanoDeConfig(
      config,
      'SEMANTIC_ANALYSIS_TIMEOUT_RESCUE_ENABLED',
      true,
    ),
    catalogCacheTtlSeconds: config.get<number>('SEMANTIC_ANALYSIS_CATALOG_TTL_SECONDS') ?? 300,
    // Una hora y cinco mil glosas: un extracto largo trae unas ciento veinte
    // distintas, así que caben decenas de tandas seguidas sin desalojar nada. La
    // frescura no depende de este plazo —la firma del catálogo la garantiza—,
    // sólo la memoria que retiene un proceso que lleva días levantado.
    classificationCacheTtlSeconds:
      config.get<number>('SEMANTIC_ANALYSIS_CLASSIFICATION_TTL_SECONDS') ?? 3_600,
    classificationCacheSize: config.get<number>('SEMANTIC_ANALYSIS_CLASSIFICATION_CACHE') ?? 5_000,
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
