import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AudioTtsController } from './audio-tts/audio-tts.controller';
import { AudioTtsRunWorkerService } from './audio-tts/audio-tts-run-worker.service';
import { AudioTtsRuntimeFactory } from './audio-tts/audio-tts.runtime';
import { AudioTtsService } from './audio-tts/audio-tts.service';
import { BankStatementController } from './bank-statement/bank-statement.controller';
import { BankStatementRunWorkerService } from './bank-statement/bank-statement-run-worker.service';
import { BankStatementService } from './bank-statement/bank-statement.service';
import { FinancialInstitutionController } from './bank-statement/institutions/financial-institution.controller';
import { FinancialInstitutionService } from './bank-statement/institutions/financial-institution.service';
import { InstitutionCatalogService } from './bank-statement/institutions/institution-catalog.service';
import { StatementReviewController } from './bank-statement/review/statement-review.controller';
import { StatementReviewService } from './bank-statement/review/statement-review.service';
import {
  DisabledLivenessAdapter,
  HeuristicDocumentClassifierAdapter,
} from './identity-verification/core/adapters/local-providers.adapter';
import {
  HumanFaceDetectorAdapter,
  HumanFaceMatchAdapter,
  HumanLivenessAdapter,
} from './identity-verification/core/adapters/human-face.adapter';
import { TesseractOcrAdapter } from './identity-verification/core/adapters/tesseract-ocr.adapter';
import { SharpImageAdapter } from './identity-verification/core/adapters/sharp-image.adapter';
import { ImageQualityAssessmentService } from './identity-verification/core/image-quality-assessment.service';
import {
  IDENTITY_CLASSIFIER_PORT,
  IDENTITY_FACE_DETECTOR_PORT,
  IDENTITY_FACE_MATCH_PORT,
  IDENTITY_LIVENESS_PORT,
  IDENTITY_NORMALIZER_PORT,
  IDENTITY_OCR_PORT,
  IDENTITY_OPTIONS,
  type IdentityOptions,
} from './identity-verification/core/identity-options';
import { BoliviaCiDocumentParser } from './identity-verification/core/parsers/bolivia-ci-document.parser';
import {
  GenericDocumentParser,
  PassportDocumentParser,
} from './identity-verification/core/parsers/document-parser';
import { DocumentParserRegistry } from './identity-verification/core/parsers/document-parser.registry';
import { buildIdentityOptions } from './identity-verification/identity-config.bridge';
import { IdentityPipelineService } from './identity-verification/identity-pipeline.service';
import { IdentityRunWorkerService } from './identity-verification/identity-run-worker.service';
import { IdentityVerificationController } from './identity-verification/identity-verification.controller';
import { IdentityVerificationService } from './identity-verification/identity-verification.service';
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
import { AuditRetentionService } from './semantic-analysis/core/application/audit-retention.service';
import { CatalogCache } from './semantic-analysis/core/application/catalog-cache';
import { ClassificationCache } from './semantic-analysis/core/application/classification-cache';
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
import { UNRESOLVED_SINK } from './semantic-analysis/core/application/ports';
import { SemanticAnalysisProcessor } from './semantic-analysis/core/application/semantic-analysis.processor';
import { SemanticAnalysisResultBuilder } from './semantic-analysis/core/application/semantic-analysis.result-builder';
import { GlosaFallbackClassifier } from './semantic-analysis/core/application/glosa-fallback';
import { TenantBudgetGuard } from './semantic-analysis/core/application/tenant-budget.guard';
import { TextNormalizer } from './semantic-analysis/core/application/text-normalizer';
import { SemanticAnalysisController } from './semantic-analysis/semantic-analysis.controller';
import { SemanticCategoryController } from './semantic-analysis/semantic-category.controller';
import { SemanticCategoryService } from './semantic-analysis/semantic-category.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { UnresolvedClassificationController } from './semantic-analysis/unresolved-classification.controller';
import { UnresolvedClassificationService } from './semantic-analysis/unresolved-classification.service';
import { UnresolvedResolutionService } from './semantic-analysis/unresolved-resolution.service';
import { UnresolvedReevaluationService } from './semantic-analysis/unresolved-reevaluation.service';
import { SemanticAnalysisService } from './semantic-analysis/semantic-analysis.service';
import { buildSemanticWorkerConfig } from './semantic-analysis/semantic-config.bridge';
import { buildSemanticModelProvider } from './semantic-analysis/semantic-model-provider.bridge';
import { SemanticRetentionSweeperService } from './semantic-analysis/semantic-retention-sweeper.service';
import { SemanticRunWorkerService } from './semantic-analysis/semantic-run-worker.service';
import { WorkersController } from './workers.controller';
import { WorkerMetricsService } from './worker-metrics.service';
import { WorkerServiceInvokerService } from './worker-service-invoker.service';

