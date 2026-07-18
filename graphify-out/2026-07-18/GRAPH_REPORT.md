# Graph Report - AtlasDecisionEngine  (2026-07-18)

## Corpus Check
- 200 files · ~76,873 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1427 nodes · 3442 edges · 99 communities (80 shown, 19 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 25 edges (avg confidence: 0.79)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `0f4137da`
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
- PrismaModule
- SecurityModule
- ATLAS Decision Engine Backend 2.0
- compile_all.sh script
- README.md
- Arquitectura técnica
- ATLAS Decision Engine Backend 2.0 — Entrega final de fase
- Ejemplos API
- Auditoría de seguridad y calidad — 2026-07-12
- .decide
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
- @nestjs/cli
- @nestjs/schematics
- @nestjs/testing
- prisma
- source-map-support
- ts-jest
- @types/pg
- @types/supertest

## God Nodes (most connected - your core abstractions)
1. `PrismaService` - 104 edges
2. `AuthenticatedPrincipal` - 72 edges
3. `TenantId` - 69 edges
4. `Roles()` - 61 edges
5. `DomainException` - 45 edges
6. `parseBigIntId()` - 42 edges
7. `HashService` - 38 edges
8. `CurrentPrincipal` - 33 edges
9. `AuditService` - 30 edges
10. `CacheService` - 26 edges

## Surprising Connections (you probably didn't know these)
- `createTestApp()` --references--> `test`  [EXTRACTED]
  test/e2e/support/test-app.ts → package.json
- `provisionE2eClients()` --references--> `@prisma/client`  [EXTRACTED]
  test/e2e/support/integration-clients.ts → package.json
- `createTestApp()` --indirect_call--> `AppModule`  [INFERRED]
  test/e2e/support/test-app.ts → src/app.module.ts
- `createTestApp()` --indirect_call--> `AccessDenialAuditorService`  [INFERRED]
  test/e2e/support/test-app.ts → src/common/security/access-denial-auditor.service.ts
- `bootstrap()` --indirect_call--> `AppModule`  [INFERRED]
  src/main.ts → src/app.module.ts

## Import Cycles
- None detected.

## Communities (99 total, 19 thin omitted)

### Community 0 - "graph.types.ts"
Cohesion: 0.05
Nodes (49): ExecutionEngineService, MutableExecutionState, Injectable, ExpressionEvaluator, Injectable, ArtifactGraphSnapshot, CompiledDecisionArtifact, DecisionReasonResult (+41 more)

### Community 1 - "CacheService"
Cohesion: 0.07
Nodes (23): assertEqual(), call(), decisionVariables, main(), managementHeaders, results, runtimeHeaders, CacheService (+15 more)

### Community 2 - "seed.ts"
Cohesion: 0.06
Nodes (48): DemoArtifactSummary, seedDemoArtifact(), ActionDefinition, buildDemoGraph(), ConditionDefinition, DemoGraphResult, EdgeDefinition, NodeDefinition (+40 more)

### Community 3 - "parseBigIntId"
Cohesion: 0.16
Nodes (11): Put, parseBigIntId(), ArtifactController, ApiTags, Body, Controller, Get, Headers (+3 more)

### Community 4 - "views.controller.ts"
Cohesion: 0.12
Nodes (24): READ_ROLES, ArtifactInputContractQueryDto, ArtifactPickerQueryDto, ArtifactVersionPickerQueryDto, GlobalSearchQueryDto, NodeScriptListQueryDto, TestRunPickerQueryDto, TestSuitePickerQueryDto (+16 more)

### Community 5 - "PrismaService"
Cohesion: 0.17
Nodes (5): AppendAuditEventInput, AuditService, Injectable, PrismaService, Injectable

### Community 6 - "artifact.dto.ts"
Cohesion: 0.19
Nodes (28): ActionDto, ActionReasonDto, CloneVersionDto, ConditionDto, CreateArtifactDto, DependencyDto, EdgeConditionBindingDto, EdgeDto (+20 more)

### Community 7 - "test-app.ts"
Cohesion: 0.12
Nodes (16): Catch, test, AppModule, Module, DomainExceptionFilter, AccessDenialAuditorService, Injectable, managementHeaders() (+8 more)

### Community 8 - "deployment.controller.ts"
Cohesion: 0.14
Nodes (16): DeploymentController, ApiTags, Body, Controller, Get, Param, Post, DeployVersionDto (+8 more)

### Community 9 - "devDependencies"
Cohesion: 0.12
Nodes (17): jest, devDependencies, jest, supertest, ts-node, @types/compression, @types/express, @types/jest (+9 more)

### Community 10 - "manual-review.controller.ts"
Cohesion: 0.16
Nodes (11): ManualReviewController, ApiTags, Body, Controller, Get, Param, Post, Query (+3 more)

### Community 11 - "audit-query.service.ts"
Cohesion: 0.12
Nodes (16): AuditQueryController, ApiTags, Controller, Get, Param, Query, AuditEventSearchQueryDto, ExecutionSearchQueryDto (+8 more)

### Community 12 - "RecordApprovalDecisionDto"
Cohesion: 0.19
Nodes (14): ApprovalEvidenceDto, CreateCustomApprovalStepDto, RecordApprovalDecisionDto, SubmitReviewDto, IsArray, IsBoolean, IsIn, IsInt (+6 more)

### Community 13 - ".append"
Cohesion: 0.19
Nodes (4): ArtifactLifecycleService, Injectable, DeploymentService, Injectable

### Community 14 - "compilerOptions"
Cohesion: 0.07
Nodes (26): prisma/**/*.ts, src/**/*.ts, test/**/*.ts, compilerOptions, allowSyntheticDefaultImports, declaration, emitDecoratorMetadata, esModuleInterop (+18 more)

### Community 15 - "variable-resolution.service.ts"
Cohesion: 0.24
Nodes (6): RequestMetric, VariableContractSnapshot, Injectable, VariableResolutionResult, VariableResolutionService, contract()

### Community 16 - "traceability.service.ts"
Cohesion: 0.14
Nodes (16): CreateBusinessObjectiveDto, LinkPolicyArtifactDto, LinkPolicyTestSuiteDto, ObjectiveListQueryDto, PolicyRequirementDto, IsArray, IsNotEmpty, IsObject (+8 more)

### Community 17 - "scripts"
Cohesion: 0.09
Nodes (22): scripts, build, db:reset, migration:validate, prisma:generate, prisma:migrate, prisma:migrate:dev, prisma:seed (+14 more)

### Community 18 - "variable.service.ts"
Cohesion: 0.11
Nodes (27): ApiTags, Controller, Get, Query, VariableController, CreateReasonCodeDto, CreateVariableDefinitionDto, CreateVariableVersionDto (+19 more)

### Community 19 - "AuthenticatedPrincipal"
Cohesion: 0.31
Nodes (6): Audience(), CurrentPrincipal, AuthenticatedPrincipal, Body, Param, Post

### Community 20 - "app.module.ts"
Cohesion: 0.21
Nodes (14): ArtifactModule, Module, DeploymentModule, Module, GovernanceModule, Module, GraphModule, Module (+6 more)

### Community 21 - "DomainException"
Cohesion: 0.17
Nodes (6): DomainException, parseIfMatch(), ArtifactGraphReaderService, Injectable, allowedTransitions, EvaluationContext

### Community 22 - ".execute"
Cohesion: 0.22
Nodes (7): RuntimeController, ApiTags, Body, Controller, Param, Post, Res

### Community 23 - "runtime.service.ts"
Cohesion: 0.19
Nodes (11): ResolvedDeployment, WriteExecutionInput, ExecuteDecisionDto, IsNotEmpty, IsObject, IsOptional, IsString, Matches (+3 more)

### Community 24 - "HashService"
Cohesion: 0.13
Nodes (9): canonicalize(), JsonPrimitive, JsonValue, normalize(), HashService, Injectable, CompilerService, Injectable (+1 more)

### Community 25 - "dependencies"
Cohesion: 0.06
Nodes (35): class-transformer, class-validator, compression, helmet, ioredis, @nestjs/common, @nestjs/config, @nestjs/core (+27 more)

### Community 26 - "deployment.service.ts"
Cohesion: 0.11
Nodes (22): pageResult, paginationArgs(), PaginationQueryDto, IsInt, IsOptional, Max, Min, Type (+14 more)

### Community 27 - "MetricsService"
Cohesion: 0.10
Nodes (11): ApiExcludeController, AccessLogInterceptor, Injectable, MetricsController, Controller, MetricsInterceptor, Injectable, MetricsService (+3 more)

### Community 28 - "security.types.ts"
Cohesion: 0.18
Nodes (11): FixedWindowResult, MemoryCounter, MemoryEntry, RequestContextStore, IntegrationClientService, ResolvedIntegrationClient, Injectable, ApiAudience (+3 more)

### Community 29 - "StructuredLoggerService"
Cohesion: 0.13
Nodes (9): RequestContextService, Injectable, LEVEL_WEIGHT, PINO_METHOD, SENSITIVE_KEYS, StructuredLoggerService, Injectable, bootstrap() (+1 more)

### Community 30 - "identity-session.controller.ts"
Cohesion: 0.20
Nodes (7): IdentityLogoutDto, IsBoolean, IsOptional, IdentitySessionModule, Module, SessionRateLimitGuard, Injectable

### Community 31 - "ArtifactService"
Cohesion: 0.22
Nodes (4): ArtifactGraphWriterService, Injectable, ArtifactService, Injectable

### Community 32 - "CreateTestSuiteDto"
Cohesion: 0.22
Nodes (15): CreateTestSuiteDto, ImportTestCasesDto, RunTestSuiteDto, TestCaseDto, ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean (+7 more)

### Community 33 - ".execute"
Cohesion: 0.23
Nodes (4): IdempotencyService, Injectable, RuntimeService, Injectable

### Community 34 - "IdentityProviderClient"
Cohesion: 0.27
Nodes (3): IdentityProviderClient, Injectable, IdentitySession

### Community 35 - ".logout"
Cohesion: 0.20
Nodes (11): IdentitySessionController, ApiTags, Body, Controller, Headers, HttpCode, Post, Res (+3 more)

### Community 36 - "VISTAS_POR_FASES.md"
Cohesion: 0.06
Nodes (34): 10. Matriz resumida de permisos, 11. Reglas UX obligatorias para producción, 12. Definition of Done del frontend por vista, 13. Brechas de API antes de completar todas las vistas, 1.1 Variables, 1.2 Códigos de razón, 1. Convenciones, 2.1 Artefactos (+26 more)

### Community 37 - "identity-provider.client.ts"
Cohesion: 0.26
Nodes (9): LoginInput, identityPinChallengeSchema, IdentityProfile, identityProfileSchema, identityProviderSessionSchema, identitySessionSchema, PublicIdentitySession, userSchema (+1 more)

### Community 38 - "simulation.service.ts"
Cohesion: 0.11
Nodes (15): SimulationController, ApiTags, Body, Controller, Param, Post, SimulateDecisionDto, IsNotEmpty (+7 more)

### Community 41 - "IdentityLoginDto"
Cohesion: 0.33
Nodes (6): IsEmail, IdentityLoginDto, IsString, Matches, MaxLength, MinLength

### Community 42 - "exclude"
Cohesion: 0.20
Nodes (9): prisma/seed/**, prisma/seed.ts, **/*.spec.ts, test, ./tsconfig.json, exclude, extends, dist (+1 more)

### Community 43 - "env.schema.ts"
Cohesion: 0.22
Nodes (8): AppEnv, booleanFromString, envSchema, optionalSecret, optionalUrl, validateEnvironment(), base, jwtProduction

### Community 44 - "jwt-verifier.service.ts"
Cohesion: 0.22
Nodes (7): Jwk, JwksDocument, JwtClaims, JwtHeader, VerifiedJwtPrincipal, encode(), token()

### Community 45 - "TestExecutionService"
Cohesion: 0.18
Nodes (4): TestExecutionService, Injectable, TestSuiteService, Injectable

### Community 46 - "server.mjs"
Cohesion: 0.22
Nodes (4): JS_WRAPPER, PYTHON_WRAPPER, server, socketDir

### Community 47 - "generate-baseline-sql.py"
Cohesion: 0.31
Nodes (8): db_object_name(), default_sql(), Field, Model, q(), Keep PostgreSQL identifiers at <=63 bytes with a deterministic suffix., Relation, sql_type()

### Community 48 - "TenantId"
Cohesion: 0.15
Nodes (16): Roles(), TenantId, Query, TraceabilityController, ApiTags, Body, Controller, Get (+8 more)

### Community 52 - "nest-cli.json"
Cohesion: 0.29
Nodes (6): collection, compilerOptions, deleteOutDir, plugins, $schema, sourceRoot

### Community 53 - "identity-provider-verifier.service.ts"
Cohesion: 0.26
Nodes (7): IdentityProviderVerifierService, Injectable, VerifiedIdentityPrincipal, DIRECT_ROLES, mapIdentityRoles(), ROLE_ALIASES, identityUser

### Community 54 - "safe-regex.ts"
Cohesion: 0.52
Nodes (5): compile(), compiledCache, isPotentiallyCatastrophic(), SafeRegexResult, safeRegexTest()

### Community 55 - "package.json"
Cohesion: 0.33
Nodes (5): description, license, name, private, version

### Community 56 - "smoke.sh"
Cohesion: 0.33
Nodes (5): BASE_URL, MANAGEMENT_API_KEY, RUNTIME_API_KEY, smoke.sh script, TENANT_ID

### Community 57 - ".run"
Cohesion: 0.18
Nodes (9): TestingController, ApiTags, Body, Controller, Get, HttpCode, Param, Post (+1 more)

### Community 58 - "governance.service.ts"
Cohesion: 0.15
Nodes (8): Injectable, VersionStateService, Get, Query, ApprovalRequestListQueryDto, GovernanceService, Injectable, config

### Community 59 - "cache.module.ts"
Cohesion: 0.50
Nodes (3): CacheModule, Global, Module

### Community 60 - "AuditModule"
Cohesion: 0.67
Nodes (3): AuditModule, Global, Module

### Community 61 - "CryptoModule"
Cohesion: 0.67
Nodes (3): CryptoModule, Global, Module

### Community 62 - "ObservabilityModule"
Cohesion: 0.67
Nodes (3): ObservabilityModule, Global, Module

### Community 63 - "PrismaModule"
Cohesion: 0.67
Nodes (3): PrismaModule, Global, Module

### Community 64 - "SecurityModule"
Cohesion: 0.67
Nodes (3): SecurityModule, Global, Module

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

### Community 72 - ".decide"
Cohesion: 0.31
Nodes (6): GovernanceController, ApiTags, Body, Controller, Param, Post

### Community 73 - "Runbook operativo"
Cohesion: 0.25
Nodes (8): Despliegue seguro, Falla del sink de archivo, Incidente: aumento de 401, 403 o 429, Incidente: incremento de NO_DECISION, Incidente: readiness falla, Incidente: ruptura de cadena de auditoría, Rollback de aplicación, Runbook operativo

### Community 74 - "ATLAS — Paquete de arquitectura PlantUML"
Cohesion: 0.29
Nodes (6): ATLAS — Paquete de arquitectura PlantUML, Compilación, Diagramas incluidos, Linux/macOS, PowerShell, Principios de diseño incorporados

### Community 75 - "ATLAS Decision Engine 2.0 — Production Readiness"
Cohesion: 0.29
Nodes (6): ATLAS Decision Engine 2.0 — Production Readiness, Estado honesto, Gates obligatorios antes de Go-Live, Mejoras incorporadas en 2.0, Riesgos abiertos, SLO inicial propuesto

### Community 77 - "TrafficRuleDto"
Cohesion: 0.29
Nodes (7): TrafficRuleDto, IsInt, IsNumber, IsObject, IsOptional, Max, Min

### Community 86 - "Despliegue"
Cohesion: 0.40
Nodes (4): Contenedores, Desarrollo local, Despliegue, Producción

### Community 87 - ".getMetrics"
Cohesion: 0.40
Nodes (3): Get, Headers, Res

### Community 88 - "Seguridad"
Cohesion: 0.50
Nodes (3): Reglas operativas mínimas, Reporte responsable, Seguridad

## Knowledge Gaps
- **279 isolated node(s):** `compile_all.sh script`, `$schema`, `collection`, `sourceRoot`, `deleteOutDir` (+274 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **19 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `PrismaService` connect `PrismaService` to `CacheService`, `parseBigIntId`, `views.controller.ts`, `test-app.ts`, `manual-review.controller.ts`, `audit-query.service.ts`, `.append`, `traceability.service.ts`, `variable.service.ts`, `AuthenticatedPrincipal`, `DomainException`, `runtime.service.ts`, `HashService`, `deployment.service.ts`, `security.types.ts`, `ArtifactService`, `.execute`, `TestExecutionService`, `TenantId`, `.run`, `governance.service.ts`, `deployment-resolver.service.ts`, `ExecutionWriterService`?**
  _High betweenness centrality (0.093) - this node is a cross-community bridge._
- **Why does `@prisma/client` connect `dependencies` to `test-app.ts`?**
  _High betweenness centrality (0.052) - this node is a cross-community bridge._
- **What connects `compile_all.sh script`, `$schema`, `collection` to the rest of the system?**
  _279 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `graph.types.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.05262027491408935 - nodes in this community are weakly interconnected._
- **Should `CacheService` be split into smaller, more focused modules?**
  _Cohesion score 0.06966618287373004 - nodes in this community are weakly interconnected._
- **Should `seed.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.056866303690260134 - nodes in this community are weakly interconnected._
- **Should `views.controller.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.11875843454790823 - nodes in this community are weakly interconnected._