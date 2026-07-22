# Graph Report - AtlasDecisionEngine  (2026-07-18)

## Corpus Check
- 215 files · ~85,537 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1566 nodes · 3734 edges · 105 communities (80 shown, 25 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 39 edges (avg confidence: 0.79)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `75497eb7`
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
- IdentityLoginDto
- exclude
- env.schema.ts
- jwt-verifier.service.ts
- TestExecutionService
- server.mjs
- generate-baseline-sql.py
- TenantId
- security.module.ts
- IdentitySessionService
- SessionCookieService
- nest-cli.json
- identity-provider-verifier.service.ts
- safe-regex.ts
- package.json
- smoke.sh
- .run
- governance.service.ts
- cache.module.ts
- AuditModule
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
- deployment.module.ts
- .error
- IdentitySessionService
- SessionCookieService
- @nestjs/schematics
- DomainExceptionFilter
- cache.module.ts
- AuditModule
- CryptoModule
- PrismaModule
- SecurityModule
- views.module.ts
- migration.sql

## God Nodes (most connected - your core abstractions)
1. `PrismaService` - 111 edges
2. `AuthenticatedPrincipal` - 72 edges
3. `TenantId` - 70 edges
4. `Roles()` - 62 edges
5. `DomainException` - 46 edges
6. `parseBigIntId()` - 42 edges
7. `HashService` - 40 edges
8. `CurrentPrincipal` - 33 edges
9. `AuditService` - 30 edges
10. `CacheService` - 26 edges

## Surprising Connections (you probably didn't know these)
- `createTestApp()` --references--> `test`  [EXTRACTED]
  test/e2e/support/test-app.ts → package.json
- `provisionE2eClients()` --references--> `@prisma/client`  [EXTRACTED]
  test/e2e/support/integration-clients.ts → package.json
- `buildDemoGraph()` --indirect_call--> `edge()`  [INFERRED]
  prisma/seed/demo-graph.ts → test/execution-engine-nodes.spec.ts
- `buildDemoSnapshots()` --indirect_call--> `action()`  [INFERRED]
  prisma/seed/demo-snapshots.ts → test/execution-engine-nodes.spec.ts
- `buildDemoSnapshots()` --indirect_call--> `node()`  [INFERRED]
  prisma/seed/demo-snapshots.ts → test/execution-engine-nodes.spec.ts

## Import Cycles
- None detected.

## Communities (105 total, 25 thin omitted)

### Community 0 - "graph.types.ts"
Cohesion: 0.05
Nodes (52): buildDemoSnapshots(), ExecutionEngineService, MutableExecutionState, Injectable, ExpressionEvaluator, Injectable, ArtifactGraphSnapshot, CompiledDecisionArtifact (+44 more)

### Community 1 - "CacheService"
Cohesion: 0.10
Nodes (19): assertEqual(), call(), decisionVariables, main(), managementHeaders, results, runtimeHeaders, CacheService (+11 more)

### Community 2 - "seed.ts"
Cohesion: 0.06
Nodes (48): DemoArtifactSummary, seedDemoArtifact(), ActionDefinition, buildDemoGraph(), ConditionDefinition, DemoGraphResult, EdgeDefinition, NodeDefinition (+40 more)

### Community 3 - "parseBigIntId"
Cohesion: 0.17
Nodes (16): Put, parseBigIntId(), Roles(), TenantId, ArtifactController, ApiTags, Body, Controller (+8 more)

### Community 4 - "views.controller.ts"
Cohesion: 0.09
Nodes (32): ApiTags, Controller, Get, Query, ViewsController, ArtifactInputContractQueryDto, ArtifactPickerQueryDto, ArtifactVersionPickerQueryDto (+24 more)

### Community 5 - "PrismaService"
Cohesion: 0.15
Nodes (6): AuditService, Injectable, PrismaService, Injectable, Injectable, VersionStateService

### Community 6 - "artifact.dto.ts"
Cohesion: 0.17
Nodes (30): ActionDto, ActionReasonDto, ArtifactListQueryDto, CloneVersionDto, ConditionDto, CreateArtifactDto, DependencyDto, EdgeConditionBindingDto (+22 more)

### Community 7 - "test-app.ts"
Cohesion: 0.06
Nodes (24): Catch, AppModule, Module, RequestContextService, Injectable, DomainExceptionFilter, LEVEL_WEIGHT, PINO_METHOD (+16 more)

### Community 8 - "deployment.controller.ts"
Cohesion: 0.15
Nodes (15): DeploymentListQueryDto, DeployVersionDto, RollbackDeploymentDto, SuspendDeploymentDto, IsArray, IsDateString, IsEnum, IsIn (+7 more)

### Community 9 - "devDependencies"
Cohesion: 0.12
Nodes (17): jest, @nestjs/cli, devDependencies, jest, @nestjs/cli, source-map-support, ts-jest, ts-node (+9 more)

### Community 10 - "manual-review.controller.ts"
Cohesion: 0.22
Nodes (8): ManualReviewController, ApiTags, Body, Controller, Get, Param, Post, Query

### Community 11 - "audit-query.service.ts"
Cohesion: 0.11
Nodes (17): Audience(), CurrentPrincipal, GovernanceController, ApiTags, Body, Controller, Get, Param (+9 more)

### Community 12 - "RecordApprovalDecisionDto"
Cohesion: 0.19
Nodes (15): ApprovalEvidenceDto, ApprovalRequestListQueryDto, CreateCustomApprovalStepDto, RecordApprovalDecisionDto, SubmitReviewDto, IsArray, IsBoolean, IsIn (+7 more)

### Community 13 - ".append"
Cohesion: 0.21
Nodes (8): ApiTags, Body, Controller, Get, Param, Post, Query, VariableController

### Community 14 - "compilerOptions"
Cohesion: 0.07
Nodes (26): prisma/**/*.ts, src/**/*.ts, test/**/*.ts, compilerOptions, allowSyntheticDefaultImports, declaration, emitDecoratorMetadata, esModuleInterop (+18 more)

### Community 15 - "variable-resolution.service.ts"
Cohesion: 0.29
Nodes (4): VariableContractSnapshot, Injectable, VariableResolutionService, contract()

### Community 16 - "traceability.service.ts"
Cohesion: 0.21
Nodes (5): pageResult, paginationArgs(), GovernanceService, Injectable, config

### Community 17 - "scripts"
Cohesion: 0.09
Nodes (23): scripts, build, db:reset, migration:validate, prisma:generate, prisma:migrate, prisma:migrate:dev, prisma:seed (+15 more)

### Community 18 - "variable.service.ts"
Cohesion: 0.14
Nodes (22): CreateReasonCodeDto, CreateVariableDefinitionDto, CreateVariableVersionDto, ReasonCodeListQueryDto, IsArray, IsBoolean, IsInt, IsNotEmpty (+14 more)

### Community 19 - "AuthenticatedPrincipal"
Cohesion: 0.22
Nodes (6): ApiExcludeController, MetricsController, Controller, Get, Headers, Res

### Community 20 - "app.module.ts"
Cohesion: 0.18
Nodes (7): RequestContextStore, RolesGuard, Injectable, ApiAudience, AuthMethod, Express, Request

### Community 21 - "DomainException"
Cohesion: 0.10
Nodes (46): "decision_access_audit", "decision_action_reason_mapping", "decision_approval_decision", "decision_approval_evidence", "decision_approval_request", "decision_approval_step", "decision_artifact", "decision_artifact_variable_dependency" (+38 more)

### Community 22 - ".execute"
Cohesion: 0.23
Nodes (6): AppendAuditEventInput, ArtifactGraphReaderService, Injectable, ArtifactGraphWriterService, Injectable, allowedTransitions

### Community 23 - "runtime.service.ts"
Cohesion: 0.22
Nodes (9): "decision_node_script", "vw_artifact_input_contract", "vw_artifact_picker", "vw_artifact_version_picker", "vw_global_search", "vw_node_script", "vw_test_run_picker", "vw_test_suite_picker" (+1 more)

### Community 24 - "HashService"
Cohesion: 0.17
Nodes (4): HashService, Injectable, CompilerService, Injectable

### Community 25 - "dependencies"
Cohesion: 0.06
Nodes (35): class-transformer, class-validator, compression, helmet, ioredis, @nestjs/common, @nestjs/config, @nestjs/core (+27 more)

### Community 26 - "deployment.service.ts"
Cohesion: 0.13
Nodes (5): canonicalize(), JsonPrimitive, JsonValue, normalize(), Money

### Community 27 - "MetricsService"
Cohesion: 0.38
Nodes (6): ResolvedDeployment, EngineExecutionResult, WriteExecutionInput, RuntimeHttpResult, ResolvedVariableSnapshot, VariableResolutionResult

### Community 28 - "security.types.ts"
Cohesion: 0.12
Nodes (16): AuditQueryController, ApiTags, Controller, Get, Param, Query, AuditEventSearchQueryDto, ExecutionSearchQueryDto (+8 more)

### Community 29 - "StructuredLoggerService"
Cohesion: 0.18
Nodes (3): AccessAuditInterceptor, Injectable, IdempotencyReservation

### Community 30 - "identity-session.controller.ts"
Cohesion: 0.20
Nodes (6): IdentitySessionModule, Module, SessionOriginService, Injectable, SessionRateLimitGuard, Injectable

### Community 31 - "ArtifactService"
Cohesion: 0.06
Nodes (41): AuditModule, Global, Module, CacheModule, Global, Module, AppEnv, booleanFromString (+33 more)

### Community 32 - "CreateTestSuiteDto"
Cohesion: 0.08
Nodes (22): TestExecutionService, Injectable, TestRunWorkerService, Injectable, TestSuiteService, Injectable, CreateTestSuiteDto, ImportTestCasesDto (+14 more)

### Community 34 - "IdentityProviderClient"
Cohesion: 0.21
Nodes (3): IdentityProviderClient, Injectable, IdentitySession

### Community 35 - ".logout"
Cohesion: 0.11
Nodes (17): DeploymentResolverService, Injectable, SimulationController, ApiTags, Body, Controller, Param, Post (+9 more)

### Community 36 - "VISTAS_POR_FASES.md"
Cohesion: 0.06
Nodes (34): 10. Matriz resumida de permisos, 11. Reglas UX obligatorias para producción, 12. Definition of Done del frontend por vista, 13. Brechas de API antes de completar todas las vistas, 1.1 Variables, 1.2 Códigos de razón, 1. Convenciones, 2.1 Artefactos (+26 more)

### Community 38 - "simulation.service.ts"
Cohesion: 0.23
Nodes (4): IdempotencyService, Injectable, RuntimeService, Injectable

### Community 41 - "IdentityLoginDto"
Cohesion: 0.13
Nodes (10): AccessLogInterceptor, Injectable, MetricsInterceptor, Injectable, MetricsService, RequestMetric, Injectable, ObservabilityModule (+2 more)

### Community 42 - "exclude"
Cohesion: 0.20
Nodes (9): prisma/seed/**, prisma/seed.ts, **/*.spec.ts, test, ./tsconfig.json, exclude, extends, dist (+1 more)

### Community 43 - "env.schema.ts"
Cohesion: 0.26
Nodes (9): IdentitySessionController, ApiTags, Body, Controller, Headers, HttpCode, Post, Res (+1 more)

### Community 44 - "jwt-verifier.service.ts"
Cohesion: 0.25
Nodes (7): ExecuteDecisionDto, IsNotEmpty, IsObject, IsOptional, IsString, Matches, MaxLength

### Community 46 - "server.mjs"
Cohesion: 0.22
Nodes (4): JS_WRAPPER, PYTHON_WRAPPER, server, socketDir

### Community 47 - "generate-baseline-sql.py"
Cohesion: 0.31
Nodes (8): db_object_name(), default_sql(), Field, Model, q(), Keep PostgreSQL identifiers at <=63 bytes with a deterministic suffix., Relation, sql_type()

### Community 49 - "security.module.ts"
Cohesion: 0.52
Nodes (5): compile(), compiledCache, isPotentiallyCatastrophic(), SafeRegexResult, safeRegexTest()

### Community 50 - "IdentitySessionService"
Cohesion: 0.19
Nodes (7): FixedWindowResult, MemoryCounter, MemoryEntry, DomainException, parseIfMatch(), EvaluationContext, identityUser

### Community 51 - "SessionCookieService"
Cohesion: 0.20
Nodes (8): DeploymentController, ApiTags, Body, Controller, Get, Param, Post, Query

### Community 52 - "nest-cli.json"
Cohesion: 0.29
Nodes (6): collection, compilerOptions, deleteOutDir, plugins, $schema, sourceRoot

### Community 53 - "identity-provider-verifier.service.ts"
Cohesion: 0.23
Nodes (6): IdentityProviderVerifierService, Injectable, VerifiedIdentityPrincipal, IntegrationClientService, ResolvedIntegrationClient, Injectable

### Community 54 - "safe-regex.ts"
Cohesion: 0.26
Nodes (9): LoginInput, identityPinChallengeSchema, IdentityProfile, identityProfileSchema, identityProviderSessionSchema, identitySessionSchema, PublicIdentitySession, userSchema (+1 more)

### Community 55 - "package.json"
Cohesion: 0.33
Nodes (5): description, license, name, private, version

### Community 56 - "smoke.sh"
Cohesion: 0.33
Nodes (5): BASE_URL, MANAGEMENT_API_KEY, RUNTIME_API_KEY, smoke.sh script, TENANT_ID

### Community 57 - ".run"
Cohesion: 0.23
Nodes (8): AuthenticatedPrincipal, TestingController, ApiTags, Body, Controller, HttpCode, Param, Post

### Community 58 - "governance.service.ts"
Cohesion: 0.70
Nodes (4): "integration_client", "integration_credential", "integration_scope", "integration_tenant_access"

### Community 59 - "cache.module.ts"
Cohesion: 0.33
Nodes (6): PaginationQueryDto, IsInt, IsOptional, Max, Min, Type

### Community 60 - "AuditModule"
Cohesion: 0.21
Nodes (11): AssignManualReviewDto, ManualReviewListQueryDto, ResolveManualReviewDto, IsEnum, IsIn, IsObject, IsOptional, IsString (+3 more)

### Community 61 - "CryptoModule"
Cohesion: 0.20
Nodes (9): IsEmail, IdentityLoginDto, IdentityLogoutDto, IsBoolean, IsOptional, IsString, Matches, MaxLength (+1 more)

### Community 62 - "ObservabilityModule"
Cohesion: 0.11
Nodes (22): TraceabilityController, ApiTags, Body, Controller, Get, Param, Post, Query (+14 more)

### Community 63 - "env.schema.ts"
Cohesion: 0.33
Nodes (6): TrafficRuleDto, IsInt, IsNumber, IsObject, Max, Min

### Community 64 - "SecurityModule"
Cohesion: 0.35
Nodes (6): DIRECT_ROLES, mapIdentityRoles(), ROLE_ALIASES, isPlatformRole(), PLATFORM_ROLES, PlatformRole

### Community 65 - "ATLAS Decision Engine Backend 2.0"
Cohesion: 0.15
Nodes (13): ATLAS Decision Engine Backend 2.0, Autenticación, Capacidades, Clientes de integración, Documentación vigente, Estado, Identidades firmadas, Inicio local (+5 more)

### Community 67 - "README.md"
Cohesion: 0.18
Nodes (5): Configurable outputs and RESULT nodes, JavaScript and Python, Visual RESULT node, Criterio de “pendiente”, Matriz de implementación frente a los 22 diagramas

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

### Community 72 - "jwt-verifier.service.ts"
Cohesion: 0.22
Nodes (7): Jwk, JwksDocument, JwtClaims, JwtHeader, VerifiedJwtPrincipal, encode(), token()

### Community 73 - "Runbook operativo"
Cohesion: 0.25
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
Cohesion: 0.40
Nodes (4): Contenedores, Desarrollo local, Despliegue, Producción

### Community 88 - "Seguridad"
Cohesion: 0.50
Nodes (3): Reglas operativas mínimas, Reporte responsable, Seguridad

## Knowledge Gaps
- **297 isolated node(s):** `compile_all.sh script`, `$schema`, `collection`, `sourceRoot`, `deleteOutDir` (+292 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **25 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `PrismaService` connect `PrismaService` to `CacheService`, `views.controller.ts`, `test-app.ts`, `deployment.controller.ts`, `RecordApprovalDecisionDto`, `traceability.service.ts`, `variable.service.ts`, `.execute`, `HashService`, `MetricsService`, `security.types.ts`, `StructuredLoggerService`, `ArtifactService`, `CreateTestSuiteDto`, `.execute`, `identity-provider.client.ts`, `simulation.service.ts`, `TestExecutionService`, `TenantId`, `identity-provider-verifier.service.ts`, `.run`, `AuditModule`, `ObservabilityModule`?**
  _High betweenness centrality (0.124) - this node is a cross-community bridge._
- **Why does `createTestApp()` connect `test-app.ts` to `scripts`?**
  _High betweenness centrality (0.055) - this node is a cross-community bridge._
- **Why does `DomainException` connect `IdentitySessionService` to `graph.types.ts`, `CacheService`, `test-app.ts`, `deployment.controller.ts`, `RecordApprovalDecisionDto`, `variable.service.ts`, `.execute`, `MetricsService`, `security.types.ts`, `StructuredLoggerService`, `identity-session.controller.ts`, `CreateTestSuiteDto`, `IdentityProviderClient`, `.logout`, `identity-provider-verifier.service.ts`, `safe-regex.ts`, `AuditModule`, `ObservabilityModule`, `SecurityModule`, `jwt-verifier.service.ts`, `IdentitySessionService`?**
  _High betweenness centrality (0.051) - this node is a cross-community bridge._
- **What connects `compile_all.sh script`, `$schema`, `collection` to the rest of the system?**
  _297 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `graph.types.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.05115758028379388 - nodes in this community are weakly interconnected._
- **Should `CacheService` be split into smaller, more focused modules?**
  _Cohesion score 0.09615384615384616 - nodes in this community are weakly interconnected._
- **Should `seed.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.055051421657592255 - nodes in this community are weakly interconnected._