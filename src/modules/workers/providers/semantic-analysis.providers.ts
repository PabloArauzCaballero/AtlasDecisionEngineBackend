import { ConfigService } from '@nestjs/config';
import { EngineSemanticMetricsRecorder } from '../semantic-analysis/adapters/engine-metrics.recorder';
import { PrismaSemanticAuditRepository } from '../semantic-analysis/adapters/prisma-audit.repository';
import {
  PrismaAuditRetentionRepository,
  PrismaTenantBudgetRepository,
} from '../semantic-analysis/adapters/prisma-budget.repository';
import {
  PrismaCategoryEmbeddingRepository,
  PrismaEntityAliasRepository,
  PrismaSemanticCategoryRepository,
} from '../semantic-analysis/adapters/prisma-catalog.repository';
import { AuditRetentionService } from '../semantic-analysis/core/application/audit-retention.service';
import { CatalogCache } from '../semantic-analysis/core/application/catalog-cache';
import { ClassificationCache } from '../semantic-analysis/core/application/classification-cache';
import { DecisionEngine } from '../semantic-analysis/core/application/decision-engine';
import { EntityResolver } from '../semantic-analysis/core/application/entity-resolver';
import { LexicalCandidateRetriever } from '../semantic-analysis/core/application/lexical-candidate-retriever';
import {
  AUDIT_RETENTION_REPOSITORY,
  CANDIDATE_RETRIEVER,
  CATEGORY_EMBEDDING_REPOSITORY,
  ENTITY_ALIAS_REPOSITORY,
  SEMANTIC_AUDIT_REPOSITORY,
  SEMANTIC_CATEGORY_REPOSITORY,
  SEMANTIC_METRICS_RECORDER,
  SEMANTIC_MODEL_PROVIDER,
  SEMANTIC_WORKER_CONFIG,
  TENANT_BUDGET_REPOSITORY,
} from '../semantic-analysis/core/application/ports';
import { SemanticAnalysisPipeline } from '../semantic-analysis/core/application/semantic-analysis.pipeline';
import { UNRESOLVED_SINK } from '../semantic-analysis/core/application/ports';
import { SemanticAnalysisProcessor } from '../semantic-analysis/core/application/semantic-analysis.processor';
import { SemanticAnalysisResultBuilder } from '../semantic-analysis/core/application/semantic-analysis.result-builder';
import { TenantBudgetGuard } from '../semantic-analysis/core/application/tenant-budget.guard';
import { TextNormalizer } from '../semantic-analysis/core/application/text-normalizer';
import { SemanticCategoryService } from '../semantic-analysis/semantic-category.service';
import { UnresolvedClassificationService } from '../semantic-analysis/unresolved-classification.service';
import { UnresolvedResolutionService } from '../semantic-analysis/unresolved-resolution.service';
import { UnresolvedReevaluationService } from '../semantic-analysis/unresolved-reevaluation.service';
import { SemanticAnalysisService } from '../semantic-analysis/semantic-analysis.service';
import { buildSemanticWorkerConfig } from '../semantic-analysis/semantic-config.bridge';
import { buildSemanticModelProvider } from '../semantic-analysis/semantic-model-provider.bridge';
import { OpenRouterCatalogService } from '../semantic-analysis/model-settings/openrouter-catalog.service';
import { SemanticModelProbeService } from '../semantic-analysis/model-settings/semantic-model-probe.service';
import { SemanticModelSettingsService } from '../semantic-analysis/model-settings/semantic-model-settings.service';
import { SemanticRetentionSweeperService } from '../semantic-analysis/semantic-retention-sweeper.service';
import { SemanticRunWorkerService } from '../semantic-analysis/semantic-run-worker.service';
import { WORKER_SUPPORT_PROVIDERS } from '../worker-support.providers';