/**
 * Workers adicionales (ADR-0026): análisis semántico, extractos bancarios,
 * verificación de identidad y locución.
 *
 * Un módulo con **cuatro workers independientes dentro**. Comparten el catálogo
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
  // La bandeja del motor, para avisar de un valor sin clasificar por el canal
  // estandar en vez de inventar uno propio.
  imports: [NotificationsModule],
  controllers: [
    WorkersController,
    AudioTtsController,
    BankStatementController,
    StatementReviewController,
    FinancialInstitutionController,
    IdentityVerificationController,
    SemanticAnalysisController,
    SemanticCategoryController,
    UnresolvedClassificationController,
  ],
  providers: [
    // El padrón de entidades: la tabla que decide a quién se atribuye un
    // extracto. El catálogo va antes que el CRUD porque éste lo invalida en cada
    // escritura, y antes que el worker porque el motor lo lee en cada documento.
    InstitutionCatalogService,
    FinancialInstitutionService,
    SemanticCategoryService,
    UnresolvedClassificationService,
    UnresolvedResolutionService,
    UnresolvedReevaluationService,
    // El nucleo escala las abstenciones por un puerto; aqui se le enlaza quien
    // las recoge. Sin este enlace el clasificador funciona igual, sin bandeja.
    { provide: UNRESOLVED_SINK, useExisting: UnresolvedClassificationService },
    /**
     * Puente con el motor de decisión: un nodo `WORKER` del grafo llama a los servicios de
     * estos dos workers y proyecta su respuesta a variables intermedias. Vive aquí, y no
     * en `GraphModule`, porque quien conoce a los workers es este módulo; el motor solo
     * conoce la interfaz `WorkerServiceInvoker`, que recibe como argumento de llamada.
     */
    WorkerServiceInvokerService,

    /**
     * Salud de los dos workers. Vive en la parte COMPARTIDA del módulo, junto al
     * catálogo, porque mide lo único que ambos comparten: el ciclo de vida de
     * sus ejecuciones. Cada worker conserva su tabla y su cola.
     */
    WorkerMetricsService,

    // --- Worker B: extractos bancarios -------------------------------------
    BankStatementService,
    BankStatementRunWorkerService,
    // La cola de revisión humana. Servicio aparte del de ejecuciones porque
    // responde a otra pregunta y la contesta con otras reglas: quién puede
    // resolver, en qué orden se trabaja y qué queda en la auditoría.
    StatementReviewService,

    // --- Worker D: locución -------------------------------------------------
    //
    // Se declaran TRES piezas y ninguna es el núcleo. El núcleo absorbido no
    // entra en el contenedor de Nest a propósito: sus repositorios van atados a
    // un tenant y un singleton no puede estarlo, así que lo arma
    // `AudioTtsRuntimeFactory` por ejecución. Ver ese archivo.
    AudioTtsService,
    AudioTtsRunWorkerService,
    AudioTtsRuntimeFactory,

    // --- Worker C: verificación de identidad --------------------------------
    IdentityVerificationService,
    IdentityRunWorkerService,
    IdentityPipelineService,
    // Núcleo absorbido: analizadores, medida de calidad y proveedores.
    BoliviaCiDocumentParser,
    PassportDocumentParser,
    GenericDocumentParser,
    DocumentParserRegistry,
    ImageQualityAssessmentService,
    {
      provide: IDENTITY_OPTIONS,
      useFactory: buildIdentityOptions,
      inject: [ConfigService],
    },
    /*
     * `sharp` sirve a la vez de normalizador y de recortador: el puerto
     * `FaceCropPort` es una interfaz aparte —para que un despliegue pueda
     * recortar con otra cosa— pero la MISMA instancia los cumple los dos, y
     * registrarla dos veces crearía dos procesos de imagen distintos donde el
     * pipeline espera uno.
     */
    SharpImageAdapter,
    { provide: IDENTITY_NORMALIZER_PORT, useExisting: SharpImageAdapter },
    /*
     * La lectura del documento es REAL, también en desarrollo: es lo único que
     * permite distinguir una cédula de una foto cualquiera. Corre en local
     * sobre WebAssembly y no abre ninguna conexión de red.
     */
    TesseractOcrAdapter,
    { provide: IDENTITY_OCR_PORT, useExisting: TesseractOcrAdapter },
    { provide: IDENTITY_CLASSIFIER_PORT, useClass: HeuristicDocumentClassifierAdapter },
    /*
     * La BIOMETRÍA también es real, y por el mismo motivo que la lectura.
     *
     * Detección, descriptor de 1024 dimensiones para comparar 1:1, antispoof y
     * prueba de vida salen de `@vladmandic/human`, que trae sus cinco redes
     * dentro del paquete y corre sobre WebAssembly en este mismo proceso: sin
     * credenciales, sin salir a la red y sin coste por verificación. Lo que
     * había aquí devolvía un parecido fijo elegido por el nombre del escenario,
     * de modo que un «VERIFICADO» sólo podía afirmar que se había leído un
     * documento válido —nunca que las dos caras fueran de la misma persona—.
     */
    { provide: IDENTITY_FACE_DETECTOR_PORT, useClass: HumanFaceDetectorAdapter },
    { provide: IDENTITY_FACE_MATCH_PORT, useClass: HumanFaceMatchAdapter },
    /*
     * La prueba de vida se puede apagar, y apagarla tiene consecuencias: sin
     * ella, una foto impresa del documento junto a una foto impresa de su
     * titular pasa una comparación 1:1. Por eso el esquema de entorno obliga a
     * declarar esa aceptación de riesgo por escrito para apagarla en producción.
     * El adaptador deshabilitado devuelve `NOT_RUN`, que el motor de decisión
     * trata como señal ausente y no como éxito.
     */
    {
      provide: IDENTITY_LIVENESS_PORT,
      useFactory: (config: ConfigService, options: IdentityOptions) =>
        (config.get<boolean>('IDENTITY_LIVENESS_ENABLED') ?? true)
          ? new HumanLivenessAdapter(options)
          : new DisabledLivenessAdapter(),
      inject: [ConfigService, IDENTITY_OPTIONS],
    },

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
    GlosaFallbackClassifier,
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
      inject: [ConfigService, SEMANTIC_WORKER_CONFIG],
    },
  ],
  exports: [
    AudioTtsService,
    AudioTtsRuntimeFactory,
    BankStatementService,
    SemanticAnalysisService,
    IdentityVerificationService,
    WorkerServiceInvokerService,
  ],
})
export class WorkersModule {}
