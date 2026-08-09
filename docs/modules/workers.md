<!-- GENERADO POR scripts/docs/generate-catalogs.mjs — NO EDITAR A MANO.
     Fuente: src/modules/workers/. Ejecute `yarn docs:catalog` tras cambiar el código. -->

# Módulo `workers`


## Responsabilidad

Código: [`src/modules/workers/`](https://github.com/) · 100 ficheros TypeScript.

Etiquetas de API: **Workers · Extractos bancarios**, **Workers · Análisis semántico**, **Workers**.

## Endpoints

| Método | Ruta | Operación | Resumen |
| --- | --- | --- | --- |
| `GET` | `/v1/workers` | `workersList` | Workers disponibles, con sus límites y disponibilidad |
| `GET` | `/v1/workers/{code}/metrics` | `workersWorkerMetrics` | Salud, latencia, cola e incidencias de un worker |
| `GET` | `/v1/workers/bank-statement/fixtures` | `bankStatementListFixtures` | Escenarios de prueba disponibles |
| `POST` | `/v1/workers/bank-statement/runs` | `bankStatementCreateRun` | Encola una conversión de extracto |
| `GET` | `/v1/workers/bank-statement/runs` | `bankStatementListRuns` | Ejecuciones del tenant |
| `GET` | `/v1/workers/bank-statement/runs/{requestId}` | `bankStatementGetRun` | Estado, progreso y resultado de una ejecución |
| `POST` | `/v1/workers/bank-statement/runs/{requestId}/cancel` | `bankStatementCancelRun` | Cancela una ejecución que nadie ha reclamado todavía |
| `GET` | `/v1/workers/bank-statement/runs/{requestId}/download` | `bankStatementDownload` | Descarga el resultado en CSV o JSON |
| `GET` | `/v1/workers/semantic-analysis/fixtures` | `semanticAnalysisListFixtures` | Escenarios de prueba disponibles |
| `POST` | `/v1/workers/semantic-analysis/runs` | `semanticAnalysisCreateRun` | Encola un análisis semántico |
| `GET` | `/v1/workers/semantic-analysis/runs` | `semanticAnalysisListRuns` | Análisis del tenant |
| `GET` | `/v1/workers/semantic-analysis/runs/{requestId}` | `semanticAnalysisGetRun` | Estado, progreso y resultado de un análisis |
| `POST` | `/v1/workers/semantic-analysis/runs/{requestId}/cancel` | `semanticAnalysisCancelRun` | Cancela un análisis que nadie ha reclamado todavía |

## Autorización

Roles exigidos por sus rutas: `AUDITOR`, `COMPLIANCE`, `FRAUD_ANALYST`, `OPERATIONS`, `QA_ANALYST`, `RISK_ANALYST`. La decisión es del servidor (`RolesGuard`), nunca del frontend.

## Códigos de error propios

- `BANK_STATEMENT_FILE_EMPTY`
- `BANK_STATEMENT_FILE_NAME_INVALID`
- `BANK_STATEMENT_FILE_NOT_PDF`
- `BANK_STATEMENT_FILE_REQUIRED`
- `BANK_STATEMENT_FILE_TOO_LARGE`
- `BANK_STATEMENT_RESULT_NOT_READY`
- `BANK_STATEMENT_RUN_NOT_CANCELLABLE`
- `BANK_STATEMENT_RUN_NOT_FOUND`
- `SEMANTIC_INPUT_AMBIGUOUS`
- `SEMANTIC_RUN_NOT_CANCELLABLE`
- `SEMANTIC_RUN_NOT_FOUND`
- `SEMANTIC_TEXT_EMPTY`
- `SEMANTIC_TEXT_TOO_LONG`
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

- `AuditRetentionService`
- `BancoSolStatementParser`
- `BankStatementController`
- `BankStatementRunWorkerService`
- `BankStatementService`
- `BankStatementWorkerService`
- `BcpStatementParser`
- `BnbStatementParser`
- `CatalogCache`
- `ConversionMetrics`
- `CreateBankStatementRunDto`
- `CreateSemanticAnalysisRunDto`
- `DecisionEngine`
- `DocumentClassifier`
- `EconomicoStatementParser`
- `EngineSemanticMetricsRecorder`
- `EntityResolver`
- `FileValidationService`
- `GanaderoStatementParser`
- `GenericStatementStrategy`
- `HybridCandidateRetriever`
- `InstitutionDetector`
- `InvalidProfileError`
- `LayoutPdfReader`
- `LexicalCandidateRetriever`
- `MercantilStatementParser`
- `OpenAiEmbeddingProvider`
- `OpenAiSemanticProvider`
- `PrismaAuditRetentionRepository`
- `PrismaCategoryEmbeddingRepository`
- `PrismaEntityAliasRepository`
- `PrismaSemanticAuditRepository`
- `PrismaSemanticCategoryRepository`
- `PrismaTenantBudgetRepository`
- `ProfileStatementStrategy`
- `SemanticAnalysisController`
- `SemanticAnalysisError`
- `SemanticAnalysisPipeline`
- `SemanticAnalysisProcessor`
- `SemanticAnalysisResultBuilder`
- `SemanticAnalysisService`
- `SemanticConfigurationError`
- `SemanticExhaustedError`
- `SemanticProviderError`
- `SemanticRetentionSweeperService`
- `SemanticRunWorkerService`
- `SemanticTimeoutError`
- `SpecializedParserStrategy`
- `StatementDownloadQueryDto`
- `StatementExtractor`
- `StatementParserRegistry`
- `StatementProcessingError`
- `TableAnalyzer`
- `TenantBudgetGuard`
- `TextNormalizer`
- `TimeoutExceededError`
- `TransformerEmbeddingProvider`
- `TransformerSemanticProvider`
- `UnionStatementParser`
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