export const SEMANTIC_ANALYSIS_PROVIDERS = [
  SemanticCategoryService,
  UnresolvedClassificationService,
  UnresolvedResolutionService,
  UnresolvedReevaluationService,
  // El nucleo escala las abstenciones por un puerto; aqui se le enlaza quien
  // las recoge. Sin este enlace el clasificador funciona igual, sin bandeja.
  { provide: UNRESOLVED_SINK, useExisting: UnresolvedClassificationService },
  // --- Worker A: análisis semántico --------------------------------------
  SemanticAnalysisService,
  SemanticRunWorkerService,
  // La política de retención venía en el núcleo absorbido, pero sin nada que
  // la ejecutase: la disparaba el planificador del paquete original. El
  // barrendero la devuelve al calendario del motor.
  AuditRetentionService,
  SemanticRetentionSweeperService,

  // Núcleo absorbido, sin una línea modificada.
  TextNormalizer,
  EntityResolver,
  DecisionEngine,
  CatalogCache,
  ClassificationCache,
  TenantBudgetGuard,
  SemanticAnalysisResultBuilder,
  ...WORKER_SUPPORT_PROVIDERS,
  SemanticAnalysisPipeline,
  SemanticAnalysisProcessor,
  // `TracingService` ya no se declara aquí: la capa de trazado se promovió a
  // `common/observability` y el `ObservabilityModule` es global, así que este
  // worker recibe la MISMA instancia que el resto del motor. Declararla de
  // nuevo crearía un segundo emisor de trazas dentro del mismo proceso.

  // Adaptadores que sustituyen la infraestructura propia del paquete.
  PrismaSemanticCategoryRepository,
  { provide: SEMANTIC_CATEGORY_REPOSITORY, useExisting: PrismaSemanticCategoryRepository },
  { provide: ENTITY_ALIAS_REPOSITORY, useClass: PrismaEntityAliasRepository },
  { provide: SEMANTIC_AUDIT_REPOSITORY, useClass: PrismaSemanticAuditRepository },
  { provide: CATEGORY_EMBEDDING_REPOSITORY, useClass: PrismaCategoryEmbeddingRepository },
  { provide: TENANT_BUDGET_REPOSITORY, useClass: PrismaTenantBudgetRepository },
  { provide: AUDIT_RETENTION_REPOSITORY, useClass: PrismaAuditRetentionRepository },
  { provide: SEMANTIC_METRICS_RECORDER, useClass: EngineSemanticMetricsRecorder },

  {
    provide: SEMANTIC_WORKER_CONFIG,
    useFactory: buildSemanticWorkerConfig,
    inject: [ConfigService],
  },

  /*
   * Gateway y modelos del escalón remoto, elegibles desde el portal. El
   * servicio sondea la fila en los procesos que corren el worker, y el puente
   * de abajo reconstruye el adaptador y vacía la caché de veredictos cuando
   * cambia. El catálogo y la sonda sólo los usa el controlador.
   */
  SemanticModelSettingsService,
  OpenRouterCatalogService,
  SemanticModelProbeService,

  /**
   * Recuperación de candidatos.
   *
   * Entrega el recuperador léxico. El modo híbrido existe en el núcleo y está
   * absorbido, pero **no se activa aquí**: exige calcular y almacenar un
   * vector por categoría antes de servir para algo, y encenderlo sin ese paso
   * previo devolvería candidatos peores que el léxico y gastando cuota.
   * Queda como trabajo pendiente y documentado, no como una rama a medias que
   * alguien pueda encender por una variable de entorno.
   */
  { provide: CANDIDATE_RETRIEVER, useClass: LexicalCandidateRetriever },

  /**
   * Proveedor de modelo. La fábrica absorbida elige entre OpenAI y el
   * clasificador de transformers por entorno, pero valida credenciales y URLs
   * al construir: hacerlo aquí impedía
   * arrancar cualquier proceso sin `OPENAI_API_KEY`, incluso una réplica de
   * API con el worker apagado. El puente lo construye en la primera
   * clasificación y traduce `SEMANTIC_ANALYSIS_PROVIDER` — la variable que
   * decide si el worker se registra — al nombre que espera el núcleo.
   */
  {
    provide: SEMANTIC_MODEL_PROVIDER,
    useFactory: buildSemanticModelProvider,
    inject: [
      ConfigService,
      SEMANTIC_WORKER_CONFIG,
      SemanticModelSettingsService,
      ClassificationCache,
    ],
  },
];
