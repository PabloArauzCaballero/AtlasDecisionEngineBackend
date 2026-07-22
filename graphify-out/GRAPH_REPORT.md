# Graph Report - AtlasDecisionEngine  (2026-07-21)

## Corpus Check
- 266 files · ~113,145 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1839 nodes · 3908 edges · 164 communities (107 shown, 57 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 38 edges (avg confidence: 0.79)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `3771eb9c`
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
- prisma/migrations/20260712190000_init/migration.sql
- client
- security.types.ts
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
- testing.module.ts
- prisma/migrations/20260716184106_fix_baseline_drift/migration.sql
- prisma/migrations/20260717061000_audit_hash_key_rotation/migration.sql
- prisma/migrations/20260717070000_audit_append_only/migration.sql
- prisma/migrations/20260717120000_node_scripts_and_read_model_views/migration.sql
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
- AccessLogInterceptor
- helpers.ts
- zod
- compression
- ioredis
- @nestjs/common
- @nestjs/config
- @nestjs/core
- @nestjs/swagger
- @nestjs/testing
- @opentelemetry/exporter-trace-otlp-http
- @opentelemetry/instrumentation-express
- @opentelemetry/instrumentation-http
- @opentelemetry/instrumentation-ioredis
- @opentelemetry/instrumentation-pg
- @opentelemetry/resources
- @opentelemetry/sdk-node
- @opentelemetry/semantic-conventions
- pino
- @prisma/adapter-pg
- prom-client
- reflect-metadata
- zod
- prettier

## God Nodes (most connected - your core abstractions)
1. `PrismaService` - 132 edges
2. `TenantId` - 76 edges
3. `Roles()` - 64 edges
4. `HashService` - 46 edges
5. `parseBigIntId()` - 44 edges
6. `CurrentPrincipal` - 38 edges
7. `MetricsService` - 37 edges
8. `AuditService` - 33 edges
9. `scripts` - 29 edges
10. `ExecutionEngineService` - 25 edges

## Surprising Connections (you probably didn't know these)
- `createTestApp()` --indirect_call--> `AppModule`  [INFERRED]
  test/e2e/support/test-app.ts → src/app.module.ts
- `buildDemoSnapshots()` --indirect_call--> `action()`  [INFERRED]
  src/modules/seeding/data/demo-snapshots.ts → test/execution-engine-nodes.spec.ts
- `buildDemoSnapshots()` --indirect_call--> `node()`  [INFERRED]
  src/modules/seeding/data/demo-snapshots.ts → test/execution-engine-nodes.spec.ts
- `createTestApp()` --references--> `test`  [EXTRACTED]
  test/e2e/support/test-app.ts → package.json
- `findCycle()` --indirect_call--> `node()`  [INFERRED]
  src/modules/graph/validators/graph-determinism.validator.ts → test/execution-engine-nodes.spec.ts

## Import Cycles
- None detected.

## Communities (164 total, 57 thin omitted)

### Community 0 - "graph.types.ts"
Cohesion: 0.05
Nodes (37): ExecutionEngineService, MutableExecutionState, Injectable, EvaluationContext, ExpressionEvaluator, Injectable, GraphModule, Module (+29 more)

### Community 1 - "CacheService"
Cohesion: 0.13
Nodes (20): DemoArtifactSummary, seedDemoArtifact(), ActionDefinition, buildDemoGraph(), ConditionDefinition, DemoGraphResult, EdgeDefinition, NodeDefinition (+12 more)

### Community 2 - "seed.ts"
Cohesion: 0.24
Nodes (10): prisma, ensureEnvironment(), ensureReason(), ensureVariable(), BootstrapContext, DEMO_VARIABLE_CODES, fullVariableCatalog, runBootstrapSeeds() (+2 more)

### Community 3 - "parseBigIntId"
Cohesion: 0.15
Nodes (5): LEVEL_WEIGHT, PINO_METHOD, SENSITIVE_KEYS, StructuredLoggerService, Injectable

### Community 4 - "views.controller.ts"
Cohesion: 0.09
Nodes (32): ApiTags, Controller, Get, Query, ViewsController, ArtifactInputContractQueryDto, ArtifactPickerQueryDto, ArtifactVersionPickerQueryDto (+24 more)

### Community 5 - "PrismaService"
Cohesion: 0.19
Nodes (12): @prisma/client, test, @prisma/client, managementHeaders(), runtimeHeaders(), ALL_MANAGEMENT_ROLES, E2E_CLIENTS, E2eClientName (+4 more)

### Community 6 - "artifact.dto.ts"
Cohesion: 0.17
Nodes (30): ArrayMaxSize, ArrayMinSize, ActionDto, ActionReasonDto, ArtifactListQueryDto, CloneVersionDto, ConditionDto, CreateArtifactDto (+22 more)

### Community 7 - "test-app.ts"
Cohesion: 0.09
Nodes (15): ApiExcludeController, MetricsController, Controller, MetricsInterceptor, Injectable, MetricsService, Injectable, ObservabilityModule (+7 more)

### Community 8 - "deployment.controller.ts"
Cohesion: 0.20
Nodes (4): AccessLogInterceptor, Injectable, AccessDenialAuditorService, Injectable

### Community 9 - "devDependencies"
Cohesion: 0.10
Nodes (21): dotenv, jest, @nestjs/cli, @nestjs/schematics, devDependencies, dotenv, jest, @nestjs/cli (+13 more)

### Community 10 - "manual-review.controller.ts"
Cohesion: 0.18
Nodes (10): activity, atlasBackendCatalog, atlasRiskScores, behavior, contactAddress, deviceSessionIp, externalProviders, fraudCompliance (+2 more)

### Community 11 - "audit-query.service.ts"
Cohesion: 0.11
Nodes (18): CurrentPrincipal, NotificationController, ApiTags, Controller, Get, HttpCode, Param, Post (+10 more)

### Community 12 - "RecordApprovalDecisionDto"
Cohesion: 0.19
Nodes (14): ApprovalEvidenceDto, CreateCustomApprovalStepDto, RecordApprovalDecisionDto, SubmitReviewDto, IsArray, IsBoolean, IsIn, IsInt (+6 more)

### Community 13 - ".append"
Cohesion: 0.19
Nodes (10): FixedWindowResult, MemoryCounter, MemoryEntry, RequestContextStore, DomainException, ApiAudience, AuthMethod, Express (+2 more)

### Community 14 - "compilerOptions"
Cohesion: 0.07
Nodes (26): prisma/**/*.ts, src/**/*.ts, test/**/*.ts, compilerOptions, allowSyntheticDefaultImports, declaration, emitDecoratorMetadata, esModuleInterop (+18 more)

### Community 15 - "variable-resolution.service.ts"
Cohesion: 0.06
Nodes (29): IsEmail, IdentityProviderClient, Injectable, IdentitySessionController, ApiTags, Body, Controller, Headers (+21 more)

### Community 16 - "traceability.service.ts"
Cohesion: 0.15
Nodes (12): parseBigIntId(), ManualReviewController, ApiTags, Body, Controller, Get, Param, Post (+4 more)

### Community 17 - "scripts"
Cohesion: 0.07
Nodes (28): scripts, build, check, db:reset, format, format:check, graph:update, migration:validate (+20 more)

### Community 18 - "variable.service.ts"
Cohesion: 0.07
Nodes (43): decodeCursor(), encodeCursor(), keysetArgs(), keysetPage, KeysetPaginationQueryDto, PaginationQueryDto, IsInt, IsOptional (+35 more)

### Community 19 - "AuthenticatedPrincipal"
Cohesion: 0.26
Nodes (9): TenantId, TraceabilityController, ApiTags, Body, Controller, Get, Param, Post (+1 more)

### Community 20 - "app.module.ts"
Cohesion: 0.22
Nodes (8): DeploymentController, ApiTags, Body, Controller, Get, Param, Post, Query

### Community 21 - "DomainException"
Cohesion: 0.10
Nodes (46): "decision_access_audit", "decision_action_reason_mapping", "decision_approval_decision", "decision_approval_evidence", "decision_approval_request", "decision_approval_step", "decision_artifact", "decision_artifact_variable_dependency" (+38 more)

### Community 22 - ".execute"
Cohesion: 0.13
Nodes (24): CreateReasonCodeDto, CreateVariableDefinitionDto, CreateVariableVersionDto, ReasonCodeListQueryDto, IsArray, IsBoolean, IsInt, IsNotEmpty (+16 more)

### Community 23 - "runtime.service.ts"
Cohesion: 0.22
Nodes (9): "decision_node_script", "vw_artifact_input_contract", "vw_artifact_picker", "vw_artifact_version_picker", "vw_global_search", "vw_node_script", "vw_test_run_picker", "vw_test_suite_picker" (+1 more)

### Community 24 - "HashService"
Cohesion: 0.23
Nodes (5): AppendAuditEventInput, AuditService, Injectable, allowedTransitions, uniqueTenantId()

### Community 25 - "dependencies"
Cohesion: 0.29
Nodes (7): class-transformer, helmet, dependencies, class-transformer, helmet, pg, pg

### Community 26 - "deployment.service.ts"
Cohesion: 0.11
Nodes (18): Audience(), RuntimeController, ApiTags, Body, Controller, Param, Post, Res (+10 more)

### Community 27 - "MetricsService"
Cohesion: 0.18
Nodes (10): affordability, aml, compliance, creditRisk, eligibility, fraud, kyc, operational (+2 more)

### Community 28 - "security.types.ts"
Cohesion: 0.12
Nodes (5): canonicalize(), JsonPrimitive, JsonValue, normalize(), Money

### Community 29 - "StructuredLoggerService"
Cohesion: 0.21
Nodes (10): AuthenticatedPrincipal, TestingController, ApiTags, Body, Controller, Get, HttpCode, Param (+2 more)

### Community 30 - "identity-session.controller.ts"
Cohesion: 0.10
Nodes (8): pageResult, paginationArgs(), PrismaService, Injectable, ApprovalRequestListQueryDto, ManualReviewService, Injectable, TestSuiteListQueryDto

### Community 32 - "CreateTestSuiteDto"
Cohesion: 0.23
Nodes (15): CreateTestSuiteDto, ImportTestCasesDto, RunTestSuiteDto, TestCaseDto, ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean (+7 more)

### Community 33 - ".execute"
Cohesion: 0.10
Nodes (18): ArtifactGraphSnapshot, CompiledDecisionArtifact, DecisionReasonResult, ExecutionTraceStep, GraphActionSnapshot, GraphConditionSnapshot, GraphEdgeSnapshot, GraphNodeSnapshot (+10 more)

### Community 34 - "IdentityProviderClient"
Cohesion: 0.20
Nodes (9): affordabilityScoring, amlComplianceScoring, collectionsScoring, creditRiskScoring, decisionScoring, eligibilityScoring, fraudScoring, identityScoring (+1 more)

### Community 35 - ".logout"
Cohesion: 0.11
Nodes (15): SimulationController, ApiTags, Body, Controller, Param, Post, SimulateDecisionDto, IsNotEmpty (+7 more)

### Community 36 - "VISTAS_POR_FASES.md"
Cohesion: 0.06
Nodes (34): 10. Matriz resumida de permisos, 11. Reglas UX obligatorias para producción, 12. Definition of Done del frontend por vista, 13. Brechas de API antes de completar todas las vistas, 1.1 Variables, 1.2 Códigos de razón, 1. Convenciones, 2.1 Artefactos (+26 more)

### Community 37 - "identity-provider.client.ts"
Cohesion: 0.23
Nodes (8): Public(), SkipRateLimit(), HealthController, ApiTags, Controller, Get, HealthModule, Module

### Community 41 - "manifest.json"
Cohesion: 0.36
Nodes (4): DispatchedEventHandler, DispatchedEvent, EventEnvelope, ClaimedRow

### Community 42 - "exclude"
Cohesion: 0.22
Nodes (8): dist, node_modules, prisma/seed.ts, **/*.spec.ts, test, ./tsconfig.json, exclude, extends

### Community 44 - "VariableController"
Cohesion: 0.19
Nodes (10): ReasonSeed, VariableSeed, affordability, amlSanctions, collectionsCollateral, creditBureau, fraudDeviceBehavior, geographyRegulatory (+2 more)

### Community 46 - "server.mjs"
Cohesion: 0.22
Nodes (4): JS_WRAPPER, PYTHON_WRAPPER, server, socketDir

### Community 47 - "generate-baseline-sql.py"
Cohesion: 0.31
Nodes (8): db_object_name(), default_sql(), Field, Model, q(), Keep PostgreSQL identifiers at <=63 bytes with a deterministic suffix., Relation, sql_type()

### Community 48 - "TenantId"
Cohesion: 0.24
Nodes (7): ResolvedDeployment, EngineExecutionResult, ExecutionWriterService, Injectable, WriteExecutionInput, ResolvedVariableSnapshot, VariableResolutionResult

### Community 50 - "Graph Report - AtlasDecisionEngine  (2026-07-18)"
Cohesion: 0.22
Nodes (7): Jwk, JwksDocument, JwtClaims, JwtHeader, VerifiedJwtPrincipal, encode(), token()

### Community 51 - "SessionCookieService"
Cohesion: 0.22
Nodes (8): identityPinChallengeSchema, IdentityProfile, identityProfileSchema, identityProviderSessionSchema, IdentitySession, identitySessionSchema, PublicIdentitySession, userSchema

### Community 52 - "nest-cli.json"
Cohesion: 0.29
Nodes (6): collection, compilerOptions, deleteOutDir, plugins, $schema, sourceRoot

### Community 53 - "Graph Report - AtlasDecisionEngine  (2026-07-19)"
Cohesion: 0.24
Nodes (8): GovernanceController, ApiTags, Body, Controller, Get, Param, Post, Query

### Community 54 - "safe-regex.ts"
Cohesion: 0.20
Nodes (12): Put, parseIfMatch(), Roles(), ArtifactController, ApiTags, Body, Controller, Get (+4 more)

### Community 55 - "package.json"
Cohesion: 0.33
Nodes (5): description, license, name, private, version

### Community 56 - "smoke.sh"
Cohesion: 0.33
Nodes (5): BASE_URL, MANAGEMENT_API_KEY, RUNTIME_API_KEY, smoke.sh script, TENANT_ID

### Community 58 - "governance.service.ts"
Cohesion: 0.70
Nodes (4): "integration_client", "integration_credential", "integration_scope", "integration_tenant_access"

### Community 61 - "CryptoModule"
Cohesion: 0.12
Nodes (7): Get, Headers, Res, CompilerService, Injectable, IdempotencyService, Injectable

### Community 62 - "ObservabilityModule"
Cohesion: 0.14
Nodes (16): CreateBusinessObjectiveDto, LinkPolicyArtifactDto, LinkPolicyTestSuiteDto, ObjectiveListQueryDto, PolicyRequirementDto, IsArray, IsNotEmpty, IsObject (+8 more)

### Community 63 - "env.schema.ts"
Cohesion: 0.22
Nodes (8): AppEnv, booleanFromString, envSchema, optionalSecret, optionalUrl, validateEnvironment(), base, jwtProduction

### Community 64 - "SecurityModule"
Cohesion: 0.15
Nodes (5): RequestContextService, Injectable, IdentityProviderVerifierService, Injectable, ResolvedIntegrationClient

### Community 65 - "ATLAS Decision Engine Backend 2.0"
Cohesion: 0.11
Nodes (17): Contenedores, Desarrollo local, Despliegue, Producción, ATLAS Decision Engine Backend 2.0, Autenticación, Capacidades, Clientes de integración (+9 more)

### Community 67 - "README.md"
Cohesion: 0.50
Nodes (3): Configurable outputs and RESULT nodes, JavaScript and Python, Visual RESULT node

### Community 68 - "Arquitectura técnica"
Cohesion: 0.17
Nodes (11): 10. Escalamiento, 1. Separación Control Plane / Data Plane, 2. Núcleo determinista, 3. Persistencia, 4. Inmutabilidad y estados, 5. Gobierno, 6. Seguridad, 7. Auditoría (+3 more)

### Community 69 - "ATLAS Decision Engine Backend 2.0 — Entrega final de fase"
Cohesion: 0.18
Nodes (10): Alcance entregado, ATLAS Decision Engine Backend 2.0 — Entrega final de fase, Cambios de datos, Contratos operativos definitivos, Declaración de entrega, Documentación oficial, Estado final, Evidencia de verificación (+2 more)

### Community 70 - "Ejemplos API"
Cohesion: 0.22
Nodes (8): Autenticación con bearer token, Autenticación de gestión con API key, Consultar eventos por fecha, Consultar evidencia, Ejecutar una decisión, Ejemplos API, Forzar revisión manual por fraude, Listar artefactos

### Community 71 - "Auditoría de seguridad y calidad — 2026-07-12"
Cohesion: 0.22
Nodes (8): Auditoría de seguridad y calidad — 2026-07-12, Hallazgos revisados sin acción (falsos positivos / severidad no justificada), P0 — El checksum del grafo nunca coincide entre `validate` y `compile`, P0 — `prisma migrate deploy` / `prisma db seed` fallan siempre (motor wasm), P1 — DTOs del grafo sin cota superior de tamaño, P1 — Sin rate limiting en intentos de autenticación fallidos, P2 — God classes (>300 líneas, responsabilidades mezcladas), P2 — Lógica de plantillas `{{path}}` duplicada

### Community 72 - "jwt-verifier.service.ts"
Cohesion: 0.60
Nodes (4): BootstrapClientSummary, parseList(), seedIntegrationClients(), sha256()

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
Cohesion: 0.36
Nodes (8): AppModule, Module, isEnabled(), startTracing(), stopTracing(), UNTRACED_PATHS, bootstrap(), requestIdFrom()

### Community 88 - "Seguridad"
Cohesion: 0.11
Nodes (7): CryptoModule, Global, Module, HashService, Injectable, IntegrationClientService, Injectable

### Community 92 - "Configurable outputs and RESULT nodes"
Cohesion: 0.23
Nodes (5): field(), NotificationProjectorService, stringArray(), Injectable, CreateNotificationInput

### Community 94 - "Fase 6 — Auditoría, investigaciones y observabilidad"
Cohesion: 0.32
Nodes (7): assertEqual(), call(), decisionVariables, main(), managementHeaders, results, runtimeHeaders

### Community 95 - "Resumen de vistas"
Cohesion: 0.52
Nodes (5): compile(), compiledCache, isPotentiallyCatastrophic(), SafeRegexResult, safeRegexTest()

### Community 97 - ".claude/settings.local.json"
Cohesion: 0.20
Nodes (9): Aislamiento por tenant (RLS), Arquitectura event-driven (Outbox transaccional + Bus de eventos), Componentes, Configuración, Contratos de evento versionados, El relay (entrega at-least-once), Observabilidad, Por qué un outbox transaccional (+1 more)

### Community 100 - "@nestjs/schematics"
Cohesion: 0.50
Nodes (3): Reglas operativas mínimas, Reporte responsable, Seguridad

### Community 101 - "@nestjs/testing"
Cohesion: 0.22
Nodes (3): EventBus, Injectable, RelayInternals

### Community 102 - "prisma"
Cohesion: 0.24
Nodes (4): DecisionEventType, VersionPublishedPayload, VersionReviewOutcomePayload, VersionSubmittedForReviewPayload

### Community 104 - "ts-jest"
Cohesion: 0.12
Nodes (6): TestExecutionService, Injectable, TestSuiteService, Injectable, TestingModule, Module

### Community 106 - "graph.types.ts"
Cohesion: 0.67
Nodes (3): AuditModule, Global, Module

### Community 108 - "prisma/migrations/20260712190000_init/migration.sql"
Cohesion: 0.50
Nodes (3): PrismaModule, Global, Module

### Community 111 - ".deploy"
Cohesion: 0.14
Nodes (8): ArtifactGraphReaderService, Injectable, ArtifactGraphWriterService, Injectable, ArtifactLifecycleService, Injectable, Injectable, VersionStateService

### Community 113 - ".decide"
Cohesion: 0.25
Nodes (5): RateLimitGuard, Injectable, SecurityModule, Global, Module

### Community 114 - "identity-integration.spec.ts"
Cohesion: 0.23
Nodes (9): LoginInput, VerifiedIdentityPrincipal, DIRECT_ROLES, mapIdentityRoles(), ROLE_ALIASES, isPlatformRole(), PLATFORM_ROLES, PlatformRole (+1 more)

### Community 115 - "manual-review.service.ts"
Cohesion: 0.29
Nodes (4): SeedingModule, Module, SeedingService, Injectable

### Community 118 - "prisma/migrations/20260716042805_add_integration_client_registry/migration.sql"
Cohesion: 0.22
Nodes (8): Aplicación, Base de datos (Prisma), Calidad y verificación, Comandos de desarrollo (yarn), Equivalencias npm → yarn (referencia), Instalación, Otros, Pruebas

### Community 120 - "DeploymentController"
Cohesion: 0.13
Nodes (19): DeploymentListQueryDto, DeployVersionDto, RollbackDeploymentDto, SuspendDeploymentDto, TrafficRuleDto, IsArray, IsDateString, IsEnum (+11 more)

### Community 121 - "prisma/migrations/20260716183141_audit_access_denials/migration.sql"
Cohesion: 0.22
Nodes (8): API (`/v1/notifications`), Bandeja de notificaciones, Destinatarios por rol, no por usuario, Frontend, Fuera de alcance (v2 / fases posteriores), Idempotencia (exactly-once sobre at-least-once), Principio de diseño: generar desde eventos, Reglas de proyección (v1)

### Community 122 - "testing.module.ts"
Cohesion: 0.50
Nodes (3): CacheModule, Global, Module

### Community 123 - "prisma/migrations/20260716184106_fix_baseline_drift/migration.sql"
Cohesion: 0.23
Nodes (10): EventsModule, Module, GovernanceModule, Module, NotificationsModule, Module, OutboxRelayModule, Module (+2 more)

### Community 129 - "artifact.module.ts"
Cohesion: 0.27
Nodes (6): ArtifactModule, Module, DeploymentModule, Module, DeploymentResolverService, Injectable

### Community 130 - "GovernanceService"
Cohesion: 0.13
Nodes (7): OutboxPublisherService, Injectable, DeploymentService, Injectable, GovernanceService, Injectable, config

### Community 133 - "migration.sql"
Cohesion: 0.50
Nodes (3): "decision_notification", "decision_outbox_event", "decision_processed_event"

### Community 479 - "AccessLogInterceptor"
Cohesion: 0.25
Nodes (7): arrowParens, endOfLine, printWidth, semi, singleQuote, tabWidth, trailingComma

## Knowledge Gaps
- **393 isolated node(s):** `singleQuote`, `semi`, `trailingComma`, `printWidth`, `tabWidth` (+388 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **57 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `PrismaService` connect `identity-session.controller.ts` to `artifact.module.ts`, `GovernanceService`, `NotificationService`, `seed.ts`, `views.controller.ts`, `PrismaService`, `test-app.ts`, `deployment.controller.ts`, `.append`, `variable.service.ts`, `.execute`, `HashService`, `deployment.service.ts`, `StructuredLoggerService`, `ArtifactService`, `identity-provider.client.ts`, `simulation.service.ts`, `AuthenticationGuard`, `manifest.json`, `env.schema.ts`, `TenantId`, `CryptoModule`, `ObservabilityModule`, `Seguridad`, `Configurable outputs and RESULT nodes`, `docs/plantuml/compile_all.ps1`, `@nestjs/testing`, `prisma`, `source-map-support`, `ts-jest`, `prisma/migrations/20260712190000_init/migration.sql`, `.deploy`, `manual-review.service.ts`?**
  _High betweenness centrality (0.162) - this node is a cross-community bridge._
- **Why does `createTestApp()` connect `PrismaService` to `Despliegue`?**
  _High betweenness centrality (0.083) - this node is a cross-community bridge._
- **Why does `scripts` connect `scripts` to `PrismaService`, `package.json`?**
  _High betweenness centrality (0.073) - this node is a cross-community bridge._
- **What connects `singleQuote`, `semi`, `trailingComma` to the rest of the system?**
  _393 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `graph.types.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.05078855920876771 - nodes in this community are weakly interconnected._
- **Should `CacheService` be split into smaller, more focused modules?**
  _Cohesion score 0.13405797101449277 - nodes in this community are weakly interconnected._
- **Should `views.controller.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.08874912648497554 - nodes in this community are weakly interconnected._