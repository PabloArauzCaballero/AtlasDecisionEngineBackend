import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BankStatementController } from './bank-statement/bank-statement.controller';
import { BankStatementRunWorkerService } from './bank-statement/bank-statement-run-worker.service';
import { BankStatementService } from './bank-statement/bank-statement.service';
import { EngineSemanticMetricsRecorder } from './semantic-analysis/adapters/engine-metrics.recorder';
import { PrismaSemanticAuditRepository } from './semantic-analysis/adapters/prisma-audit.repository';
import {
  PrismaAuditRetentionRepository,
  PrismaTenantBudgetRepository,
} from './semantic-analysis/adapters/prisma-budget.repository';
import {
  PrismaCategoryEmbeddingRepository,
  PrismaEntityAliasRepository,
  PrismaSemanticCategoryRepository,
} from './semantic-analysis/adapters/prisma-catalog.repository';
import { CatalogCache } from './semantic-analysis/core/application/catalog-cache';
import { DecisionEngine } from './semantic-analysis/core/application/decision-engine';
import { EntityResolver } from './semantic-analysis/core/application/entity-resolver';
import { LexicalCandidateRetriever } from './semantic-analysis/core/application/lexical-candidate-retriever';
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
} from './semantic-analysis/core/application/ports';
import { SemanticAnalysisPipeline } from './semantic-analysis/core/application/semantic-analysis.pipeline';
import { SemanticAnalysisProcessor } from './semantic-analysis/core/application/semantic-analysis.processor';
import { SemanticAnalysisResultBuilder } from './semantic-analysis/core/application/semantic-analysis.result-builder';
import { TenantBudgetGuard } from './semantic-analysis/core/application/tenant-budget.guard';
import { TextNormalizer } from './semantic-analysis/core/application/text-normalizer';
import { loadModelProviders } from './semantic-analysis/core/config/model-provider.factory';
import type { SemanticWorkerConfig } from './semantic-analysis/core/config/semantic-worker.config';
import { TracingService } from './semantic-analysis/core/observability/tracing.service';
import { SemanticAnalysisController } from './semantic-analysis/semantic-analysis.controller';
import { SemanticAnalysisService } from './semantic-analysis/semantic-analysis.service';
import { buildSemanticWorkerConfig } from './semantic-analysis/semantic-config.bridge';
import { SemanticRunWorkerService } from './semantic-analysis/semantic-run-worker.service';
import { WorkersController } from './workers.controller';

/**
 * Workers adicionales (ADR-0026): análisis semántico y extractos bancarios.
 *
 * Un módulo con **dos workers independientes dentro**. Comparten el catálogo
 * (`/v1/workers`) y la forma de sus ejecuciones, y nada más: cada uno tiene su
 * tabla, su trabajo de fondo, su processor, su configuración y sus pruebas.
 * Fundirlos en un processor común para ahorrar archivos habría acoplado un
 * fallo del lector de PDF con la cuota de un proveedor de modelos.
 *
 * El grueso de este archivo es el cableado de los puertos del worker semántico,
 * y ese es justamente el trabajo que su arquitectura hexagonal permitía hacer
 * **sin tocar su núcleo**: donde el paquete traía pg-boss, Sequelize y un
 * registro de Prometheus propios, ahora hay adaptadores contra la cola, el ORM
 * y el recolector que el motor ya tenía.
 *
 * No declara `imports`: los dos trabajos se registran solos en
 * `JobSchedulerService`, que es global, y la persistencia va por `PrismaService`.
 * Los servicios de fondo consultan `WORKER_ROLE` en su propio `onModuleInit`,
 * así que cargar este módulo en una réplica de API no arranca ningún worker.
 */
@Module({
  controllers: [WorkersController, BankStatementController, SemanticAnalysisController],
  providers: [
    // --- Worker B: extractos bancarios -------------------------------------
    BankStatementService,
    BankStatementRunWorkerService,

    // --- Worker A: análisis semántico --------------------------------------
    SemanticAnalysisService,
    SemanticRunWorkerService,

    // Núcleo absorbido, sin una línea modificada.
    TextNormalizer,
    EntityResolver,
    DecisionEngine,
    CatalogCache,
    TenantBudgetGuard,
    SemanticAnalysisResultBuilder,
    SemanticAnalysisPipeline,
    SemanticAnalysisProcessor,
    TracingService,

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
     * Proveedor de modelo. La fábrica absorbida elige entre OpenAI y Ollama por
     * entorno. Sin `SEMANTIC_ANALYSIS_PROVIDER` el worker no se registra, así
     * que en ese caso este proveedor se construye pero nunca se invoca.
     */
    {
      provide: SEMANTIC_MODEL_PROVIDER,
      useFactory: (config: SemanticWorkerConfig) =>
        loadModelProviders(process.env, config).modelProvider,
      inject: [SEMANTIC_WORKER_CONFIG],
    },
  ],
  exports: [BankStatementService, SemanticAnalysisService],
})
export class WorkersModule {}
