import {
  AnalysisTier,
  CategoryCandidate,
  DecisionStatus,
  EntityAlias,
  ModelClassification,
  ModelClassificationInput,
  SemanticAnalysisRequest,
  SemanticAnalysisResult,
  SemanticCategory,
} from '../domain/semantic-analysis.types';

export const SEMANTIC_MODEL_PROVIDER = Symbol('SEMANTIC_MODEL_PROVIDER');
export const SEMANTIC_CATEGORY_REPOSITORY = Symbol('SEMANTIC_CATEGORY_REPOSITORY');
export const ENTITY_ALIAS_REPOSITORY = Symbol('ENTITY_ALIAS_REPOSITORY');
export const SEMANTIC_AUDIT_REPOSITORY = Symbol('SEMANTIC_AUDIT_REPOSITORY');
export const SEMANTIC_JOB_QUEUE = Symbol('SEMANTIC_JOB_QUEUE');
export const SEMANTIC_WORKER_CONFIG = Symbol('SEMANTIC_WORKER_CONFIG');
export const SEMANTIC_METRICS_RECORDER = Symbol('SEMANTIC_METRICS_RECORDER');
export const CANDIDATE_RETRIEVER = Symbol('CANDIDATE_RETRIEVER');
export const EMBEDDING_PROVIDER = Symbol('EMBEDDING_PROVIDER');
export const CATEGORY_EMBEDDING_REPOSITORY = Symbol('CATEGORY_EMBEDDING_REPOSITORY');
export const TENANT_BUDGET_REPOSITORY = Symbol('TENANT_BUDGET_REPOSITORY');
export const AUDIT_RETENTION_REPOSITORY = Symbol('AUDIT_RETENTION_REPOSITORY');

export interface SemanticModelProvider {
  /**
   * @param signal - Permite abortar la llamada cuando el análisis excede su presupuesto de tiempo.
   */
  classify(
    input: ModelClassificationInput,
    tier: AnalysisTier,
    signal?: AbortSignal,
  ): Promise<ModelClassification>;

  /**
   * Modelo que atenderá el nivel indicado, conocido antes de llamar.
   *
   * Existe para la métrica del camino de fallo: cuando la llamada no llega a
   * responder no hay `classification.model` que informar, y atribuir el fallo a
   * `unknown` impide comparar la tasa de error entre modelos —justo la lectura
   * que hace falta cuando uno se degrada—. Es opcional para no obligar a las
   * implementaciones que no fijan el modelo por nivel.
   */
  modelFor?(tier: AnalysisTier): string;
}

export interface SemanticCategoryRepository {
  findActiveCategories(tenantId?: string): Promise<readonly SemanticCategory[]>;
}

export interface EntityAliasRepository {
  findActiveAliases(tenantId?: string): Promise<readonly EntityAlias[]>;
}

/**
 * Reduce el universo de categorías antes de invocar al clasificador.
 *
 * Es un puerto para que la estrategia — léxica, por embeddings o híbrida — pueda sustituirse sin
 * tocar la decisión ni el proveedor.
 */
export interface CandidateRetriever {
  retrieve(
    normalizedText: string,
    categories: readonly SemanticCategory[],
    limit: number,
    signal?: AbortSignal,
  ): Promise<readonly CategoryCandidate[]>;
}

export interface EmbeddingProvider {
  /** Vectores en el mismo orden que los textos recibidos. */
  embed(texts: readonly string[], signal?: AbortSignal): Promise<readonly (readonly number[])[]>;
  readonly model: string;
}

export interface StoredCategoryEmbedding {
  readonly categoryId: string;
  readonly version: number;
  readonly model: string;
  readonly vector: readonly number[];
}

export interface CategoryEmbeddingRepository {
  findByCategoryIds(
    categoryIds: readonly string[],
    model: string,
  ): Promise<readonly StoredCategoryEmbedding[]>;
  save(embeddings: readonly StoredCategoryEmbedding[]): Promise<void>;
}

export interface TenantBudgetUsage {
  readonly tenantId: string;
  readonly windowStart: Date;
  readonly analyses: number;
  readonly providerCalls: number;
}

