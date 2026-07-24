# Graph Report - AtlasDecisionEngine  (2026-07-23)

## Corpus Check
- 334 files · ~148,216 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2378 nodes · 5478 edges · 206 communities (139 shown, 67 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 52 edges (avg confidence: 0.79)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `76b34783`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- graph.types.ts
- CacheService
- seed.ts
- parseBigIntId
- views.controller.ts
- PrismaService
- artifact.dto.ts
- test-app.ts
- deployment.controller.ts
- devDependencies
- manual-review.controller.ts
- audit-query.service.ts
- RecordApprovalDecisionDto
- .append
- compilerOptions
- variable-resolution.service.ts
- traceability.service.ts
- scripts
- variable.service.ts
- AuthenticatedPrincipal
- app.module.ts
- DomainException
- .execute
- runtime.service.ts
- HashService
- dependencies
- deployment.service.ts
- MetricsService
- security.types.ts
- StructuredLoggerService
- identity-session.controller.ts
- ArtifactService
- CreateTestSuiteDto
- .execute
- IdentityProviderClient
- .logout
- VISTAS_POR_FASES.md
- identity-provider.client.ts
- simulation.service.ts
- AuthenticationGuard
- JwtVerifierService
- manifest.json
- exclude
- env.schema.ts
- VariableController
- server.mjs
- generate-baseline-sql.py
- TenantId
- security.module.ts
- Graph Report - AtlasDecisionEngine  (2026-07-18)
- SessionCookieService
- nest-cli.json
- Graph Report - AtlasDecisionEngine  (2026-07-19)
- safe-regex.ts
- package.json
- smoke.sh
- .run
- governance.service.ts
- Graph Report - AtlasDecisionEngine  (2026-07-19)
- CryptoModule
- ObservabilityModule
- env.schema.ts
- SecurityModule
- ATLAS Decision Engine Backend 2.0
- compile_all.sh script
- README.md
- Arquitectura técnica
- ATLAS Decision Engine Backend 2.0 — Entrega final de fase
- Ejemplos API
- Auditoría de seguridad y calidad — 2026-07-12
- jwt-verifier.service.ts
- Runbook operativo
- ATLAS — Paquete de arquitectura PlantUML
- ATLAS Decision Engine 2.0 — Production Readiness
- ManualReviewModule
- TrafficRuleDto
- deployment-resolver.service.ts
- ExecutionWriterService
- Despliegue
- .getMetrics
- Seguridad
- CLAUDE.md
- README.md
- Configurable outputs and RESULT nodes
- Fase 6 — Auditoría, investigaciones y observabilidad
- Resumen de vistas
- @nestjs/schematics
- .claude/settings.local.json
- docs/plantuml/compile_all.ps1
- AuditModule
- @nestjs/schematics
- @nestjs/testing
- prisma
- source-map-support
- ts-jest
- package.json
- graph.types.ts
- prisma.config.ts
- prisma/migrations/20260712190000_init/migration.sql
- client
- integration-clients.ts
- .deploy
- migration.sql
- .decide
- identity-integration.spec.ts
- manual-review.service.ts
- AuthenticationGuard
- prisma/migrations/20260716042805_add_integration_client_registry/migration.sql
- JwtVerifierService
- DeploymentController
- prisma/migrations/20260716183141_audit_access_denials/migration.sql
- DomainExceptionFilter
- prisma/migrations/20260716184106_fix_baseline_drift/migration.sql
- prisma/migrations/20260717054600_async_test_run_queue_columns/migration.sql
- prisma/migrations/20260717061000_audit_hash_key_rotation/migration.sql
- helpers.ts
- graph-determinism.validator.ts
- artifact.module.ts
- GovernanceService
- NotificationService
- notification.service.ts
- migration.sql
- class-validator
- supertest
- @types/compression
- @types/jest
- @types/node
- DeploymentResolverService
- DomainExceptionFilter
- .hmac
- .getMetrics
- deployment.module.ts
- IdentityLoginDto
- main.ts
- .run
- migration.sql
- Body
- Controller
- Get
- Headers
- Param
- Post
- Query
- IsArray
- IsBoolean
- IsEnum
- IsIn
- IsInt
- IsNotEmpty
- IsNumber
- IsObject
- IsOptional
- IsString
- Matches
- MaxLength
- Min
- Type
- ValidateNested
- 10-backend-architecture.md
- safe-regex.ts
- audit.module.ts
- prisma.module.ts
- rxjs
- migration.sql
- 30-security.md
- 40-observability.md
- 50-performance.md
- 60-testing.md
- 70-library-selection.md
- 80-database.md
- 90-documentation.md
- pg
- @prisma/client
- LiveExecutionModule
- RuntimeModule
- AccessAuditInterceptor
- .simulate
- AccessLogInterceptor
- @nestjs/config
- @nestjs/swagger
- @nestjs/testing
- @opentelemetry/exporter-trace-otlp-http
- @opentelemetry/instrumentation-express
- @opentelemetry/instrumentation-ioredis
- @opentelemetry/sdk-node
- pino
- @prisma/adapter-pg
- prom-client
- reflect-metadata
- zod
- prettier

## God Nodes (most connected - your core abstractions)
1. `PrismaService` - 152 edges
2. `AuthenticatedPrincipal` - 119 edges
3. `TenantId` - 98 edges
4. `Roles()` - 86 edges
5. `parseBigIntId()` - 59 edges
6. `DomainException` - 55 edges
7. `CurrentPrincipal` - 55 edges
8. `HashService` - 47 edges
9. `AuditService` - 37 edges
10. `MetricsService` - 37 edges

## Surprising Connections (you probably didn't know these)
- `createTestApp()` --references--> `test`  [EXTRACTED]
  test/e2e/support/test-app.ts → package.json
- `findCycle()` --indirect_call--> `node()`  [INFERRED]
  src/modules/graph/validators/graph-determinism.validator.ts → test/execution-engine-nodes.spec.ts
- `countTerminalPaths()` --indirect_call--> `node()`  [INFERRED]
  src/modules/graph/validators/graph-determinism.validator.ts → test/execution-engine-nodes.spec.ts
- `validateGraphStructure()` --indirect_call--> `node()`  [INFERRED]
  src/modules/graph/validators/graph-structure.validator.ts → test/execution-engine-nodes.spec.ts
- `reachableWithinDepth()` --indirect_call--> `node()`  [INFERRED]
  src/modules/nested-trees/nested-tree.service.ts → test/execution-engine-nodes.spec.ts

## Import Cycles
- None detected.

## Communities (206 total, 67 thin omitted)

### Community 0 - "graph.types.ts"
Cohesion: 0.14
Nodes (6): ExecutionWriterService, Injectable, IdempotencyService, Injectable, RuntimeService, Injectable

### Community 1 - "CacheService"
Cohesion: 0.25
Nodes (7): ActionDefinition, ConditionDefinition, DemoGraphResult, NodeDefinition, DemoReason, DemoSnapshotResult, DemoVariable

### Community 2 - "seed.ts"
Cohesion: 0.03
Nodes (64): affordabilityDecisionExpr, affordabilityDisposableFail, affordabilityNsfFail, affordabilityRatioFail, affordabilityRatioPenalty, affordabilityScoreExpr, amlDecisionExpr, amlRiskScoreExpr (+56 more)

### Community 3 - "parseBigIntId"
Cohesion: 0.10
Nodes (15): Catch, AppModule, Module, DomainExceptionFilter, AccessDenialAuditorService, Injectable, managementHeaders(), runtimeHeaders() (+7 more)

### Community 4 - "views.controller.ts"
Cohesion: 0.09
Nodes (32): ApiTags, Controller, Get, Query, ViewsController, ArtifactInputContractQueryDto, ArtifactPickerQueryDto, ArtifactVersionPickerQueryDto (+24 more)

### Community 5 - "PrismaService"
Cohesion: 0.14
Nodes (15): AuditQueryController, ApiTags, Controller, Get, Param, Query, AuditEventKeysetQueryDto, AuditEventSearchQueryDto (+7 more)

### Community 6 - "artifact.dto.ts"
Cohesion: 0.15
Nodes (32): ActionDto, ActionReasonDto, ArtifactListQueryDto, CloneVersionDto, ConditionDto, CreateArtifactDto, DependencyDto, EdgeConditionBindingDto (+24 more)

### Community 7 - "test-app.ts"
Cohesion: 0.14
Nodes (9): AccessLogInterceptor, Injectable, MetricsInterceptor, Injectable, MetricsService, Injectable, ObservabilityModule, Global (+1 more)

### Community 8 - "deployment.controller.ts"
Cohesion: 0.12
Nodes (14): RuntimeController, ApiTags, Body, Controller, Param, Post, Res, ExecuteDecisionDto (+6 more)

### Community 9 - "devDependencies"
Cohesion: 0.10
Nodes (21): dotenv, @nestjs/cli, @nestjs/schematics, devDependencies, dotenv, @nestjs/cli, @nestjs/schematics, prisma (+13 more)

### Community 10 - "manual-review.controller.ts"
Cohesion: 0.18
Nodes (10): activity, atlasBackendCatalog, atlasRiskScores, behavior, contactAddress, deviceSessionIp, externalProviders, fraudCompliance (+2 more)

### Community 11 - "audit-query.service.ts"
Cohesion: 0.17
Nodes (9): parseIfMatch(), Audience(), CurrentPrincipal, AuthenticatedPrincipal, Express, Request, Query, Get (+1 more)

### Community 12 - "RecordApprovalDecisionDto"
Cohesion: 0.18
Nodes (10): Delete, DependencyGraphController, NestedTreeController, ApiTags, Body, Controller, Get, Param (+2 more)

### Community 13 - ".append"
Cohesion: 0.16
Nodes (8): AccessAuditInterceptor, Injectable, IdentityProviderVerifierService, Injectable, VerifiedIdentityPrincipal, IntegrationClientService, ResolvedIntegrationClient, Injectable

### Community 14 - "compilerOptions"
Cohesion: 0.07
Nodes (26): prisma/**/*.ts, src/**/*.ts, test/**/*.ts, compilerOptions, allowSyntheticDefaultImports, declaration, emitDecoratorMetadata, esModuleInterop (+18 more)

### Community 15 - "variable-resolution.service.ts"
Cohesion: 0.05
Nodes (38): IsEmail, IdentityProviderClient, LoginInput, Injectable, identityPinChallengeSchema, IdentityProfile, identityProfileSchema, identityProviderSessionSchema (+30 more)

### Community 16 - "traceability.service.ts"
Cohesion: 0.26
Nodes (10): DeploymentModule, Module, GraphModule, Module, LiveExecutionModule, Module, NestedTreesModule, Module (+2 more)

### Community 17 - "scripts"
Cohesion: 0.07
Nodes (29): scripts, build, check, db:reset, format, format:check, graph:update, migration:validate (+21 more)

### Community 18 - "variable.service.ts"
Cohesion: 0.15
Nodes (23): ArtifactGraphSnapshot, GraphValidationReport, ValidationIssue, GraphValidatorService, Injectable, extractTemplateReferences(), countTerminalPaths(), findCycle() (+15 more)

### Community 19 - "AuthenticatedPrincipal"
Cohesion: 0.09
Nodes (28): ArtifactReferenceEdge, buildAdjacency(), computeMaxDepthFrom(), CycleCheckResult, detectCycle(), findAncestors(), findPath(), CreateArtifactReferenceDto (+20 more)

### Community 20 - "app.module.ts"
Cohesion: 0.22
Nodes (8): DeploymentController, ApiTags, Body, Controller, Get, Param, Post, Query

### Community 21 - "DomainException"
Cohesion: 0.10
Nodes (46): "decision_access_audit", "decision_action_reason_mapping", "decision_approval_decision", "decision_approval_evidence", "decision_approval_request", "decision_approval_step", "decision_artifact", "decision_artifact_variable_dependency" (+38 more)

### Community 22 - ".execute"
Cohesion: 0.20
Nodes (19): CreateReasonCodeDto, CreateVariableDefinitionDto, ReasonCodeListQueryDto, IsArray, IsBoolean, IsInt, IsNotEmpty, IsObject (+11 more)

### Community 23 - "runtime.service.ts"
Cohesion: 0.22
Nodes (9): "decision_node_script", "vw_artifact_input_contract", "vw_artifact_picker", "vw_artifact_version_picker", "vw_global_search", "vw_node_script", "vw_test_run_picker", "vw_test_suite_picker" (+1 more)

### Community 24 - "HashService"
Cohesion: 0.67
Nodes (3): CryptoModule, Global, Module

### Community 25 - "dependencies"
Cohesion: 0.29
Nodes (7): class-transformer, @nestjs/common, dependencies, class-transformer, @nestjs/common, rxjs, rxjs

### Community 27 - "MetricsService"
Cohesion: 0.18
Nodes (10): affordability, aml, compliance, creditRisk, eligibility, fraud, kyc, operational (+2 more)

### Community 28 - "security.types.ts"
Cohesion: 0.10
Nodes (5): canonicalize(), JsonPrimitive, JsonValue, normalize(), Money

### Community 30 - "identity-session.controller.ts"
Cohesion: 0.13
Nodes (16): ManualReviewController, ApiTags, Controller, Get, Query, AssignManualReviewDto, ManualReviewListQueryDto, ResolveManualReviewDto (+8 more)

### Community 31 - "ArtifactService"
Cohesion: 0.19
Nodes (14): ApprovalEvidenceDto, CreateCustomApprovalStepDto, RecordApprovalDecisionDto, SubmitReviewDto, IsArray, IsBoolean, IsIn, IsInt (+6 more)

### Community 32 - "CreateTestSuiteDto"
Cohesion: 0.23
Nodes (15): CreateTestSuiteDto, ImportTestCasesDto, RunTestSuiteDto, TestCaseDto, ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean (+7 more)

### Community 33 - ".execute"
Cohesion: 0.13
Nodes (11): HashService, Injectable, ResolvedDeployment, EngineExecutionResult, ExecutionTraceStep, VariableContractSnapshot, WriteExecutionInput, IdempotencyReservation (+3 more)

### Community 34 - "IdentityProviderClient"
Cohesion: 0.20
Nodes (9): affordabilityScoring, amlComplianceScoring, collectionsScoring, creditRiskScoring, decisionScoring, eligibilityScoring, fraudScoring, identityScoring (+1 more)

### Community 35 - ".logout"
Cohesion: 0.08
Nodes (39): AnalyzeCodeImportDto, CodeImportListQueryDto, SaveCodeImportDto, IsIn, IsInt, IsOptional, IsString, Matches (+31 more)

### Community 36 - "VISTAS_POR_FASES.md"
Cohesion: 0.09
Nodes (21): 10. Matriz resumida de permisos, 11. Reglas UX obligatorias para producción, 12. Definition of Done del frontend por vista, 13. Brechas de API antes de completar todas las vistas, 1.1 Variables, 1.2 Códigos de razón, 1. Convenciones, 2. Orden de implementación (+13 more)

### Community 37 - "identity-provider.client.ts"
Cohesion: 0.16
Nodes (7): EventBus, Injectable, field(), NotificationProjectorService, stringArray(), Injectable, CreateNotificationInput

### Community 38 - "simulation.service.ts"
Cohesion: 0.27
Nodes (6): DispatchedEventHandler, DispatchedEvent, EventEnvelope, OutboxPublisherService, Injectable, ClaimedRow

### Community 39 - "AuthenticationGuard"
Cohesion: 0.08
Nodes (21): GraphConditionSnapshot, GraphEdgeSnapshot, JS_WRAPPER, PYTHON_WRAPPER, ScriptLanguage, ScriptNodeRunnerService, ScriptRunnerMode, Injectable (+13 more)

### Community 40 - "JwtVerifierService"
Cohesion: 0.06
Nodes (23): assertEqual(), call(), decisionVariables, main(), managementHeaders, results, runtimeHeaders, CacheService (+15 more)

### Community 42 - "exclude"
Cohesion: 0.22
Nodes (8): prisma/seed.ts, **/*.spec.ts, test, ./tsconfig.json, exclude, extends, dist, node_modules

### Community 43 - "env.schema.ts"
Cohesion: 0.11
Nodes (16): ApiTags, Body, Controller, Param, Put, TutorialController, IsBoolean, IsIn (+8 more)

### Community 44 - "VariableController"
Cohesion: 0.13
Nodes (20): prisma, DemoArtifactSummary, logger, seedDemoArtifact(), buildDemoGraph(), computeNodeKey(), declineNodeKey(), seedDemoWorkflow() (+12 more)

### Community 46 - "server.mjs"
Cohesion: 0.22
Nodes (4): JS_WRAPPER, PYTHON_WRAPPER, server, socketDir

### Community 47 - "generate-baseline-sql.py"
Cohesion: 0.31
Nodes (8): db_object_name(), default_sql(), Field, Model, q(), Keep PostgreSQL identifiers at <=63 bytes with a deterministic suffix., Relation, sql_type()

### Community 48 - "TenantId"
Cohesion: 0.18
Nodes (12): TenantId, Body, Param, Post, ApiTags, Body, Controller, Get (+4 more)

### Community 49 - "security.module.ts"
Cohesion: 0.19
Nodes (9): DIRECT_ROLES, mapIdentityRoles(), ROLE_ALIASES, isPlatformRole(), PLATFORM_ROLES, PlatformRole, RolesGuard, Injectable (+1 more)

### Community 50 - "Graph Report - AtlasDecisionEngine  (2026-07-18)"
Cohesion: 0.13
Nodes (19): DeploymentListQueryDto, DeployVersionDto, RollbackDeploymentDto, SuspendDeploymentDto, TrafficRuleDto, IsArray, IsDateString, IsEnum (+11 more)

### Community 51 - "SessionCookieService"
Cohesion: 0.24
Nodes (8): CodeImportController, ApiTags, Body, Controller, Get, Param, Post, Query

### Community 52 - "nest-cli.json"
Cohesion: 0.29
Nodes (6): collection, compilerOptions, deleteOutDir, plugins, $schema, sourceRoot

### Community 53 - "Graph Report - AtlasDecisionEngine  (2026-07-19)"
Cohesion: 0.18
Nodes (17): decodeCursor(), encodeCursor(), keysetArgs(), keysetPage, KeysetPaginationQueryDto, PaginationQueryDto, IsInt, IsOptional (+9 more)

### Community 54 - "safe-regex.ts"
Cohesion: 0.16
Nodes (15): Patch, parseBigIntId(), Roles(), ArtifactController, ApiTags, Body, Controller, Get (+7 more)

### Community 55 - "package.json"
Cohesion: 0.33
Nodes (5): description, license, name, private, version

### Community 56 - "smoke.sh"
Cohesion: 0.33
Nodes (5): BASE_URL, MANAGEMENT_API_KEY, RUNTIME_API_KEY, smoke.sh script, TENANT_ID

### Community 58 - "governance.service.ts"
Cohesion: 0.70
Nodes (4): "integration_client", "integration_credential", "integration_scope", "integration_tenant_access"

### Community 59 - "Graph Report - AtlasDecisionEngine  (2026-07-19)"
Cohesion: 0.21
Nodes (5): ExpressionEvaluator, Injectable, baseReference(), principal, setup()

### Community 62 - "ObservabilityModule"
Cohesion: 0.10
Nodes (23): TraceabilityController, ApiTags, Body, Controller, Get, Param, Post, Query (+15 more)

### Community 63 - "env.schema.ts"
Cohesion: 0.22
Nodes (8): AppEnv, booleanFromString, envSchema, optionalSecret, optionalUrl, validateEnvironment(), base, jwtProduction

### Community 64 - "SecurityModule"
Cohesion: 0.09
Nodes (25): ExecutionEngineService, MutableExecutionState, Injectable, ArtifactReferenceResolution, ArtifactReferenceResolver, CompiledDecisionArtifact, DecisionReasonResult, GraphActionSnapshot (+17 more)

### Community 65 - "ATLAS Decision Engine Backend 2.0"
Cohesion: 0.15
Nodes (13): ATLAS Decision Engine Backend 2.0, Autenticación, Capacidades, Clientes de integración, Documentación vigente, Estado, Identidades firmadas, Inicio local (+5 more)

### Community 67 - "README.md"
Cohesion: 0.22
Nodes (9): NotificationController, ApiTags, Controller, Get, HttpCode, Param, Post, Query (+1 more)

### Community 68 - "Arquitectura técnica"
Cohesion: 0.18
Nodes (11): 10. Escalamiento, 1. Separación Control Plane / Data Plane, 2. Núcleo determinista, 3. Persistencia, 4. Inmutabilidad y estados, 5. Gobierno, 6. Seguridad, 7. Auditoría (+3 more)

### Community 69 - "ATLAS Decision Engine Backend 2.0 — Entrega final de fase"
Cohesion: 0.20
Nodes (10): Alcance entregado, ATLAS Decision Engine Backend 2.0 — Entrega final de fase, Cambios de datos, Contratos operativos definitivos, Declaración de entrega, Documentación oficial, Estado final, Evidencia de verificación (+2 more)

### Community 70 - "Ejemplos API"
Cohesion: 0.22
Nodes (8): Autenticación con bearer token, Autenticación de gestión con API key, Consultar eventos por fecha, Consultar evidencia, Ejecutar una decisión, Ejemplos API, Forzar revisión manual por fraude, Listar artefactos

### Community 71 - "Auditoría de seguridad y calidad — 2026-07-12"
Cohesion: 0.22
Nodes (8): Auditoría de seguridad y calidad — 2026-07-12, Hallazgos revisados sin acción (falsos positivos / severidad no justificada), P0 — El checksum del grafo nunca coincide entre `validate` y `compile`, P0 — `prisma migrate deploy` / `prisma db seed` fallan siempre (motor wasm), P1 — DTOs del grafo sin cota superior de tamaño, P1 — Sin rate limiting en intentos de autenticación fallidos, P2 — God classes (>300 líneas, responsabilidades mezcladas), P2 — Lógica de plantillas `{{path}}` duplicada

### Community 73 - "Runbook operativo"
Cohesion: 0.22
Nodes (8): Despliegue seguro, Falla del sink de archivo, Incidente: aumento de 401, 403 o 429, Incidente: incremento de NO_DECISION, Incidente: readiness falla, Incidente: ruptura de cadena de auditoría, Rollback de aplicación, Runbook operativo

### Community 74 - "ATLAS — Paquete de arquitectura PlantUML"
Cohesion: 0.29
Nodes (6): ATLAS — Paquete de arquitectura PlantUML, Compilación, Diagramas incluidos, Linux/macOS, PowerShell, Principios de diseño incorporados

### Community 75 - "ATLAS Decision Engine 2.0 — Production Readiness"
Cohesion: 0.29
Nodes (6): ATLAS Decision Engine 2.0 — Production Readiness, Estado honesto, Gates obligatorios antes de Go-Live, Mejoras incorporadas en 2.0, Riesgos abiertos, SLO inicial propuesto

### Community 76 - "ManualReviewModule"
Cohesion: 0.70
Nodes (4): atlas_audit_event_append_only(), trg_decision_audit_event_no_delete, trg_decision_audit_event_no_truncate, trg_decision_audit_event_no_update

### Community 77 - "TrafficRuleDto"
Cohesion: 0.50
Nodes (3): "decision_artifact", "decision_runtime_binding", "decision_runtime_idempotency"

### Community 86 - "Despliegue"
Cohesion: 0.12
Nodes (16): SimulationController, ApiTags, Body, Controller, Param, Post, SimulateDecisionDto, IsNotEmpty (+8 more)

### Community 88 - "Seguridad"
Cohesion: 0.24
Nodes (3): CreateVariableVersionDto, Injectable, VariableService

### Community 92 - "Configurable outputs and RESULT nodes"
Cohesion: 0.23
Nodes (9): TestingController, ApiTags, Body, Controller, Get, HttpCode, Param, Post (+1 more)

### Community 94 - "Fase 6 — Auditoría, investigaciones y observabilidad"
Cohesion: 0.15
Nodes (10): Header, SecurityReviewController, ApiTags, Controller, Get, Param, SecurityReviewModule, Module (+2 more)

### Community 97 - ".claude/settings.local.json"
Cohesion: 0.20
Nodes (9): Aislamiento por tenant (RLS), Arquitectura event-driven (Outbox transaccional + Bus de eventos), Componentes, Configuración, Contratos de evento versionados, El relay (entrega at-least-once), Observabilidad, Por qué un outbox transaccional (+1 more)

### Community 100 - "@nestjs/schematics"
Cohesion: 0.13
Nodes (9): Contenedores, Desarrollo local, Despliegue, Producción, Criterio de “pendiente”, Matriz de implementación frente a los 22 diagramas, Reglas operativas mínimas, Reporte responsable (+1 more)

### Community 102 - "prisma"
Cohesion: 0.15
Nodes (5): LEVEL_WEIGHT, PINO_METHOD, SENSITIVE_KEYS, StructuredLoggerService, Injectable

### Community 105 - "package.json"
Cohesion: 0.24
Nodes (4): ArtifactGraphReaderService, Injectable, ArtifactLifecycleService, Injectable

### Community 106 - "graph.types.ts"
Cohesion: 0.12
Nodes (10): AppendAuditEventInput, AuditService, Injectable, DenialRecord, allowedTransitions, Injectable, VersionStateService, CompilerService (+2 more)

### Community 108 - "prisma/migrations/20260712190000_init/migration.sql"
Cohesion: 0.20
Nodes (9): Bugs preexistentes encontrados y corregidos, Decisiones de diseño clave (para el revisor), Estado de integración a `main` — COMPLETADO Y VERIFICADO, Frontend — también fusionado y verificado, Nota de infraestructura, Pendiente menor (no bloqueante), Qué se implementó y verificó, Reporte final de implementación — Rebanadas 2-5 (+1 more)

### Community 109 - "client"
Cohesion: 0.33
Nodes (4): client, expectRejected(), countFor(), withNonSuperRole()

### Community 111 - ".deploy"
Cohesion: 0.31
Nodes (6): GovernanceController, ApiTags, Body, Controller, Param, Post

### Community 113 - ".decide"
Cohesion: 0.25
Nodes (4): NotificationService, Injectable, config, metrics

### Community 114 - "identity-integration.spec.ts"
Cohesion: 0.13
Nodes (14): Comandos permitidos, Comandos prohibidos, Condiciones para detenerse, Cuándo NO usarla, Cuándo usarla, Endurecimiento del backend — Atlas Decision Engine, Entregable, Evidencia requerida (+6 more)

### Community 115 - "manual-review.service.ts"
Cohesion: 0.24
Nodes (4): DecisionEventType, VersionPublishedPayload, VersionReviewOutcomePayload, VersionSubmittedForReviewPayload

### Community 116 - "AuthenticationGuard"
Cohesion: 0.13
Nodes (14): Comandos permitidos, Comandos prohibidos, Condiciones para detenerse, Cuándo NO usarla, Cuándo usarla, Entregable, Evidencia requerida, Flujo por fases (+6 more)

### Community 118 - "prisma/migrations/20260716042805_add_integration_client_registry/migration.sql"
Cohesion: 0.22
Nodes (8): Aplicación, Base de datos (Prisma), Calidad y verificación, Comandos de desarrollo (yarn), Equivalencias npm → yarn (referencia), Instalación, Otros, Pruebas

### Community 120 - "DeploymentController"
Cohesion: 0.22
Nodes (7): Jwk, JwksDocument, JwtClaims, JwtHeader, VerifiedJwtPrincipal, encode(), token()

### Community 121 - "prisma/migrations/20260716183141_audit_access_denials/migration.sql"
Cohesion: 0.22
Nodes (8): API (`/v1/notifications`), Bandeja de notificaciones, Destinatarios por rol, no por usuario, Frontend, Fuera de alcance (v2 / fases posteriores), Idempotencia (exactly-once sobre at-least-once), Principio de diseño: generar desde eventos, Reglas de proyección (v1)

### Community 123 - "prisma/migrations/20260716184106_fix_baseline_drift/migration.sql"
Cohesion: 0.11
Nodes (19): EventsModule, Module, PrismaModule, Global, Module, AuditQueryModule, Module, CodeImportModule (+11 more)

### Community 124 - "prisma/migrations/20260717054600_async_test_run_queue_columns/migration.sql"
Cohesion: 0.33
Nodes (6): ArtifactModule, Module, GovernanceModule, Module, TestingModule, Module

### Community 125 - "prisma/migrations/20260717061000_audit_hash_key_rotation/migration.sql"
Cohesion: 0.13
Nodes (14): Auditoría de seguridad — Atlas Decision Engine (backend), Comandos permitidos, Comandos prohibidos, Condiciones para detenerse, Cuándo NO usarla, Cuándo usarla, Entregable, Evidencia requerida (+6 more)

### Community 129 - "artifact.module.ts"
Cohesion: 0.23
Nodes (6): pageResult, paginationArgs(), Get, Query, ApprovalRequestListQueryDto, TestSuiteListQueryDto

### Community 133 - "migration.sql"
Cohesion: 0.50
Nodes (3): "decision_notification", "decision_outbox_event", "decision_processed_event"

### Community 138 - "@types/node"
Cohesion: 0.29
Nodes (4): SeedingModule, Module, SeedingService, Injectable

### Community 139 - "DeploymentResolverService"
Cohesion: 0.18
Nodes (7): FixedWindowResult, MemoryCounter, MemoryEntry, DomainException, EvaluationContext, SecurityFinding, SecuritySeverity

### Community 140 - "DomainExceptionFilter"
Cohesion: 0.15
Nodes (12): Comparación código ↔ grafo, Configuración, Decisión de diseño: contrato declarado, no inferido, Ejecución aislada, Endpoints, Errores por línea, Generación del grafo (`GraphGeneratorService`), Generador Código → Flow (Fase 5) (+4 more)

### Community 141 - ".hmac"
Cohesion: 0.17
Nodes (11): Configuración (`env.schema.ts`, bloque aditivo), Creación manual, por JS y por Python, Ejecución y trazabilidad, Endpoints, Mapeo de variables, Modelo de datos, Pendiente / fuera de alcance de esta rebanada, Pruebas (+3 more)

### Community 142 - ".getMetrics"
Cohesion: 0.20
Nodes (6): ApiExcludeController, MetricsController, Controller, Get, Headers, Res

### Community 144 - "deployment.module.ts"
Cohesion: 0.20
Nodes (9): Backend — resultados de gates (salida real), Cómo se corrieron los gates, E2E (backend, contra Postgres real), Frontend, Frontend — resultados de gates (salida real), Límites y datos externos faltantes, Pruebas nuevas añadidas, Reporte de pruebas — Rebanadas 2-5 (Fases 3, 4, 5, 7, 8, 10) (+1 more)

### Community 146 - "IdentityLoginDto"
Cohesion: 0.33
Nodes (4): APPROVAL_ROLES, BASE_APPLICANT, STATUS_HISTORY, TERMINAL_TEST_CASES

### Community 147 - "main.ts"
Cohesion: 0.22
Nodes (8): RequestContextService, Injectable, isEnabled(), startTracing(), stopTracing(), UNTRACED_PATHS, bootstrap(), requestIdFrom()

### Community 150 - "Body"
Cohesion: 0.40
Nodes (5): 2.1 Artefactos, 2.2 Versiones y editor gráfico, Contrato disponible para el editor, Diseño mínimo del editor F2-08, Fase 2 — Artefactos, versiones y grafo de decisión

### Community 151 - "Controller"
Cohesion: 0.17
Nodes (12): canonicalize(), sha256(), ReasonSeed, VariableSeed, affordability, amlSanctions, collectionsCollateral, creditBureau (+4 more)

### Community 152 - "Get"
Cohesion: 0.25
Nodes (7): Auditoría de la configuración actual de Claude Code, Conflictos y duplicaciones, Contenido a CONSERVAR sin modificar, Inventario previo (antes de organizar), Recomendaciones, Respaldo, Riesgos identificados

### Community 153 - "Headers"
Cohesion: 0.25
Nodes (7): Cargar un grafo, Guía del editor de FlowChart (Fase 3), Importar desde código (Fase 5), Nodos y aristas, Sincronización y guardado, Validar, Variables de entrada y salida

### Community 154 - "Param"
Cohesion: 0.25
Nodes (7): Aprobar / rechazar / solicitar cambios (RBAC real), Clasificación de severidad, Endpoints y roles, Exportar reporte, Pruebas, Qué agrega, Vista de equipo de seguridad (Fase 10)

### Community 155 - "Post"
Cohesion: 0.60
Nodes (4): BootstrapClientSummary, parseList(), seedIntegrationClients(), sha256()

### Community 156 - "Query"
Cohesion: 0.29
Nodes (6): Configuración de Claude Code — Atlas Decision Engine (backend), Estructura, Guía de uso, Plugins, Reglas (`rules/`), Skills (`skills/`)

### Community 157 - "IsArray"
Cohesion: 0.29
Nodes (6): Archivos fuente obligatorios AUSENTES, Comandos reales del proyecto (verificados en `package.json`), Inventario de entorno — Claude Code, Limitaciones y datos no verificables, Stack detectado (por evidencia), Versiones (evidencia real)

### Community 158 - "IsBoolean"
Cohesion: 0.29
Nodes (6): Comandos reales del proyecto (verificados), Cómo trabaja Claude Code aquí, Dónde está cada cosa, Guía de uso — Claude Code en Atlas Decision Engine (backend), Pendiente, Reglas críticas que Claude respeta siempre

### Community 159 - "IsEnum"
Cohesion: 0.29
Nodes (6): ⚠️ Dependencia de la Rebanada 1 — estado de la integración, Diseño, Ejecución en vivo (Fase 8), Endpoint, Pendiente / fuera de alcance de esta rebanada, Pruebas

### Community 160 - "IsIn"
Cohesion: 0.33
Nodes (5): Descartados (no aplican al stack), Estado, Lo que NO se instaló (requiere aprobación humana — punto de parada), Lo que SÍ se aplicó (no destructivo, sin aprobación externa), Reporte de instalación — Claude Code

### Community 161 - "IsInt"
Cohesion: 0.33
Nodes (5): Acciones que requieren aprobación humana (no ejecutadas), Límite importante (por qué esto es recomendación, no instalación), Matriz (candidatos del brief evaluados contra el stack real), Matriz de selección de plugins — Claude Code, Recomendación mínima priorizada

### Community 162 - "IsNotEmpty"
Cohesion: 0.33
Nodes (5): Agentes, Reglas (`.claude/rules/`), Skills (`.claude/skills/`), Skills consideradas y NO creadas (y por qué), Trazabilidad de skills y reglas — Claude Code

### Community 163 - "IsNumber"
Cohesion: 0.50
Nodes (3): Configurable outputs and RESULT nodes, JavaScript and Python, Visual RESULT node

### Community 164 - "IsObject"
Cohesion: 0.50
Nodes (4): 6.1 Ejecuciones y trazas, 6.2 Eventos de auditoría, 6.3 Observabilidad, Fase 6 — Auditoría, investigaciones y observabilidad

### Community 165 - "IsOptional"
Cohesion: 0.50
Nodes (4): F0-01 — Inicio de sesión corporativo, F0-03 — Estado de plataforma, Fase 0 — Acceso, contexto y salud, Resumen de vistas

### Community 166 - "IsString"
Cohesion: 0.83
Nodes (3): RequestContextStore, ApiAudience, AuthMethod

### Community 167 - "Matches"
Cohesion: 0.50
Nodes (3): "decision_artifact_reference", "decision_code_import", "decision_execution_tree_link"

### Community 170 - "Type"
Cohesion: 0.67
Nodes (3): SecurityModule, Global, Module

### Community 173 - "safe-regex.ts"
Cohesion: 0.11
Nodes (13): compile(), compiledCache, isPotentiallyCatastrophic(), SafeRegexResult, safeRegexTest(), EvaluatedTestCase, systemPrincipal(), TestAssertionResult (+5 more)

### Community 174 - "audit.module.ts"
Cohesion: 0.67
Nodes (3): AuditModule, Global, Module

### Community 187 - "LiveExecutionModule"
Cohesion: 0.50
Nodes (3): CacheModule, Global, Module

### Community 479 - "AccessLogInterceptor"
Cohesion: 0.25
Nodes (7): arrowParens, endOfLine, printWidth, semi, singleQuote, tabWidth, trailingComma

## Knowledge Gaps
- **590 isolated node(s):** `singleQuote`, `semi`, `trailingComma`, `printWidth`, `tabWidth` (+585 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **67 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `PrismaService` connect `GovernanceService` to `graph.types.ts`, `artifact.module.ts`, `parseBigIntId`, `NotificationService`, `PrismaService`, `artifact.dto.ts`, `notification.service.ts`, `test-app.ts`, `views.controller.ts`, `@types/node`, `DeploymentResolverService`, `.append`, `main.ts`, `AuthenticatedPrincipal`, `.run`, `.execute`, `StructuredLoggerService`, `identity-session.controller.ts`, `.execute`, `.logout`, `identity-provider.client.ts`, `simulation.service.ts`, `JwtVerifierService`, `manifest.json`, `Min`, `env.schema.ts`, `VariableController`, `safe-regex.ts`, `prisma.module.ts`, `Graph Report - AtlasDecisionEngine  (2026-07-19)`, `Graph Report - AtlasDecisionEngine  (2026-07-19)`, `ObservabilityModule`, `SecurityModule`, `jwt-verifier.service.ts`, `Seguridad`, `Configurable outputs and RESULT nodes`, `Fase 6 — Auditoría, investigaciones y observabilidad`, `source-map-support`, `package.json`, `graph.types.ts`, `.decide`, `manual-review.service.ts`, `prisma/migrations/20260716184106_fix_baseline_drift/migration.sql`?**
  _High betweenness centrality (0.118) - this node is a cross-community bridge._
- **Why does `createTestApp()` connect `parseBigIntId` to `scripts`?**
  _High betweenness centrality (0.054) - this node is a cross-community bridge._
- **Why does `scripts` connect `scripts` to `package.json`?**
  _High betweenness centrality (0.048) - this node is a cross-community bridge._
- **What connects `singleQuote`, `semi`, `trailingComma` to the rest of the system?**
  _590 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `graph.types.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.14285714285714285 - nodes in this community are weakly interconnected._
- **Should `seed.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.02912280701754386 - nodes in this community are weakly interconnected._
- **Should `parseBigIntId` be split into smaller, more focused modules?**
  _Cohesion score 0.09513742071881606 - nodes in this community are weakly interconnected._