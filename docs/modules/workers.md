<!-- GENERADO POR scripts/docs/generate-catalogs.mjs — NO EDITAR A MANO.
     Fuente: src/modules/workers/. Ejecute `yarn docs:catalog` tras cambiar el código. -->

# Módulo `workers`


## Responsabilidad

Código: [`src/modules/workers/`](https://github.com/) · 186 ficheros TypeScript.

Etiquetas de API: **Workers · Locución**, **Workers · Extractos bancarios**, **Workers · Verificación de identidad**, **Workers · Análisis semántico**, **Workers · Categorías semánticas**, **Workers · Pendientes de clasificación**, **Workers**.

## Endpoints

| Método | Ruta | Operación | Resumen |
| --- | --- | --- | --- |
| `GET` | `/v1/workers` | `workersList` | Workers disponibles, con sus límites y disponibilidad |
| `GET` | `/v1/workers/{code}/metrics` | `workersWorkerMetrics` | Salud, latencia, cola e incidencias de un worker |
| `GET` | `/v1/workers/audio-tts/fixtures` | `audioTtsListFixtures` | Escenarios de prueba disponibles |
| `POST` | `/v1/workers/audio-tts/runs` | `audioTtsCreateRun` | Encola una locución |
| `GET` | `/v1/workers/audio-tts/runs` | `audioTtsListRuns` | Locuciones del tenant |
| `GET` | `/v1/workers/audio-tts/runs/{requestId}` | `audioTtsGetRun` | Estado, progreso y desenlace de una locución |
| `GET` | `/v1/workers/audio-tts/runs/{requestId}/audio` | `audioTtsAudioOf` | Reproduce o descarga el audio de una locución |
| `POST` | `/v1/workers/audio-tts/runs/{requestId}/cancel` | `audioTtsCancelRun` | Cancela una locución que nadie ha reclamado todavía |
| `GET` | `/v1/workers/audio-tts/templates` | `audioTtsListTemplates` | Plantillas de locución del tenant, con sus variables |
| `GET` | `/v1/workers/bank-statement/fixtures` | `bankStatementListFixtures` | Escenarios de prueba disponibles |
| `POST` | `/v1/workers/bank-statement/runs` | `bankStatementCreateRun` | Encola una conversión de extracto |
| `GET` | `/v1/workers/bank-statement/runs` | `bankStatementListRuns` | Ejecuciones del tenant |
| `GET` | `/v1/workers/bank-statement/runs/{requestId}` | `bankStatementGetRun` | Estado, progreso y resultado de una ejecución |
| `POST` | `/v1/workers/bank-statement/runs/{requestId}/cancel` | `bankStatementCancelRun` | Cancela una ejecución que nadie ha reclamado todavía |
| `GET` | `/v1/workers/bank-statement/runs/{requestId}/download` | `bankStatementDownload` | Descarga el resultado en CSV o JSON |
| `GET` | `/v1/workers/identity-verification/fixtures` | `identityVerificationListFixtures` | Escenarios de prueba disponibles |
| `POST` | `/v1/workers/identity-verification/runs` | `identityVerificationCreateRun` | Encola una verificación de identidad |
| `GET` | `/v1/workers/identity-verification/runs` | `identityVerificationListRuns` | Verificaciones del tenant |
| `GET` | `/v1/workers/identity-verification/runs/{requestId}` | `identityVerificationGetRun` | Estado, progreso y veredicto de una verificación |
| `POST` | `/v1/workers/identity-verification/runs/{requestId}/cancel` | `identityVerificationCancelRun` | Cancela una verificación que nadie ha reclamado todavía |
| `GET` | `/v1/workers/semantic-analysis/categories` | `semanticCategoryList` | Árbol de categorías del tenant |
| `POST` | `/v1/workers/semantic-analysis/categories` | `semanticCategoryCreate` | Crea o reemplaza una categoría |
| `PUT` | `/v1/workers/semantic-analysis/categories/{code}` | `semanticCategoryUpdate` | Actualiza una categoría |
| `DELETE` | `/v1/workers/semantic-analysis/categories/{code}` | `semanticCategoryDeactivate` | Desactiva una categoría (no se borra: las trazas la citan) |
| `POST` | `/v1/workers/semantic-analysis/categories/import` | `semanticCategoryImport` | Inyecta un subárbol completo desde JSON |
| `GET` | `/v1/workers/semantic-analysis/fixtures` | `semanticAnalysisListFixtures` | Escenarios de prueba disponibles |
| `POST` | `/v1/workers/semantic-analysis/runs` | `semanticAnalysisCreateRun` | Encola un análisis semántico |
| `GET` | `/v1/workers/semantic-analysis/runs` | `semanticAnalysisListRuns` | Análisis del tenant |
| `GET` | `/v1/workers/semantic-analysis/runs/{requestId}` | `semanticAnalysisGetRun` | Estado, progreso y resultado de un análisis |
| `POST` | `/v1/workers/semantic-analysis/runs/{requestId}/cancel` | `semanticAnalysisCancelRun` | Cancela un análisis que nadie ha reclamado todavía |
| `GET` | `/v1/workers/semantic-analysis/unresolved` | `unresolvedClassificationList` | Pendientes, los más frecuentes primero |
| `POST` | `/v1/workers/semantic-analysis/unresolved/{id}/resolve` | `unresolvedClassificationResolve` | Resuelve un pendiente y enseña el alias al catálogo |
| `GET` | `/v1/workers/semantic-analysis/unresolved/count` | `unresolvedClassificationCount` | Cuántos pendientes hay |
| `POST` | `/v1/workers/semantic-analysis/unresolved/reevaluate` | `unresolvedClassificationReevaluate` | Arranca la reevaluación de los pendientes con el catálogo de hoy |
| `GET` | `/v1/workers/semantic-analysis/unresolved/reevaluate/status` | `unresolvedClassificationReevaluationStatus` | Estado de la reevaluación en curso |

## Autorización

Roles exigidos por sus rutas: `AUDITOR`, `COMPLIANCE`, `FRAUD_ANALYST`, `OPERATIONS`, `QA_ANALYST`, `RISK_ANALYST`. La decisión es del servidor (`RolesGuard`), nunca del frontend.

## Códigos de error propios

- `AUDIO_ASSET_NOT_READY`
- `AUDIO_RUN_NOT_CANCELLABLE`
- `AUDIO_RUN_NOT_FOUND`
- `AUDIO_RUN_WITHOUT_AUDIO`
- `BANK_STATEMENT_FILE_EMPTY`
- `BANK_STATEMENT_FILE_NAME_INVALID`
- `BANK_STATEMENT_FILE_NOT_PDF`
- `BANK_STATEMENT_FILE_REQUIRED`
- `BANK_STATEMENT_FILE_TOO_LARGE`
- `BANK_STATEMENT_RESULT_NOT_READY`
- `BANK_STATEMENT_RUN_NOT_CANCELLABLE`
- `BANK_STATEMENT_RUN_NOT_FOUND`
- `IDENTITY_RUN_NOT_CANCELLABLE`
- `IDENTITY_RUN_NOT_FOUND`
- `SEMANTIC_CATEGORY_DUPLICATE_CODE`
- `SEMANTIC_CATEGORY_HAS_ACTIVE_CHILDREN`
- `SEMANTIC_CATEGORY_NOT_FOUND`
- `SEMANTIC_CATEGORY_PARENT_NOT_FOUND`
- `SEMANTIC_CATEGORY_SELF_PARENT`
- `SEMANTIC_CATEGORY_TREE_BROKEN`
- `SEMANTIC_INPUT_AMBIGUOUS`
- `SEMANTIC_RUN_NOT_CANCELLABLE`
- `SEMANTIC_RUN_NOT_FOUND`
- `SEMANTIC_TEXT_EMPTY`
- `SEMANTIC_TEXT_TOO_LONG`
- `UNRESOLVED_CATEGORY_REQUIRED`
- `UNRESOLVED_CLASSIFICATION_NOT_FOUND`
- `UNRESOLVED_NEW_CATEGORY_REQUIRED`
- `WORKER_ARGUMENT_INVALID`
- `WORKER_ARGUMENT_MISSING`
- `WORKER_ARGUMENT_TOO_LONG`
- `WORKER_FIXTURES_DISABLED`
- `WORKER_FIXTURE_NOT_FOUND`
- `WORKER_NOT_FOUND`
- `WORKER_SERVICE_FAILED`
- `WORKER_SERVICE_TIMEOUT`
- `WORKER_SERVICE_UNAVAILABLE`
- `WORKER_SERVICE_UNKNOWN`

## Clases exportadas

- `AudioAssetResolver`
- `AudioBudgetPolicy`
- `AudioDomainError`
- `AudioGenerationProcessor`
- `AudioSegmentAssembler`
- `AudioTemplateDto`
- `AudioTtsController`
- `AudioTtsRunWorkerService`
- `AudioTtsRuntimeFactory`
- `AudioTtsService`
- `AudioValueCipher`
- `AuditRetentionService`
- `BancoSolStatementParser`
- `BankStatementController`
- `BankStatementRunWorkerService`
- `BankStatementService`
- `BankStatementWorkerService`
- `BcpStatementParser`
- `BnbStatementParser`
- `BoliviaCiDocumentParser`
- `Bulkhead`
- `CatalogCache`
- `CircuitBreaker`
- `ConversionMetrics`
- `CreateAudioTtsRunDto`
- `CreateBankStatementRunDto`
- `CreateIdentityVerificationRunDto`
- `CreateSemanticAnalysisRunDto`
- `DecisionEngine`
- `DisabledLivenessAdapter`
- `DisabledTtsAdapter`
- `DocumentClassifier`
- `DocumentParserRegistry`
- `EconomicoStatementParser`
- `ElevenLabsHttpClient`
- `ElevenLabsTtsAdapter`
- `EngineAudioLogger`
- `EngineAudioMetrics`
- `EngineSemanticMetricsRecorder`
- `EntityResolver`
- `FakeTtsAdapter`
- `FileValidationService`
- `GanaderoStatementParser`
- `GenericDocumentParser`
- `GenericStatementStrategy`
- `GlosaFallbackClassifier`
- `HeuristicDocumentClassifierAdapter`
- `HumanFaceDetectorAdapter`
- `HumanFaceMatchAdapter`
- `HumanLivenessAdapter`
- `HybridCandidateRetriever`
- `IdentityDecisionEngine`
- `IdentityDomainError`
- `IdentityPipelineService`
- `IdentityRunWorkerService`
- `IdentityVerificationController`
- `IdentityVerificationService`
- `ImageQualityAssessmentService`
- `ImportSemanticCategoriesDto`
- `InstitutionDetector`
- `InvalidProfileError`
- `LayoutPdfReader`
- `LexicalCandidateRetriever`
- `LocalAudioStorageAdapter`
- `MercantilStatementParser`
- `OpenAiEmbeddingProvider`
- `OpenAiSemanticProvider`
- `PassportDocumentParser`
- `PrismaAudioAssetRepository`
- `PrismaAudioQuotaRepository`
- `PrismaAudioSegmentRepository`
- `PrismaAudioStorageAdapter`
- `PrismaAuditRetentionRepository`
- `PrismaCategoryEmbeddingRepository`
- `PrismaEntityAliasRepository`
- `PrismaSemanticAuditRepository`
- `PrismaSemanticCategoryRepository`
- `PrismaTenantBudgetRepository`
- `ProfileStatementStrategy`
- `ProviderRateGate`
- `ReevaluationStateDto`
- `ReevaluationSummaryDto`
- `ResolveUnresolvedDto`
- `ResolveUnresolvedResultDto`
- `RunScopedAudioQueue`
- `SemanticAnalysisController`
- `SemanticAnalysisError`
- `SemanticAnalysisPipeline`
- `SemanticAnalysisProcessor`
- `SemanticAnalysisResultBuilder`
- `SemanticAnalysisService`
- `SemanticCategoryController`
- `SemanticCategoryDto`
- `SemanticCategoryImportSummaryDto`
- `SemanticCategoryService`
- `SemanticConfigurationError`
- `SemanticExhaustedError`
- `SemanticProviderError`
- `SemanticRetentionSweeperService`
- `SemanticRunWorkerService`
- `SemanticTimeoutError`
- `SharpImageAdapter`
- `SpecializedParserStrategy`
- `StatementDownloadQueryDto`
- `StatementExtractor`
- `StatementParserRegistry`
- `StatementProcessingError`
- `TableAnalyzer`
- `TenantBudgetGuard`
- `TesseractOcrAdapter`
- `TextNormalizer`
- `TimeoutExceededError`
- `TransformerEmbeddingProvider`
- `TransformerSemanticProvider`
- `TtsProviderError`
- `UnionStatementParser`
- `UnresolvedClassificationController`
- `UnresolvedClassificationDto`
- `UnresolvedClassificationService`
- `UnresolvedCountsDto`
- `UnresolvedReevaluationService`
- `UnresolvedResolutionService`
- `UpsertSemanticCategoryDto`
- `WorkerDescriptorDto`
- `WorkerFixtureDto`
- `WorkerIncidentDto`
- `WorkerLatencyDto`
- `WorkerMetricsDto`
- `WorkerMetricsQueryDto`
- `WorkerMetricsService`
- `WorkerQueueDto`
- `WorkerRunDto`
- `WorkerRunQueryDto`
- `WorkerServiceInvokerService`
- `WorkerStatusCountDto`
- `WorkersController`
- `WorkersModule`