/**
 * Contabiliza el consumo por tenant en una ventana temporal. Vive en la base de datos porque el
 * límite debe respetarse entre todas las instancias del worker, no dentro de un solo proceso.
 */
export interface TenantBudgetRepository {
  /**
   * Reserva una unidad de consumo. Devuelve `false` cuando el tenant agotó su presupuesto, en cuyo
   * caso el análisis debe degradarse en lugar de gastar cuota del proveedor.
   */
  tryConsume(tenantId: string, windowSeconds: number, maxAnalyses: number): Promise<boolean>;
  recordProviderCalls(tenantId: string, windowSeconds: number, calls: number): Promise<void>;
  findUsage(tenantId: string, windowSeconds: number): Promise<TenantBudgetUsage | undefined>;
}

export interface RetentionOutcome {
  readonly deleted: number;
  readonly minimized: number;
}

export interface AuditRetentionRepository {
  /** Elimina las decisiones más antiguas que el plazo de retención. */
  purgeOlderThan(days: number): Promise<number>;
  /**
   * Sustituye el texto conservado por su huella una vez superado el plazo de minimización,
   * conservando la trazabilidad sin retener el contenido original.
   */
  minimizeOlderThan(days: number): Promise<number>;
}

export type AuditClaim =
  | { readonly state: 'ACQUIRED' }
  | { readonly state: 'IN_PROGRESS' }
  | { readonly state: 'COMPLETED'; readonly result: SemanticAnalysisResult };

export interface SemanticAuditRepository {
  claim(request: SemanticAnalysisRequest): Promise<AuditClaim>;
  complete(request: SemanticAnalysisRequest, result: SemanticAnalysisResult): Promise<void>;
  fail(request: SemanticAnalysisRequest, errorCode: string): Promise<void>;
  /**
   * Marca la operación como agotada tras consumir todos los reintentos de la cola.
   */
  exhaust(request: SemanticAnalysisRequest, errorCode: string): Promise<void>;
  findResult(requestId: string, tenantId?: string): Promise<SemanticAnalysisResult | undefined>;
}

export interface QueueDepthSnapshot {
  readonly pending: number;
  readonly deadLetter: number;
}

export interface EnqueueOutcome {
  /** Ausente cuando la cola descartó el envío por existir ya un análisis activo. */
  readonly jobId: string | undefined;
  readonly deduplicated: boolean;
}

export interface SemanticJobQueue {
  start(): Promise<void>;
  stop(): Promise<void>;
  enqueue(request: SemanticAnalysisRequest): Promise<EnqueueOutcome>;
  subscribe(consumer: (request: SemanticAnalysisRequest) => Promise<void>): Promise<void>;
  /**
   * Consume la cola dead-letter para dejar constancia de las solicitudes que agotaron reintentos.
   */
  subscribeDeadLetter(consumer: (request: SemanticAnalysisRequest) => Promise<void>): Promise<void>;
  getDepth(): Promise<QueueDepthSnapshot>;
  isHealthy(): boolean;
}

export interface AnalysisMetricEvent {
  readonly status: DecisionStatus;
  readonly tierUsed: AnalysisTier;
  readonly escalated: boolean;
  readonly processingTimeMs: number;
  readonly candidateCount: number;
  readonly tenantId?: string | undefined;
}

export interface ProviderMetricEvent {
  readonly tier: AnalysisTier;
  readonly model: string;
  readonly durationMs: number;
  readonly attempts: number;
  readonly outcome: 'SUCCESS' | 'FAILURE';
}

export interface FailureMetricEvent {
  readonly errorCode: string;
  readonly retryable: boolean;
  readonly tenantId?: string | undefined;
}

/**
 * Puerto de telemetría. Mantiene el núcleo libre de cualquier cliente de métricas concreto:
 * el host puede sustituirlo por Prometheus, OpenTelemetry o su propio recolector.
 */
export interface SemanticMetricsRecorder {
  recordAnalysis(event: AnalysisMetricEvent): void;
  recordProviderCall(event: ProviderMetricEvent): void;
  recordFailure(event: FailureMetricEvent): void;
  recordQueueDepth(snapshot: QueueDepthSnapshot): void;
}
