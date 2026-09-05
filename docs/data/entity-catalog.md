<!-- GENERADO POR scripts/docs/generate-catalogs.mjs — NO EDITAR A MANO.
     Fuente: prisma/schema.prisma. Ejecute `yarn docs:catalog` tras cambiar el código. -->

# Catálogo de entidades

100 modelos persistentes. El nombre técnico es el de la tabla; el nombre del
modelo es el que usa el código. Las restricciones e índices son los declarados en el
esquema, que es la fuente que las migraciones aplican.

| Modelo | Tabla | Campos | Índices | Relaciones |
| --- | --- | ---: | ---: | ---: |
| [`ApprovedLibrary`](#approvedlibrary) | `decision_approved_library` | 21 | 2 | 0 |
| [`AudioActorGenerationDaily`](#audioactorgenerationdaily) | `decision_audio_actor_generation_daily` | 5 | 2 | 0 |
| [`AudioAsset`](#audioasset) | `decision_audio_asset` | 30 | 3 | 0 |
| [`AudioBudgetWindow`](#audiobudgetwindow) | `decision_audio_budget_window` | 7 | 1 | 0 |
| [`AudioGenerationUsage`](#audiogenerationusage) | `decision_audio_generation_usage` | 7 | 2 | 0 |
| [`AudioSegment`](#audiosegment) | `decision_audio_segment` | 10 | 1 | 0 |
| [`AudioTemplate`](#audiotemplate) | `decision_audio_template` | 11 | 1 | 0 |
| [`AudioTtsRun`](#audiottsrun) | `decision_audio_tts_run` | 26 | 4 | 0 |
| [`BankStatementRun`](#bankstatementrun) | `decision_bank_statement_run` | 46 | 6 | 0 |
| [`BusinessObjective`](#businessobjective) | `decision_business_objective` | 10 | 1 | 0 |
| [`CalculatedField`](#calculatedfield) | `decision_calculated_field` | 12 | 2 | 0 |
| [`CalculatedFieldLibrary`](#calculatedfieldlibrary) | `decision_calculated_field_library` | 5 | 1 | 2 |
| [`CalculatedFieldTestCase`](#calculatedfieldtestcase) | `decision_calculated_field_test_case` | 8 | 1 | 1 |
| [`CalculatedFieldVersion`](#calculatedfieldversion) | `decision_calculated_field_version` | 25 | 2 | 1 |
| [`CalibrationBucket`](#calibrationbucket) | `calibration_bucket` | 10 | 2 | 1 |
| [`CreditFacility`](#creditfacility) | `credit_facility` | 15 | 3 | 1 |
| [`DecisionAccessAudit`](#decisionaccessaudit) | `decision_access_audit` | 11 | 2 | 0 |
| [`DecisionActionReasonMapping`](#decisionactionreasonmapping) | `decision_action_reason_mapping` | 7 | 1 | 2 |
| [`DecisionApprovalDecision`](#decisionapprovaldecision) | `decision_approval_decision` | 8 | 1 | 1 |
| [`DecisionApprovalEvidence`](#decisionapprovalevidence) | `decision_approval_evidence` | 7 | 0 | 1 |
| [`DecisionApprovalRequest`](#decisionapprovalrequest) | `decision_approval_request` | 9 | 1 | 1 |
| [`DecisionApprovalStep`](#decisionapprovalstep) | `decision_approval_step` | 9 | 1 | 1 |
| [`DecisionArtifact`](#decisionartifact) | `decision_artifact` | 14 | 2 | 0 |
| [`DecisionArtifactCalculatedFieldUse`](#decisionartifactcalculatedfielduse) | `decision_artifact_calculated_field_use` | 13 | 2 | 2 |
| [`DecisionArtifactReference`](#decisionartifactreference) | `decision_artifact_reference` | 22 | 3 | 0 |
| [`DecisionArtifactVariableDependency`](#decisionartifactvariabledependency) | `decision_artifact_variable_dependency` | 10 | 1 | 2 |
| [`DecisionArtifactVersion`](#decisionartifactversion) | `decision_artifact_version` | 47 | 2 | 3 |
| [`DecisionAuditEvent`](#decisionauditevent) | `decision_audit_event` | 13 | 3 | 0 |
| [`DecisionChangeLog`](#decisionchangelog) | `decision_change_log` | 11 | 1 | 1 |
| [`DecisionCodeImport`](#decisioncodeimport) | `decision_code_import` | 15 | 2 | 0 |
| [`DecisionCompiledArtifact`](#decisioncompiledartifact) | `decision_compiled_artifact` | 11 | 2 | 1 |
| [`DecisionDataSubjectRequest`](#decisiondatasubjectrequest) | `decision_data_subject_request` | 10 | 2 | 0 |
| [`DecisionDeployment`](#decisiondeployment) | `decision_deployment` | 23 | 2 | 7 |
| [`DecisionDeploymentTraffic`](#decisiondeploymenttraffic) | `decision_deployment_traffic` | 7 | 1 | 1 |
| [`DecisionEdgeCondition`](#decisionedgecondition) | `decision_edge_condition` | 6 | 1 | 2 |
| [`DecisionEnvironment`](#decisionenvironment) | `decision_environment` | 11 | 0 | 0 |
| [`DecisionExecution`](#decisionexecution) | `decision_execution` | 30 | 5 | 4 |
| [`DecisionExecutionError`](#decisionexecutionerror) | `decision_execution_error` | 8 | 0 | 1 |
| [`DecisionExecutionReason`](#decisionexecutionreason) | `decision_execution_reason` | 9 | 0 | 3 |
| [`DecisionExecutionStep`](#decisionexecutionstep) | `decision_execution_step` | 9 | 1 | 2 |
| [`DecisionExecutionTreeLink`](#decisionexecutiontreelink) | `decision_execution_tree_link` | 15 | 3 | 0 |
| [`DecisionExecutionVariable`](#decisionexecutionvariable) | `decision_execution_variable` | 15 | 1 | 2 |
| [`DecisionIntermediateVariable`](#decisionintermediatevariable) | `decision_intermediate_variable` | 19 | 2 | 1 |
| [`DecisionManualReviewCase`](#decisionmanualreviewcase) | `decision_manual_review_case` | 14 | 1 | 1 |
| [`DecisionMonitoringAttribute`](#decisionmonitoringattribute) | `decision_monitoring_attribute` | 8 | 2 | 1 |
| [`DecisionNodeAction`](#decisionnodeaction) | `decision_node_action` | 6 | 1 | 2 |
| [`DecisionNodeCondition`](#decisionnodecondition) | `decision_node_condition` | 7 | 1 | 2 |
| [`DecisionNodeScript`](#decisionnodescript) | `decision_node_script` | 13 | 2 | 1 |
| [`DecisionOutboxEvent`](#decisionoutboxevent) | `decision_outbox_event` | 19 | 3 | 0 |
| [`DecisionOutcomeObservation`](#decisionoutcomeobservation) | `decision_outcome_observation` | 14 | 3 | 2 |
| [`DecisionOutputContractField`](#decisionoutputcontractfield) | `decision_output_contract_field` | 19 | 2 | 1 |
| [`DecisionOutputFieldReasonMap`](#decisionoutputfieldreasonmap) | `decision_output_field_reason_map` | 6 | 1 | 2 |
| [`DecisionReasonCode`](#decisionreasoncode) | `decision_reason_code` | 12 | 2 | 0 |
| [`DecisionRuleAction`](#decisionruleaction) | `decision_rule_action` | 11 | 1 | 1 |
| [`DecisionRuleCondition`](#decisionrulecondition) | `decision_rule_condition` | 11 | 1 | 1 |
| [`DecisionRuleEdge`](#decisionruleedge) | `decision_rule_edge` | 12 | 2 | 3 |
| [`DecisionRuleNode`](#decisionrulenode) | `decision_rule_node` | 16 | 2 | 3 |
| [`DecisionRuntimeBinding`](#decisionruntimebinding) | `decision_runtime_binding` | 9 | 2 | 2 |
| [`DecisionSubject`](#decisionsubject) | `decision_subject` | 10 | 2 | 0 |
| [`DecisionTestAssertion`](#decisiontestassertion) | `decision_test_assertion` | 8 | 0 | 1 |
| [`DecisionTestCase`](#decisiontestcase) | `decision_test_case` | 10 | 1 | 1 |
| [`DecisionTestCaseRun`](#decisiontestcaserun) | `decision_test_case_run` | 10 | 1 | 2 |
| [`DecisionTestCoverage`](#decisiontestcoverage) | `decision_test_coverage` | 8 | 1 | 1 |
| [`DecisionTestRun`](#decisiontestrun) | `decision_test_run` | 16 | 2 | 2 |
| [`DecisionTestSuite`](#decisiontestsuite) | `decision_test_suite` | 10 | 1 | 1 |
| [`DecisionVariableDefinition`](#decisionvariabledefinition) | `decision_variable_definition` | 15 | 3 | 0 |
| [`DecisionVariableSource`](#decisionvariablesource) | `decision_variable_source` | 9 | 1 | 1 |
| [`DecisionVariableValidationRule`](#decisionvariablevalidationrule) | `decision_variable_validation_rule` | 7 | 0 | 1 |
| [`DecisionVariableVersion`](#decisionvariableversion) | `decision_variable_version` | 24 | 2 | 1 |
| [`DecisionVersionStatusHistory`](#decisionversionstatushistory) | `decision_version_status_history` | 8 | 1 | 1 |
| [`ExposureLimit`](#exposurelimit) | `exposure_limit` | 10 | 2 | 0 |
| [`FinancialInstitution`](#financialinstitution) | `decision_financial_institution` | 21 | 3 | 0 |
| [`IdentityVerificationRun`](#identityverificationrun) | `decision_identity_verification_run` | 44 | 5 | 0 |
| [`IntegrationClient`](#integrationclient) | `integration_client` | 10 | 1 | 0 |
| [`IntegrationCredential`](#integrationcredential) | `integration_credential` | 11 | 2 | 1 |
| [`IntegrationScope`](#integrationscope) | `integration_scope` | 4 | 1 | 1 |
| [`IntegrationTenantAccess`](#integrationtenantaccess) | `integration_tenant_access` | 4 | 2 | 1 |
| [`MonitoringBaseline`](#monitoringbaseline) | `monitoring_baseline` | 9 | 2 | 1 |
| [`MonitoringEvaluation`](#monitoringevaluation) | `monitoring_evaluation` | 12 | 2 | 1 |
| [`Notification`](#notification) | `decision_notification` | 15 | 2 | 0 |
| [`OutcomeWindowSchedule`](#outcomewindowschedule) | `outcome_window_schedule` | 9 | 2 | 2 |
| [`PolicyArtifactLink`](#policyartifactlink) | `decision_policy_artifact_link` | 5 | 1 | 2 |
| [`PolicyRequirement`](#policyrequirement) | `decision_policy_requirement` | 10 | 1 | 1 |
| [`PolicyTestLink`](#policytestlink) | `decision_policy_test_link` | 5 | 1 | 2 |
| [`PortfolioState`](#portfoliostate) | `portfolio_state` | 7 | 2 | 0 |
| [`ProcessedEvent`](#processedevent) | `decision_processed_event` | 4 | 1 | 0 |
| [`QaCounterexample`](#qacounterexample) | `decision_qa_counterexample` | 14 | 2 | 1 |
| [`QaGenerationRun`](#qagenerationrun) | `decision_qa_generation_run` | 21 | 1 | 1 |
| [`ReidentificationRequest`](#reidentificationrequest) | `reidentification_request` | 11 | 2 | 1 |
| [`RuntimeIdempotency`](#runtimeidempotency) | `decision_runtime_idempotency` | 12 | 2 | 0 |
| [`SemanticAnalysisRun`](#semanticanalysisrun) | `decision_semantic_analysis_run` | 22 | 4 | 0 |
| [`SemanticCategory`](#semanticcategory) | `decision_semantic_category` | 16 | 3 | 2 |
| [`SemanticCategoryEmbedding`](#semanticcategoryembedding) | `decision_semantic_category_embedding` | 6 | 1 | 1 |
| [`SemanticEntityAlias`](#semanticentityalias) | `decision_semantic_entity_alias` | 6 | 2 | 0 |
| [`SemanticModelSetting`](#semanticmodelsetting) | `decision_semantic_model_setting` | 8 | 0 | 0 |
| [`SemanticTenantBudget`](#semantictenantbudget) | `decision_semantic_tenant_budget` | 5 | 1 | 0 |
| [`SqlConsoleQueryLog`](#sqlconsolequerylog) | `sql_console_query_log` | 13 | 2 | 0 |
| [`SubjectConsent`](#subjectconsent) | `subject_consent` | 11 | 2 | 1 |
| [`UnresolvedClassification`](#unresolvedclassification) | `decision_unresolved_classification` | 20 | 3 | 0 |
| [`UserTutorialProgress`](#usertutorialprogress) | `user_tutorial_progress` | 11 | 2 | 0 |

## ApprovedLibrary

Tabla `decision_approved_library`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `tenantId` | `BigInt` | @map("tenant_id") |
| `logicalName` | `String` | @map("logical_name") @db.VarChar(80) |
| `packageName` | `String` | @map("package_name") @db.VarChar(160) |
| `version` | `String` | @db.VarChar(40) |
| `language` | `CalculatedFieldImplKind` | — |
| `category` | `String` | @db.VarChar(60) |
| `description` | `String` | @db.Text |
| `documentationUrl` | `String?` | @map("documentation_url") @db.VarChar(500) |
| `allowedFunctions` | `String[]` | @map("allowed_functions") |
| `blockedFunctions` | `String[]` | @map("blocked_functions") |
| `allowedEnvironments` | `String[]` | @map("allowed_environments") |
| `status` | `ApprovedLibraryStatus` | @default(APPROVED) |
| `knownRisks` | `String?` | @map("known_risks") @db.Text |
| `integrityHash` | `String?` | @map("integrity_hash") @db.VarChar(128) |
| `updatePolicy` | `String` | @default("PINNED") @map("update_policy") @db.VarChar(40) |
| `reviewedAt` | `DateTime?` | @map("reviewed_at") @db.Timestamptz(6) |
| `reviewedBy` | `String?` | @map("reviewed_by") @db.VarChar(160) |
| `createdAt` | `DateTime` | @default(now()) @map("created_at") @db.Timestamptz(6) |
| `updatedAt` | `DateTime` | @updatedAt @map("updated_at") @db.Timestamptz(6) |
| `calculatedFieldUses` | `CalculatedFieldLibrary[]` | — |

Índices y restricciones:

- `unique([tenantId, logicalName, language, version])`
- `index([tenantId, status])`

## AudioActorGenerationDaily

Tabla `decision_audio_actor_generation_daily`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `tenantId` | `BigInt` | @map("tenant_id") |
| `actorId` | `String` | @map("actor_id") @db.VarChar(160) |
| `dayKey` | `String` | @map("day_key") @db.VarChar(10) |
| `generationCount` | `Int` | @default(0) @map("generation_count") |

Índices y restricciones:

- `unique([tenantId, actorId, dayKey])`
- `index([tenantId, dayKey])`

## AudioAsset

Tabla `decision_audio_asset`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `String` | @id @db.Uuid |
| `tenantId` | `BigInt` | @map("tenant_id") |
| `assetKey` | `String` | @map("asset_key") @db.Char(64) |
| `templateCode` | `String` | @map("template_code") @db.VarChar(160) |
| `templateVersion` | `Int` | @map("template_version") |
| `status` | `AudioAssetStatus` | @default(PENDING) |
| `renderedTextEncrypted` | `String` | @map("rendered_text_encrypted") @db.Text |
| `variablesEncrypted` | `String?` | @map("variables_encrypted") @db.Text |
| `segmentsSummary` | `Json?` | @map("segments_summary") |
| `language` | `String` | @db.VarChar(20) |
| `provider` | `String` | @db.VarChar(40) |
| `providerModel` | `String` | @map("provider_model") @db.VarChar(128) |
| `providerVoiceRef` | `String` | @map("provider_voice_ref") @db.VarChar(255) |
| `voiceProfile` | `String` | @map("voice_profile") @db.VarChar(100) |
| `voiceVersion` | `Int` | @map("voice_version") |
| `outputFormat` | `String` | @map("output_format") @db.VarChar(64) |
| `sampleRate` | `Int` | @map("sample_rate") |
| `reservedUnits` | `Int` | @default(0) @map("reserved_units") |
| `attempts` | `Int` | @default(0) |
| `correlationId` | `String?` | @map("correlation_id") @db.VarChar(64) |
| `claimedAt` | `DateTime?` | @map("claimed_at") @db.Timestamptz(6) |
| `claimedBy` | `String?` | @map("claimed_by") @db.VarChar(120) |
| `storageUri` | `String?` | @map("storage_uri") @db.Text |
| `audioBytes` | `Bytes?` | @map("audio_bytes") |
| `mimeType` | `String?` | @map("mime_type") @db.VarChar(120) |
| `checksumSha256` | `String?` | @map("checksum_sha256") @db.Char(64) |
| `bytes` | `BigInt?` | — |
| `lastErrorCode` | `String?` | @map("last_error_code") @db.VarChar(120) |
| `createdAt` | `DateTime` | @default(now()) @map("created_at") @db.Timestamptz(6) |
| `updatedAt` | `DateTime` | @updatedAt @map("updated_at") @db.Timestamptz(6) |

Índices y restricciones:

- `unique([tenantId, assetKey])`
- `index([tenantId, status])`
- `index([tenantId, templateCode, templateVersion])`

## AudioBudgetWindow

Tabla `decision_audio_budget_window`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `tenantId` | `BigInt` | @map("tenant_id") |
| `provider` | `String` | @db.VarChar(40) |
| `monthKey` | `String` | @map("month_key") @db.VarChar(7) |
| `reservedUnits` | `Int` | @default(0) @map("reserved_units") |
| `settledUnits` | `Int` | @default(0) @map("settled_units") |
| `updatedAt` | `DateTime` | @updatedAt @map("updated_at") @db.Timestamptz(6) |

Índices y restricciones:

- `unique([tenantId, provider, monthKey])`

## AudioGenerationUsage

Tabla `decision_audio_generation_usage`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `tenantId` | `BigInt` | @map("tenant_id") |
| `assetId` | `String` | @map("asset_id") @db.Uuid |
| `provider` | `String` | @db.VarChar(40) |
| `usageUnits` | `Int` | @map("usage_units") |
| `monthKey` | `String` | @map("month_key") @db.VarChar(7) |
| `createdAt` | `DateTime` | @default(now()) @map("created_at") @db.Timestamptz(6) |

Índices y restricciones:

- `unique([tenantId, assetId])`
- `index([tenantId, provider, monthKey])`

## AudioSegment

Tabla `decision_audio_segment`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `String` | @id @db.Uuid |
| `tenantId` | `BigInt` | @map("tenant_id") |
| `segmentKey` | `String` | @map("segment_key") @db.Char(64) |
| `textEncrypted` | `String` | @map("text_encrypted") @db.Text |
| `audioBytes` | `Bytes` | @map("audio_bytes") |
| `mimeType` | `String` | @map("mime_type") @db.VarChar(120) |
| `checksumSha256` | `String` | @map("checksum_sha256") @db.Char(64) |
| `bytes` | `BigInt` | — |
| `usageUnits` | `Int` | @map("usage_units") |
| `createdAt` | `DateTime` | @default(now()) @map("created_at") @db.Timestamptz(6) |

Índices y restricciones:

- `unique([tenantId, segmentKey])`

## AudioTemplate

Tabla `decision_audio_template`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `tenantId` | `BigInt` | @map("tenant_id") |
| `code` | `String` | @db.VarChar(160) |
| `version` | `Int` | @default(1) |
| `strategy` | `AudioTemplateStrategy` | — |
| `templateText` | `String` | @map("template_text") @db.Text |
| `language` | `String?` | @db.VarChar(20) |
| `fallbackTemplateCode` | `String?` | @map("fallback_template_code") @db.VarChar(160) |
| `isActive` | `Boolean` | @default(true) @map("is_active") |
| `createdAt` | `DateTime` | @default(now()) @map("created_at") @db.Timestamptz(6) |
| `updatedAt` | `DateTime` | @updatedAt @map("updated_at") @db.Timestamptz(6) |

Índices y restricciones:

- `unique([tenantId, code])`

## AudioTtsRun

Tabla `decision_audio_tts_run`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `tenantId` | `BigInt` | @map("tenant_id") |
| `requestId` | `String` | @map("request_id") @db.VarChar(64) |
| `idempotencyKey` | `String` | @map("idempotency_key") @db.VarChar(200) |
| `status` | `WorkerRunStatus` | @default(QUEUED) |
| `progress` | `Int` | @default(0) |
| `inputSource` | `WorkerInputSource` | @map("input_source") |
| `fixtureCode` | `String?` | @map("fixture_code") @db.VarChar(60) |
| `templateCode` | `String` | @map("template_code") @db.VarChar(160) |
| `variablesJson` | `Json?` | @map("variables_json") |
| `language` | `String?` | @db.VarChar(20) |
| `outcome` | `String?` | @db.VarChar(20) |
| `assetId` | `String?` | @map("asset_id") @db.Uuid |
| `cacheHit` | `Boolean` | @default(false) @map("cache_hit") |
| `resultJson` | `Json?` | @map("result_json") |
| `warningsJson` | `Json?` | @map("warnings_json") |
| `errorCode` | `String?` | @map("error_code") @db.VarChar(120) |
| `errorMessage` | `String?` | @map("error_message") @db.Text |
| `attemptCount` | `Int` | @default(0) @map("attempt_count") |
| `leaseExpiresAt` | `DateTime?` | @map("lease_expires_at") @db.Timestamptz(6) |
| `queuedAt` | `DateTime` | @default(now()) @map("queued_at") @db.Timestamptz(6) |
| `startedAt` | `DateTime?` | @map("started_at") @db.Timestamptz(6) |
| `finishedAt` | `DateTime?` | @map("finished_at") @db.Timestamptz(6) |
| `requestedBy` | `String` | @map("requested_by") @db.VarChar(160) |
| `correlationId` | `String` | @map("correlation_id") @db.VarChar(64) |
| `traceCarrier` | `Json?` | @map("trace_carrier") |

Índices y restricciones:

- `unique([tenantId, idempotencyKey])`
- `unique([tenantId, requestId])`
- `index([status, queuedAt])`
- `index([tenantId, queuedAt])`

## BankStatementRun

Tabla `decision_bank_statement_run`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `tenantId` | `BigInt` | @map("tenant_id") |
| `requestId` | `String` | @map("request_id") @db.VarChar(64) |
| `status` | `WorkerRunStatus` | @default(QUEUED) |
| `progress` | `Int` | @default(0) |
| `inputSource` | `WorkerInputSource` | @map("input_source") |
| `fixtureCode` | `String?` | @map("fixture_code") @db.VarChar(60) |
| `fileName` | `String` | @map("file_name") @db.VarChar(255) |
| `fileHash` | `String` | @map("file_hash") @db.Char(64) |
| `fileSizeBytes` | `Int` | @map("file_size_bytes") |
| `fileBytes` | `Bytes?` | @map("file_bytes") |
| `fileObjectKey` | `String?` | @map("file_object_key") @db.VarChar(512) |
| `resultJson` | `Json?` | @map("result_json") |
| `warningsJson` | `Json?` | @map("warnings_json") |
| `confidence` | `Decimal?` | @db.Decimal(4, 3) |
| `documentTypeConfidence` | `Decimal?` | @map("document_type_confidence") @db.Decimal(4, 3) |
| `institutionId` | `String?` | @map("institution_id") @db.VarChar(16) |
| `transactionCount` | `Int?` | @map("transaction_count") |
| `affordabilityJson` | `Json?` | @map("affordability_json") |
| `monthsComplete` | `Int?` | @map("months_complete") @db.SmallInt |
| `affordabilityScore` | `Int?` | @map("affordability_score") @db.SmallInt |
| `affordabilityBand` | `String?` | @map("affordability_band") @db.VarChar(16) |
| `monthlyIncome` | `Decimal?` | @map("monthly_income") @db.Decimal(18, 2) |
| `monthlyObligations` | `Decimal?` | @map("monthly_obligations") @db.Decimal(18, 2) |
| `maxAffordableInstallment` | `Decimal?` | @map("max_affordable_installment") @db.Decimal(18, 2) |
| `authenticityVerdict` | `String?` | @map("authenticity_verdict") @db.VarChar(16) |
| `authenticityScore` | `Int?` | @map("authenticity_score") @db.SmallInt |
| `errorCode` | `String?` | @map("error_code") @db.VarChar(120) |
| `errorMessage` | `String?` | @map("error_message") @db.Text |
| `reviewReason` | `StatementReviewReason?` | @map("review_reason") |
| `rejectionReason` | `StatementRejectionReason?` | @map("rejection_reason") |
| `reviewPriority` | `Int?` | @map("review_priority") |
| `reviewOpenedAt` | `DateTime?` | @map("review_opened_at") @db.Timestamptz(6) |
| `reviewClaimedBy` | `String?` | @map("review_claimed_by") @db.VarChar(160) |
| `reviewClaimedAt` | `DateTime?` | @map("review_claimed_at") @db.Timestamptz(6) |
| `reviewResolvedBy` | `String?` | @map("review_resolved_by") @db.VarChar(160) |
| `reviewResolvedAt` | `DateTime?` | @map("review_resolved_at") @db.Timestamptz(6) |
| `reviewNotes` | `String?` | @map("review_notes") @db.Text |
| `attemptCount` | `Int` | @default(0) @map("attempt_count") |
| `leaseExpiresAt` | `DateTime?` | @map("lease_expires_at") @db.Timestamptz(6) |
| `queuedAt` | `DateTime` | @default(now()) @map("queued_at") @db.Timestamptz(6) |
| `startedAt` | `DateTime?` | @map("started_at") @db.Timestamptz(6) |
| `finishedAt` | `DateTime?` | @map("finished_at") @db.Timestamptz(6) |
| `requestedBy` | `String` | @map("requested_by") @db.VarChar(160) |
| `correlationId` | `String` | @map("correlation_id") @db.VarChar(64) |
| `traceCarrier` | `Json?` | @map("trace_carrier") |

Índices y restricciones:

- `unique([tenantId, fileHash])`
- `unique([tenantId, requestId])`
- `index([status, queuedAt])`
- `index([tenantId, queuedAt])`
- `index([tenantId, status, reviewReason, reviewPriority, reviewOpenedAt])`
- `index([tenantId, affordabilityBand], map: "decision_bank_statement_run_affordability_idx")`

## BusinessObjective

Tabla `decision_business_objective`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `tenantId` | `BigInt` | @map("tenant_id") |
| `objectiveCode` | `String` | @map("objective_code") @db.VarChar(100) |
| `name` | `String` | @db.VarChar(200) |
| `metric` | `String` | @db.VarChar(160) |
| `targetJson` | `Json` | @map("target_json") |
| `ownerTeam` | `String` | @map("owner_team") @db.VarChar(100) |
| `isActive` | `Boolean` | @default(true) @map("is_active") |
| `createdAt` | `DateTime` | @default(now()) @map("created_at") @db.Timestamptz(6) |
| `policyRequirements` | `PolicyRequirement[]` | — |

Índices y restricciones:

- `unique([tenantId, objectiveCode])`

## CalculatedField

Tabla `decision_calculated_field`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `tenantId` | `BigInt` | @map("tenant_id") |
| `fieldCode` | `String` | @map("field_code") @db.VarChar(120) |
| `name` | `String` | @db.VarChar(160) |
| `description` | `String` | @db.Text |
| `rationale` | `String` | @db.Text |
| `category` | `String` | @db.VarChar(60) |
| `ownerTeam` | `String` | @map("owner_team") @db.VarChar(100) |
| `isActive` | `Boolean` | @default(true) @map("is_active") |
| `createdAt` | `DateTime` | @default(now()) @map("created_at") @db.Timestamptz(6) |
| `updatedAt` | `DateTime` | @updatedAt @map("updated_at") @db.Timestamptz(6) |
| `versions` | `CalculatedFieldVersion[]` | — |

Índices y restricciones:

- `unique([tenantId, fieldCode])`
- `index([tenantId, isActive])`

## CalculatedFieldLibrary

Tabla `decision_calculated_field_library`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `calculatedFieldVersionId` | `BigInt` | @map("calculated_field_version_id") |
| `approvedLibraryId` | `BigInt` | @map("approved_library_id") |
| `calculatedFieldVersion` | `CalculatedFieldVersion` | @relation(fields: [calculatedFieldVersionId], references: [id], onDelete: Cascade) |
| `library` | `ApprovedLibrary` | @relation(fields: [approvedLibraryId], references: [id], onDelete: Restrict) |

Índices y restricciones:

- `unique([calculatedFieldVersionId, approvedLibraryId])`

## CalculatedFieldTestCase

Tabla `decision_calculated_field_test_case`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `calculatedFieldVersionId` | `BigInt` | @map("calculated_field_version_id") |
| `name` | `String` | @db.VarChar(160) |
| `inputsJson` | `Json` | @map("inputs_json") |
| `expectedJson` | `Json?` | @map("expected_json") |
| `expectedErrorCode` | `String?` | @map("expected_error_code") @db.VarChar(80) |
| `createdAt` | `DateTime` | @default(now()) @map("created_at") @db.Timestamptz(6) |
| `calculatedFieldVersion` | `CalculatedFieldVersion` | @relation(fields: [calculatedFieldVersionId], references: [id], onDelete: Cascade) |

Índices y restricciones:

- `index([calculatedFieldVersionId])`

## CalculatedFieldVersion

Tabla `decision_calculated_field_version`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `calculatedFieldId` | `BigInt` | @map("calculated_field_id") |
| `versionNumber` | `Int` | @map("version_number") |
| `status` | `CalculatedFieldStatus` | @default(DRAFT) |
| `implementationKind` | `CalculatedFieldImplKind` | @map("implementation_kind") |
| `inputsJson` | `Json` | @map("inputs_json") |
| `returnJson` | `Json` | @map("return_json") |
| `commentsJson` | `Json?` | @map("comments_json") |
| `operationJson` | `Json?` | @map("operation_json") |
| `sourceCode` | `String?` | @map("source_code") @db.Text |
| `sourceChecksum` | `String?` | @map("source_checksum") @db.VarChar(128) |
| `timeoutMs` | `Int` | @default(50) @map("timeout_ms") |
| `errorPolicy` | `String` | @default("FAIL") @map("error_policy") @db.VarChar(40) |
| `defaultValueJson` | `Json?` | @map("default_value_json") |
| `contentHash` | `String` | @map("content_hash") @db.VarChar(128) |
| `environment` | `String?` | @db.VarChar(40) |
| `authorId` | `String` | @map("author_id") @db.VarChar(160) |
| `reviewerId` | `String?` | @map("reviewer_id") @db.VarChar(160) |
| `approverId` | `String?` | @map("approver_id") @db.VarChar(160) |
| `createdAt` | `DateTime` | @default(now()) @map("created_at") @db.Timestamptz(6) |
| `publishedAt` | `DateTime?` | @map("published_at") @db.Timestamptz(6) |
| `calculatedField` | `CalculatedField` | @relation(fields: [calculatedFieldId], references: [id], onDelete: Cascade) |
| `libraries` | `CalculatedFieldLibrary[]` | — |
| `testCases` | `CalculatedFieldTestCase[]` | — |
| `artifactUses` | `DecisionArtifactCalculatedFieldUse[]` | — |

Índices y restricciones:

- `unique([calculatedFieldId, versionNumber])`
- `index([calculatedFieldId, status])`

## CalibrationBucket

Tabla `calibration_bucket`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `tenantId` | `BigInt` | @map("tenant_id") |
| `artifactVersionId` | `BigInt` | @map("artifact_version_id") |
| `windowDays` | `Int` | @map("window_days") |
| `decile` | `Int` | — |
| `predictedRate` | `Decimal` | @map("predicted_rate") @db.Decimal(9, 8) |
| `observedRate` | `Decimal` | @map("observed_rate") @db.Decimal(9, 8) |
| `sampleSize` | `Int` | @map("sample_size") |
| `computedAt` | `DateTime` | @default(now()) @map("computed_at") @db.Timestamptz(6) |
| `artifactVersion` | `DecisionArtifactVersion` | @relation(fields: [artifactVersionId], references: [id], onDelete: Cascade) |

Índices y restricciones:

- `unique([artifactVersionId, windowDays, decile])`
- `index([tenantId, computedAt])`

## CreditFacility

Tabla `credit_facility`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `tenantId` | `BigInt` | @map("tenant_id") |
| `subjectId` | `BigInt` | @map("subject_id") |
| `externalReference` | `String` | @map("external_reference") @db.VarChar(160) |
| `originationExecutionId` | `BigInt?` | @map("origination_execution_id") |
| `principalAmount` | `Decimal` | @map("principal_amount") @db.Decimal(18, 4) |
| `currencyCode` | `String` | @map("currency_code") @db.VarChar(3) |
| `termMonths` | `Int` | @map("term_months") |
| `annualRate` | `Decimal` | @map("annual_rate") @db.Decimal(9, 6) |
| `disbursedAt` | `DateTime?` | @map("disbursed_at") @db.Timestamptz(6) |
| `closedAt` | `DateTime?` | @map("closed_at") @db.Timestamptz(6) |
| `createdAt` | `DateTime` | @default(now()) @map("created_at") @db.Timestamptz(6) |
| `subject` | `DecisionSubject` | @relation(fields: [subjectId], references: [id], onDelete: Restrict) |
| `observations` | `DecisionOutcomeObservation[]` | — |
| `windows` | `OutcomeWindowSchedule[]` | — |

Índices y restricciones:

- `unique([tenantId, externalReference])`
- `index([tenantId, subjectId])`
- `index([tenantId, disbursedAt])`

## DecisionAccessAudit

Tabla `decision_access_audit`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `requestId` | `String` | @map("request_id") @db.VarChar(120) |
| `principalId` | `String?` | @map("principal_id") @db.VarChar(160) |
| `tenantId` | `BigInt?` | @map("tenant_id") |
| `resource` | `String` | @db.VarChar(160) |
| `action` | `String` | @db.VarChar(80) |
| `decision` | `String` | @db.VarChar(20) |
| `reason` | `String?` | @db.VarChar(200) |
| `ipAddress` | `String?` | @map("ip_address") @db.VarChar(64) |
| `status` | `Int?` | — |
| `occurredAt` | `DateTime` | @default(now()) @map("occurred_at") @db.Timestamptz(6) |

Índices y restricciones:

- `index([tenantId, occurredAt])`
- `index([decision, occurredAt])`

## DecisionActionReasonMapping

Tabla `decision_action_reason_mapping`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `actionId` | `BigInt` | @map("action_id") |
| `reasonCodeId` | `BigInt` | @map("reason_code_id") |
| `priority` | `Int` | @default(100) |
| `messageTemplateJson` | `Json?` | @map("message_template_json") |
| `action` | `DecisionRuleAction` | @relation(fields: [actionId], references: [id], onDelete: Cascade) |
| `reasonCode` | `DecisionReasonCode` | @relation(fields: [reasonCodeId], references: [id], onDelete: Restrict) |

Índices y restricciones:

- `unique([actionId, reasonCodeId])`

## DecisionApprovalDecision

Tabla `decision_approval_decision`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `approvalStepId` | `BigInt` | @map("approval_step_id") |
| `decidedBy` | `String` | @map("decided_by") @db.VarChar(160) |
| `decision` | `ApprovalOutcome` | — |
| `comments` | `String?` | @db.Text |
| `decidedAt` | `DateTime` | @default(now()) @map("decided_at") @db.Timestamptz(6) |
| `approvalStep` | `DecisionApprovalStep` | @relation(fields: [approvalStepId], references: [id], onDelete: Cascade) |
| `evidence` | `DecisionApprovalEvidence[]` | — |

Índices y restricciones:

- `unique([approvalStepId, decidedBy])`

## DecisionApprovalEvidence

Tabla `decision_approval_evidence`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `approvalDecisionId` | `BigInt` | @map("approval_decision_id") |
| `evidenceType` | `String` | @map("evidence_type") @db.VarChar(50) |
| `uri` | `String` | @db.Text |
| `checksum` | `String` | @db.VarChar(128) |
| `metadataJson` | `Json?` | @map("metadata_json") |
| `approvalDecision` | `DecisionApprovalDecision` | @relation(fields: [approvalDecisionId], references: [id], onDelete: Cascade) |

## DecisionApprovalRequest

Tabla `decision_approval_request`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `artifactVersionId` | `BigInt` | @map("artifact_version_id") |
| `workflowCode` | `String` | @map("workflow_code") @db.VarChar(100) |
| `requestedBy` | `String` | @map("requested_by") @db.VarChar(160) |
| `requestedAt` | `DateTime` | @default(now()) @map("requested_at") @db.Timestamptz(6) |
| `status` | `ApprovalRequestStatus` | @default(IN_REVIEW) |
| `dueAt` | `DateTime?` | @map("due_at") @db.Timestamptz(6) |
| `artifactVersion` | `DecisionArtifactVersion` | @relation(fields: [artifactVersionId], references: [id], onDelete: Cascade) |
| `steps` | `DecisionApprovalStep[]` | — |

Índices y restricciones:

- `index([artifactVersionId, status])`

## DecisionApprovalStep

Tabla `decision_approval_step`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `approvalRequestId` | `BigInt` | @map("approval_request_id") |
| `stepOrder` | `Int` | @map("step_order") |
| `requiredRole` | `String` | @map("required_role") @db.VarChar(80) |
| `minApprovals` | `Int` | @default(1) @map("min_approvals") |
| `status` | `ApprovalStepStatus` | @default(PENDING) |
| `separationOfDuties` | `Boolean` | @default(true) @map("separation_of_duties") |
| `approvalRequest` | `DecisionApprovalRequest` | @relation(fields: [approvalRequestId], references: [id], onDelete: Cascade) |
| `decisions` | `DecisionApprovalDecision[]` | — |

Índices y restricciones:

- `unique([approvalRequestId, stepOrder])`

## DecisionArtifact

Tabla `decision_artifact`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `tenantId` | `BigInt` | @map("tenant_id") |
| `artifactCode` | `String` | @map("artifact_code") @db.VarChar(100) |
| `artifactType` | `String` | @map("artifact_type") @db.VarChar(50) |
| `name` | `String` | @db.VarChar(160) |
| `description` | `String?` | @db.Text |
| `ownerTeam` | `String` | @map("owner_team") @db.VarChar(100) |
| `businessPurpose` | `String` | @map("business_purpose") @db.Text |
| `riskDomain` | `String` | @map("risk_domain") @db.VarChar(50) |
| `decisionKind` | `DecisionKind` | @default(ORIGINATION) @map("decision_kind") |
| `isActive` | `Boolean` | @default(true) @map("is_active") |
| `createdAt` | `DateTime` | @default(now()) @map("created_at") @db.Timestamptz(6) |
| `updatedAt` | `DateTime` | @updatedAt @map("updated_at") @db.Timestamptz(6) |
| `versions` | `DecisionArtifactVersion[]` | — |

Índices y restricciones:

- `unique([tenantId, artifactCode])`
- `index([tenantId, isActive])`

## DecisionArtifactCalculatedFieldUse

Tabla `decision_artifact_calculated_field_use`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `tenantId` | `BigInt` | @map("tenant_id") |
| `artifactVersionId` | `BigInt` | @map("artifact_version_id") |
| `nodeKey` | `String` | @map("node_key") @db.VarChar(120) |
| `callKey` | `String` | @map("call_key") @db.VarChar(120) |
| `calculatedFieldVersionId` | `BigInt` | @map("calculated_field_version_id") |
| `inputMappingJson` | `Json` | @map("input_mapping_json") |
| `targetKind` | `String` | @map("target_kind") @db.VarChar(20) |
| `targetCode` | `String` | @map("target_code") @db.VarChar(120) |
| `definitionJson` | `Json` | @map("definition_json") |
| `createdAt` | `DateTime` | @default(now()) @map("created_at") @db.Timestamptz(6) |
| `artifactVersion` | `DecisionArtifactVersion` | @relation(fields: [artifactVersionId], references: [id], onDelete: Cascade) |
| `calculatedFieldVersion` | `CalculatedFieldVersion` | @relation(fields: [calculatedFieldVersionId], references: [id], onDelete: Restrict) |

Índices y restricciones:

- `unique([artifactVersionId, nodeKey, callKey])`
- `index([tenantId, calculatedFieldVersionId])`

## DecisionArtifactReference

Tabla `decision_artifact_reference`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `tenantId` | `BigInt` | @map("tenant_id") |
| `parentArtifactVersionId` | `BigInt` | @map("parent_artifact_version_id") |
| `nodeKey` | `String` | @map("node_key") @db.VarChar(120) |
| `childArtifactId` | `BigInt` | @map("child_artifact_id") |
| `childArtifactVersionId` | `BigInt` | @map("child_artifact_version_id") |
| `inputMappingJson` | `Json` | @map("input_mapping_json") |
| `outputMappingJson` | `Json` | @map("output_mapping_json") |
| `timeoutMs` | `Int` | @default(2000) @map("timeout_ms") |
| `onErrorPolicy` | `ArtifactReferenceErrorPolicy` | @default(FAIL) @map("on_error_policy") |
| `fallbackOutputJson` | `Json?` | @map("fallback_output_json") |
| `environmentCode` | `String?` | @map("environment_code") @db.VarChar(40) |
| `versionSelection` | `ArtifactVersionSelection` | @default(EXACT) @map("version_selection") |
| `maxRetries` | `Int` | @default(0) @map("max_retries") |
| `retryDelayMs` | `Int` | @default(0) @map("retry_delay_ms") |
| `executionConditionJson` | `Json?` | @map("execution_condition_json") |
| `isRequired` | `Boolean` | @default(true) @map("is_required") |
| `tracePolicy` | `TracePolicy` | @default(FULL) @map("trace_policy") |
| `requiredRole` | `String?` | @map("required_role") @db.VarChar(80) |
| `createdBy` | `String` | @map("created_by") @db.VarChar(160) |
| `createdAt` | `DateTime` | @default(now()) @map("created_at") @db.Timestamptz(6) |
| `updatedAt` | `DateTime` | @updatedAt @map("updated_at") @db.Timestamptz(6) |

Índices y restricciones:

- `unique([parentArtifactVersionId, nodeKey])`
- `index([tenantId, childArtifactId])`
- `index([childArtifactVersionId])`

## DecisionArtifactVariableDependency

Tabla `decision_artifact_variable_dependency`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `artifactVersionId` | `BigInt` | @map("artifact_version_id") |
| `variableVersionId` | `BigInt` | @map("variable_version_id") |
| `usageType` | `String` | @map("usage_type") @db.VarChar(50) |
| `isRequired` | `Boolean` | @default(true) @map("is_required") |
| `fallbackPolicy` | `String` | @map("fallback_policy") @db.VarChar(50) |
| `dependencyPath` | `String` | @map("dependency_path") @db.VarChar(500) |
| `freshnessPolicy` | `FreshnessPolicy` | @default(DEGRADE) @map("freshness_policy") |
| `artifactVersion` | `DecisionArtifactVersion` | @relation(fields: [artifactVersionId], references: [id], onDelete: Cascade) |
| `variableVersion` | `DecisionVariableVersion` | @relation(fields: [variableVersionId], references: [id], onDelete: Restrict) |

Índices y restricciones:

- `unique([artifactVersionId, variableVersionId, dependencyPath])`

## DecisionArtifactVersion

Tabla `decision_artifact_version`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `artifactId` | `BigInt` | @map("artifact_id") |
| `versionNumber` | `Int` | @map("version_number") |
| `status` | `VersionStatus` | @default(DRAFT) |
| `sourceVersionId` | `BigInt?` | @map("source_version_id") |
| `semanticVersion` | `String` | @map("semantic_version") @db.VarChar(40) |
| `changeSummary` | `String?` | @map("change_summary") @db.Text |
| `authoringNotes` | `String?` | @map("authoring_notes") @db.Text |
| `canonicalChecksum` | `String?` | @map("canonical_checksum") @db.VarChar(128) |
| `lockVersion` | `Int` | @default(1) @map("lock_version") |
| `processingPurpose` | `String?` | @map("processing_purpose") @db.Text |
| `legalBasis` | `ProcessingLegalBasis?` | @map("legal_basis") |
| `subjectReferencePolicy` | `SubjectReferencePolicy?` | @map("subject_reference_policy") |
| `subjectPolicyJustification` | `String?` | @map("subject_policy_justification") @db.Text |
| `validatedBy` | `String?` | @map("validated_by") @db.VarChar(160) |
| `validatedAt` | `DateTime?` | @map("validated_at") @db.Timestamptz(6) |
| `revalidationDueAt` | `DateTime?` | @map("revalidation_due_at") @db.Timestamptz(6) |
| `limitationsNotes` | `String?` | @map("limitations_notes") @db.Text |
| `createdBy` | `String` | @map("created_by") @db.VarChar(160) |
| `createdAt` | `DateTime` | @default(now()) @map("created_at") @db.Timestamptz(6) |
| `submittedAt` | `DateTime?` | @map("submitted_at") @db.Timestamptz(6) |
| `approvedAt` | `DateTime?` | @map("approved_at") @db.Timestamptz(6) |
| `retiredAt` | `DateTime?` | @map("retired_at") @db.Timestamptz(6) |
| `artifact` | `DecisionArtifact` | @relation(fields: [artifactId], references: [id], onDelete: Cascade) |
| `sourceVersion` | `DecisionArtifactVersion?` | @relation("VersionSource", fields: [sourceVersionId], references: [id], onDelete: SetNull) |
| `derivedVersions` | `DecisionArtifactVersion[]` | @relation("VersionSource") |
| `compiledArtifacts` | `DecisionCompiledArtifact[]` | — |
| `statusHistory` | `DecisionVersionStatusHistory[]` | — |
| `variableDependencies` | `DecisionArtifactVariableDependency[]` | — |
| `nodes` | `DecisionRuleNode[]` | — |
| `edges` | `DecisionRuleEdge[]` | — |
| `conditions` | `DecisionRuleCondition[]` | — |
| `actions` | `DecisionRuleAction[]` | — |
| `approvalRequests` | `DecisionApprovalRequest[]` | — |
| `testSuites` | `DecisionTestSuite[]` | — |
| `deployments` | `DecisionDeployment[]` | — |
| `executions` | `DecisionExecution[]` | — |
| `changeLogs` | `DecisionChangeLog[]` | — |
| `policyLinks` | `PolicyArtifactLink[]` | — |
| `nodeScripts` | `DecisionNodeScript[]` | — |
| `intermediateVariables` | `DecisionIntermediateVariable[]` | — |
| `outputContractFields` | `DecisionOutputContractField[]` | — |
| `calculatedFieldUses` | `DecisionArtifactCalculatedFieldUse[]` | — |
| `qaGenerationRuns` | `QaGenerationRun[]` | — |
| `monitoringBaselines` | `MonitoringBaseline[]` | — |
| `monitoringEvaluations` | `MonitoringEvaluation[]` | — |
| `calibrationBuckets` | `CalibrationBucket[]` | — |

Índices y restricciones:

- `unique([artifactId, versionNumber])`
- `index([artifactId, status])`

## DecisionAuditEvent

Tabla `decision_audit_event`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `tenantId` | `BigInt` | @map("tenant_id") |
| `eventType` | `String` | @map("event_type") @db.VarChar(100) |
| `aggregateType` | `String` | @map("aggregate_type") @db.VarChar(100) |
| `aggregateId` | `String` | @map("aggregate_id") @db.VarChar(160) |
| `actorId` | `String` | @map("actor_id") @db.VarChar(160) |
| `requestId` | `String?` | @map("request_id") @db.VarChar(120) |
| `payloadJson` | `Json` | @map("payload_json") |
| `previousHash` | `String?` | @map("previous_hash") @db.VarChar(128) |
| `eventHash` | `String` | @map("event_hash") @db.VarChar(128) |
| `hashKeyId` | `String` | @default("v1") @map("hash_key_id") @db.VarChar(40) |
| `canonicalPayload` | `String?` | @map("canonical_payload") @db.Text |
| `occurredAt` | `DateTime` | @default(now()) @map("occurred_at") @db.Timestamptz(6) |

Índices y restricciones:

- `index([tenantId, occurredAt])`
- `index([aggregateType, aggregateId])`
- `index([tenantId, id])`

## DecisionChangeLog

Tabla `decision_change_log`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `artifactVersionId` | `BigInt` | @map("artifact_version_id") |
| `entityType` | `String` | @map("entity_type") @db.VarChar(80) |
| `entityId` | `String` | @map("entity_id") @db.VarChar(160) |
| `operation` | `String` | @db.VarChar(30) |
| `fieldName` | `String?` | @map("field_name") @db.VarChar(160) |
| `oldValueJson` | `Json?` | @map("old_value_json") |
| `newValueJson` | `Json?` | @map("new_value_json") |
| `changedBy` | `String` | @map("changed_by") @db.VarChar(160) |
| `changedAt` | `DateTime` | @default(now()) @map("changed_at") @db.Timestamptz(6) |
| `artifactVersion` | `DecisionArtifactVersion` | @relation(fields: [artifactVersionId], references: [id], onDelete: Cascade) |

Índices y restricciones:

- `index([artifactVersionId, changedAt])`

## DecisionCodeImport

Tabla `decision_code_import`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `tenantId` | `BigInt` | @map("tenant_id") |
| `artifactId` | `BigInt?` | @map("artifact_id") |
| `artifactVersionId` | `BigInt?` | @map("artifact_version_id") |
| `language` | `String` | @db.VarChar(30) |
| `sourceCode` | `String` | @map("source_code") @db.Text |
| `sourceChecksum` | `String` | @map("source_checksum") @db.VarChar(128) |
| `contractVersion` | `String` | @map("contract_version") @db.VarChar(20) |
| `contractJson` | `Json` | @map("contract_json") |
| `irJson` | `Json` | @map("ir_json") |
| `issuesJson` | `Json` | @map("issues_json") |
| `status` | `CodeImportStatus` | @default(ANALYZED) |
| `createdBy` | `String` | @map("created_by") @db.VarChar(160) |
| `createdAt` | `DateTime` | @default(now()) @map("created_at") @db.Timestamptz(6) |
| `updatedAt` | `DateTime` | @updatedAt @map("updated_at") @db.Timestamptz(6) |

Índices y restricciones:

- `index([tenantId, status, createdAt])`
- `index([artifactVersionId])`

## DecisionCompiledArtifact

Tabla `decision_compiled_artifact`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `artifactVersionId` | `BigInt` | @map("artifact_version_id") |
| `compilerVersion` | `String` | @map("compiler_version") @db.VarChar(50) |
| `runtimeSchemaVersion` | `String` | @map("runtime_schema_version") @db.VarChar(50) |
| `compiledPayloadJson` | `Json` | @map("compiled_payload_json") |
| `compiledChecksum` | `String` | @map("compiled_checksum") @db.VarChar(128) |
| `compileStatus` | `CompileStatus` | @map("compile_status") |
| `compiledAt` | `DateTime` | @default(now()) @map("compiled_at") @db.Timestamptz(6) |
| `artifactVersion` | `DecisionArtifactVersion` | @relation(fields: [artifactVersionId], references: [id], onDelete: Cascade) |
| `testRuns` | `DecisionTestRun[]` | — |
| `deployments` | `DecisionDeployment[]` | — |

Índices y restricciones:

- `unique([artifactVersionId, compiledChecksum])`
- `index([artifactVersionId, compiledAt])`

## DecisionDataSubjectRequest

Tabla `decision_data_subject_request`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `tenantId` | `BigInt` | @map("tenant_id") |
| `subjectReferenceHash` | `String` | @map("subject_reference_hash") @db.VarChar(128) |
| `requestType` | `DataSubjectRequestType` | @map("request_type") |
| `status` | `DataSubjectRequestStatus` | @default(RECEIVED) |
| `receivedBy` | `String` | @map("received_by") @db.VarChar(160) |
| `reference` | `String?` | @db.VarChar(200) |
| `resolutionJson` | `Json?` | @map("resolution_json") |
| `createdAt` | `DateTime` | @default(now()) @map("created_at") @db.Timestamptz(6) |
| `resolvedAt` | `DateTime?` | @map("resolved_at") @db.Timestamptz(6) |

Índices y restricciones:

- `index([tenantId, subjectReferenceHash, createdAt])`
- `index([tenantId, status, createdAt])`

## DecisionDeployment

Tabla `decision_deployment`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `artifactVersionId` | `BigInt` | @map("artifact_version_id") |
| `compiledArtifactId` | `BigInt` | @map("compiled_artifact_id") |
| `environmentId` | `BigInt` | @map("environment_id") |
| `deploymentMode` | `String` | @map("deployment_mode") @db.VarChar(50) |
| `deploymentStatus` | `DeploymentStatus` | @map("deployment_status") |
| `effectiveFrom` | `DateTime` | @map("effective_from") @db.Timestamptz(6) |
| `effectiveTo` | `DateTime?` | @map("effective_to") @db.Timestamptz(6) |
| `isActive` | `Boolean` | @default(false) @map("is_active") |
| `previousDeploymentId` | `BigInt?` | @map("previous_deployment_id") |
| `rollbackOfDeploymentId` | `BigInt?` | @map("rollback_of_deployment_id") |
| `deployedBy` | `String` | @map("deployed_by") @db.VarChar(160) |
| `deployedAt` | `DateTime` | @default(now()) @map("deployed_at") @db.Timestamptz(6) |
| `artifactVersion` | `DecisionArtifactVersion` | @relation(fields: [artifactVersionId], references: [id], onDelete: Restrict) |
| `compiledArtifact` | `DecisionCompiledArtifact` | @relation(fields: [compiledArtifactId], references: [id], onDelete: Restrict) |
| `environment` | `DecisionEnvironment` | @relation(fields: [environmentId], references: [id], onDelete: Restrict) |
| `previousDeployment` | `DecisionDeployment?` | @relation("PreviousDeployment", fields: [previousDeploymentId], references: [id], onDelete: SetNull) |
| `nextDeployments` | `DecisionDeployment[]` | @relation("PreviousDeployment") |
| `rollbackOf` | `DecisionDeployment?` | @relation("RollbackDeployment", fields: [rollbackOfDeploymentId], references: [id], onDelete: SetNull) |
| `rollbackDeployments` | `DecisionDeployment[]` | @relation("RollbackDeployment") |
| `traffic` | `DecisionDeploymentTraffic[]` | — |
| `bindings` | `DecisionRuntimeBinding[]` | — |
| `executions` | `DecisionExecution[]` | — |

Índices y restricciones:

- `index([artifactVersionId, environmentId, isActive])`
- `index([environmentId, deploymentStatus])`

## DecisionDeploymentTraffic

Tabla `decision_deployment_traffic`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `deploymentId` | `BigInt` | @map("deployment_id") |
| `segmentKey` | `String` | @map("segment_key") @db.VarChar(100) |
| `trafficPercentage` | `Decimal` | @map("traffic_percentage") @db.Decimal(5, 2) |
| `routingExpressionJson` | `Json?` | @map("routing_expression_json") |
| `priority` | `Int` | @default(100) |
| `deployment` | `DecisionDeployment` | @relation(fields: [deploymentId], references: [id], onDelete: Cascade) |

Índices y restricciones:

- `unique([deploymentId, segmentKey])`

## DecisionEdgeCondition

Tabla `decision_edge_condition`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `edgeId` | `BigInt` | @map("edge_id") |
| `conditionId` | `BigInt` | @map("condition_id") |
| `evaluationOrder` | `Int` | @default(1) @map("evaluation_order") |
| `edge` | `DecisionRuleEdge` | @relation(fields: [edgeId], references: [id], onDelete: Cascade) |
| `condition` | `DecisionRuleCondition` | @relation(fields: [conditionId], references: [id], onDelete: Cascade) |

Índices y restricciones:

- `unique([edgeId, conditionId])`

## DecisionEnvironment

Tabla `decision_environment`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `code` | `String` | @unique @db.VarChar(40) |
| `name` | `String` | @db.VarChar(120) |
| `environmentType` | `String` | @map("environment_type") @db.VarChar(40) |
| `status` | `String` | @default("ACTIVE") @db.VarChar(30) |
| `isProduction` | `Boolean` | @default(false) @map("is_production") |
| `createdAt` | `DateTime` | @default(now()) @map("created_at") @db.Timestamptz(6) |
| `subjectReferencePolicy` | `SubjectReferencePolicy` | @default(WARN) @map("subject_reference_policy") |
| `deployments` | `DecisionDeployment[]` | — |
| `bindings` | `DecisionRuntimeBinding[]` | — |
| `executions` | `DecisionExecution[]` | — |

## DecisionExecution

Tabla `decision_execution`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `tenantId` | `BigInt` | @map("tenant_id") |
| `deploymentId` | `BigInt` | @map("deployment_id") |
| `artifactVersionId` | `BigInt` | @map("artifact_version_id") |
| `environmentId` | `BigInt` | @map("environment_id") |
| `requestId` | `String` | @map("request_id") @db.VarChar(120) |
| `correlationId` | `String?` | @map("correlation_id") @db.VarChar(120) |
| `idempotencyKey` | `String` | @map("idempotency_key") @db.VarChar(160) |
| `subjectReferenceHash` | `String?` | @map("subject_reference_hash") @db.VarChar(128) |
| `subjectId` | `BigInt?` | @map("subject_id") |
| `subjectAbsenceReason` | `SubjectReferencePolicy?` | @map("subject_absence_reason") |
| `degradedInputs` | `Boolean` | @default(false) @map("degraded_inputs") |
| `inputSnapshotJson` | `Json` | @map("input_snapshot_json") |
| `outputJson` | `Json?` | @map("output_json") |
| `decisionStatus` | `ExecutionStatus` | @map("decision_status") |
| `businessOutcome` | `String?` | @map("business_outcome") @db.VarChar(80) |
| `durationMs` | `Int` | @map("duration_ms") |
| `executedAt` | `DateTime` | @default(now()) @map("executed_at") @db.Timestamptz(6) |
| `deployment` | `DecisionDeployment` | @relation(fields: [deploymentId], references: [id], onDelete: Restrict) |
| `artifactVersion` | `DecisionArtifactVersion` | @relation(fields: [artifactVersionId], references: [id], onDelete: Restrict) |
| `environment` | `DecisionEnvironment` | @relation(fields: [environmentId], references: [id], onDelete: Restrict) |
| `subject` | `DecisionSubject?` | @relation(fields: [subjectId], references: [id], onDelete: SetNull) |
| `variables` | `DecisionExecutionVariable[]` | — |
| `steps` | `DecisionExecutionStep[]` | — |
| `reasons` | `DecisionExecutionReason[]` | — |
| `errors` | `DecisionExecutionError[]` | — |
| `manualReview` | `DecisionManualReviewCase?` | — |
| `outcomeObservations` | `DecisionOutcomeObservation[]` | — |
| `monitoringAttributes` | `DecisionMonitoringAttribute[]` | — |
| `outcomeWindows` | `OutcomeWindowSchedule[]` | — |

Índices y restricciones:

- `unique([tenantId, requestId])`
- `index([tenantId, executedAt])`
- `index([artifactVersionId, executedAt])`
- `index([tenantId, subjectId, executedAt])`
- `index([tenantId, subjectReferenceHash])`

## DecisionExecutionError

Tabla `decision_execution_error`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `executionId` | `BigInt` | @map("execution_id") |
| `errorCode` | `String` | @map("error_code") @db.VarChar(120) |
| `errorType` | `String` | @map("error_type") @db.VarChar(80) |
| `errorMessage` | `String` | @map("error_message") @db.Text |
| `retryable` | `Boolean` | @default(false) |
| `detailsJson` | `Json?` | @map("details_json") |
| `execution` | `DecisionExecution` | @relation(fields: [executionId], references: [id], onDelete: Cascade) |

## DecisionExecutionReason

Tabla `decision_execution_reason`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `executionId` | `BigInt` | @map("execution_id") |
| `reasonCodeId` | `BigInt` | @map("reason_code_id") |
| `sourceActionId` | `BigInt` | @map("source_action_id") |
| `priority` | `Int` | @default(100) |
| `renderedMessage` | `String` | @map("rendered_message") @db.Text |
| `execution` | `DecisionExecution` | @relation(fields: [executionId], references: [id], onDelete: Cascade) |
| `reasonCode` | `DecisionReasonCode` | @relation(fields: [reasonCodeId], references: [id], onDelete: Restrict) |
| `sourceAction` | `DecisionRuleAction` | @relation(fields: [sourceActionId], references: [id], onDelete: Restrict) |

## DecisionExecutionStep

Tabla `decision_execution_step`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `executionId` | `BigInt` | @map("execution_id") |
| `nodeId` | `BigInt` | @map("node_id") |
| `stepOrder` | `Int` | @map("step_order") |
| `evaluationResultJson` | `Json` | @map("evaluation_result_json") |
| `branchTaken` | `String?` | @map("branch_taken") @db.VarChar(120) |
| `durationUs` | `BigInt` | @map("duration_us") |
| `execution` | `DecisionExecution` | @relation(fields: [executionId], references: [id], onDelete: Cascade) |
| `node` | `DecisionRuleNode` | @relation(fields: [nodeId], references: [id], onDelete: Restrict) |

Índices y restricciones:

- `unique([executionId, stepOrder])`

## DecisionExecutionTreeLink

Tabla `decision_execution_tree_link`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `tenantId` | `BigInt` | @map("tenant_id") |
| `rootExecutionId` | `BigInt` | @map("root_execution_id") |
| `parentExecutionId` | `BigInt` | @map("parent_execution_id") |
| `sequence` | `Int` | — |
| `parentSequence` | `Int?` | @map("parent_sequence") |
| `nodeKey` | `String` | @map("node_key") @db.VarChar(120) |
| `childArtifactVersionId` | `BigInt?` | @map("child_artifact_version_id") |
| `childExecutionId` | `BigInt?` | @map("child_execution_id") |
| `depth` | `Int` | — |
| `status` | `String` | @db.VarChar(30) |
| `durationMs` | `Int` | @map("duration_ms") |
| `outputJson` | `Json?` | @map("output_json") |
| `errorJson` | `Json?` | @map("error_json") |
| `createdAt` | `DateTime` | @default(now()) @map("created_at") @db.Timestamptz(6) |

Índices y restricciones:

- `unique([rootExecutionId, sequence])`
- `index([tenantId, rootExecutionId])`
- `index([parentExecutionId, nodeKey])`

## DecisionExecutionVariable

Tabla `decision_execution_variable`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `executionId` | `BigInt` | @map("execution_id") |
| `variableVersionId` | `BigInt` | @map("variable_version_id") |
| `valueJson` | `Json?` | @map("value_json") |
| `valueHash` | `String` | @map("value_hash") @db.VarChar(128) |
| `sourceCode` | `String` | @map("source_code") @db.VarChar(100) |
| `resolutionStatus` | `String` | @map("resolution_status") @db.VarChar(50) |
| `wasDefaulted` | `Boolean` | @default(false) @map("was_defaulted") |
| `observedAt` | `DateTime?` | @map("observed_at") @db.Timestamptz(6) |
| `fetchedAt` | `DateTime?` | @map("fetched_at") @db.Timestamptz(6) |
| `sourceVersion` | `String?` | @map("source_version") @db.VarChar(60) |
| `ageSeconds` | `Int?` | @map("age_seconds") |
| `staleAccepted` | `Boolean` | @default(false) @map("stale_accepted") |
| `execution` | `DecisionExecution` | @relation(fields: [executionId], references: [id], onDelete: Cascade) |
| `variableVersion` | `DecisionVariableVersion` | @relation(fields: [variableVersionId], references: [id], onDelete: Restrict) |

Índices y restricciones:

- `unique([executionId, variableVersionId])`

## DecisionIntermediateVariable

Tabla `decision_intermediate_variable`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `tenantId` | `BigInt` | @map("tenant_id") |
| `artifactVersionId` | `BigInt` | @map("artifact_version_id") |
| `code` | `String` | @db.VarChar(120) |
| `name` | `String` | @db.VarChar(160) |
| `description` | `String` | @db.Text |
| `dataType` | `String` | @map("data_type") @db.VarChar(40) |
| `producerNodeKey` | `String` | @map("producer_node_key") @db.VarChar(120) |
| `consumerNodeKeys` | `String[]` | @map("consumer_node_keys") |
| `initialValueJson` | `Json?` | @map("initial_value_json") |
| `constraintsJson` | `Json?` | @map("constraints_json") |
| `nullable` | `Boolean` | @default(true) |
| `updatePolicy` | `IntermediateUpdatePolicy` | @default(SINGLE_WRITE) @map("update_policy") |
| `availabilityConditionJson` | `Json?` | @map("availability_condition_json") |
| `sensitivityClass` | `SensitivityClass` | @default(INTERNAL) @map("sensitivity_class") |
| `tracePolicy` | `TracePolicy` | @default(FULL) @map("trace_policy") |
| `createdAt` | `DateTime` | @default(now()) @map("created_at") @db.Timestamptz(6) |
| `updatedAt` | `DateTime` | @updatedAt @map("updated_at") @db.Timestamptz(6) |
| `artifactVersion` | `DecisionArtifactVersion` | @relation(fields: [artifactVersionId], references: [id], onDelete: Cascade) |

Índices y restricciones:

- `unique([artifactVersionId, code])`
- `index([tenantId, artifactVersionId])`

## DecisionManualReviewCase

Tabla `decision_manual_review_case`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `executionId` | `BigInt` | @unique @map("execution_id") |
| `tenantId` | `BigInt` | @map("tenant_id") |
| `caseCode` | `String` | @unique @map("case_code") @db.VarChar(80) |
| `queueCode` | `String` | @map("queue_code") @db.VarChar(80) |
| `priority` | `Int` | @default(100) |
| `status` | `ManualReviewStatus` | @default(OPEN) |
| `assignedTo` | `String?` | @map("assigned_to") @db.VarChar(160) |
| `dueAt` | `DateTime` | @map("due_at") @db.Timestamptz(6) |
| `evidenceJson` | `Json` | @map("evidence_json") |
| `resolutionJson` | `Json?` | @map("resolution_json") |
| `createdAt` | `DateTime` | @default(now()) @map("created_at") @db.Timestamptz(6) |
| `resolvedAt` | `DateTime?` | @map("resolved_at") @db.Timestamptz(6) |
| `execution` | `DecisionExecution` | @relation(fields: [executionId], references: [id], onDelete: Cascade) |

Índices y restricciones:

- `index([tenantId, status, priority])`

## DecisionMonitoringAttribute

Tabla `decision_monitoring_attribute`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `tenantId` | `BigInt` | @map("tenant_id") |
| `executionId` | `BigInt` | @map("execution_id") |
| `attribute` | `String` | @db.VarChar(80) |
| `groupValue` | `String` | @map("group_value") @db.VarChar(80) |
| `recordedAt` | `DateTime` | @default(now()) @map("recorded_at") @db.Timestamptz(6) |
| `recordedBy` | `String` | @map("recorded_by") @db.VarChar(160) |
| `execution` | `DecisionExecution` | @relation(fields: [executionId], references: [id], onDelete: Cascade) |

Índices y restricciones:

- `unique([executionId, attribute])`
- `index([tenantId, attribute, recordedAt])`

## DecisionNodeAction

Tabla `decision_node_action`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `nodeId` | `BigInt` | @map("node_id") |
| `actionId` | `BigInt` | @map("action_id") |
| `executionOrder` | `Int` | @default(1) @map("execution_order") |
| `node` | `DecisionRuleNode` | @relation(fields: [nodeId], references: [id], onDelete: Cascade) |
| `action` | `DecisionRuleAction` | @relation(fields: [actionId], references: [id], onDelete: Cascade) |

Índices y restricciones:

- `unique([nodeId, actionId])`

## DecisionNodeCondition

Tabla `decision_node_condition`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `nodeId` | `BigInt` | @map("node_id") |
| `conditionId` | `BigInt` | @map("condition_id") |
| `evaluationOrder` | `Int` | @default(1) @map("evaluation_order") |
| `expectedBoolean` | `Boolean` | @default(true) @map("expected_boolean") |
| `node` | `DecisionRuleNode` | @relation(fields: [nodeId], references: [id], onDelete: Cascade) |
| `condition` | `DecisionRuleCondition` | @relation(fields: [conditionId], references: [id], onDelete: Cascade) |

Índices y restricciones:

- `unique([nodeId, conditionId])`

## DecisionNodeScript

Tabla `decision_node_script`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `tenantId` | `BigInt` | @map("tenant_id") |
| `artifactVersionId` | `BigInt` | @map("artifact_version_id") |
| `nodeKey` | `String` | @map("node_key") @db.VarChar(120) |
| `language` | `String` | @db.VarChar(30) |
| `sourceCode` | `String` | @map("source_code") @db.Text |
| `sourceChecksum` | `String` | @map("source_checksum") @db.VarChar(128) |
| `inputVariablesJson` | `Json` | @map("input_variables_json") |
| `outputVariablesJson` | `Json` | @map("output_variables_json") |
| `createdBy` | `String` | @map("created_by") @db.VarChar(160) |
| `createdAt` | `DateTime` | @default(now()) @map("created_at") @db.Timestamptz(6) |
| `updatedAt` | `DateTime` | @updatedAt @map("updated_at") @db.Timestamptz(6) |
| `artifactVersion` | `DecisionArtifactVersion` | @relation(fields: [artifactVersionId], references: [id], onDelete: Cascade) |

Índices y restricciones:

- `unique([artifactVersionId, nodeKey])`
- `index([tenantId, language])`

## DecisionOutboxEvent

Tabla `decision_outbox_event`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `tenantId` | `BigInt` | @map("tenant_id") |
| `eventType` | `String` | @map("event_type") @db.VarChar(120) |
| `schemaVersion` | `String` | @default("1") @map("schema_version") @db.VarChar(20) |
| `aggregateType` | `String` | @map("aggregate_type") @db.VarChar(100) |
| `aggregateId` | `String` | @map("aggregate_id") @db.VarChar(160) |
| `actorId` | `String` | @map("actor_id") @db.VarChar(160) |
| `correlationId` | `String?` | @map("correlation_id") @db.VarChar(120) |
| `causationId` | `String?` | @map("causation_id") @db.VarChar(120) |
| `payloadJson` | `Json` | @map("payload_json") |
| `status` | `OutboxStatus` | @default(PENDING) |
| `attemptCount` | `Int` | @default(0) @map("attempt_count") |
| `availableAt` | `DateTime` | @default(now()) @map("available_at") @db.Timestamptz(6) |
| `leaseExpiresAt` | `DateTime?` | @map("lease_expires_at") @db.Timestamptz(6) |
| `lockedBy` | `String?` | @map("locked_by") @db.VarChar(120) |
| `lastError` | `String?` | @map("last_error") @db.Text |
| `occurredAt` | `DateTime` | @default(now()) @map("occurred_at") @db.Timestamptz(6) |
| `dispatchedAt` | `DateTime?` | @map("dispatched_at") @db.Timestamptz(6) |
| `traceCarrier` | `Json?` | @map("trace_carrier") |

Índices y restricciones:

- `index([status, availableAt])`
- `index([tenantId, occurredAt])`
- `index([aggregateType, aggregateId])`

## DecisionOutcomeObservation

Tabla `decision_outcome_observation`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `tenantId` | `BigInt` | @map("tenant_id") |
| `executionId` | `BigInt` | @map("execution_id") |
| `facilityId` | `BigInt?` | @map("facility_id") |
| `windowDays` | `Int` | @map("window_days") |
| `label` | `ObservedOutcomeLabel` | — |
| `amount` | `Decimal?` | @db.Decimal(18, 4) |
| `source` | `String` | @db.VarChar(120) |
| `inferenceMethod` | `String?` | @map("inference_method") @db.VarChar(60) |
| `notes` | `String?` | @db.Text |
| `observedAt` | `DateTime` | @default(now()) @map("observed_at") @db.Timestamptz(6) |
| `recordedBy` | `String` | @map("recorded_by") @db.VarChar(160) |
| `execution` | `DecisionExecution` | @relation(fields: [executionId], references: [id], onDelete: Cascade) |
| `facility` | `CreditFacility?` | @relation(fields: [facilityId], references: [id], onDelete: SetNull) |

Índices y restricciones:

- `unique([executionId, windowDays])`
- `index([tenantId, observedAt])`
- `index([tenantId, facilityId])`

## DecisionOutputContractField

Tabla `decision_output_contract_field`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `tenantId` | `BigInt` | @map("tenant_id") |
| `artifactVersionId` | `BigInt` | @map("artifact_version_id") |
| `fieldCode` | `String` | @map("field_code") @db.VarChar(120) |
| `name` | `String` | @db.VarChar(160) |
| `description` | `String?` | @db.Text |
| `sourceKind` | `OutputSourceKind` | @map("source_kind") |
| `sourceRef` | `String` | @map("source_ref") @db.VarChar(500) |
| `semanticRole` | `OutputSemanticRole` | @default(NONE) @map("semantic_role") |
| `valueMappingJson` | `Json?` | @map("value_mapping_json") |
| `absenceReasons` | `String[]` | @map("absence_reasons") |
| `exampleJson` | `Json?` | @map("example_json") |
| `contractVersion` | `String` | @default("1") @map("contract_version") @db.VarChar(20) |
| `sensitivityClass` | `SensitivityClass` | @default(INTERNAL) @map("sensitivity_class") |
| `tracePolicy` | `TracePolicy` | @default(FULL) @map("trace_policy") |
| `createdAt` | `DateTime` | @default(now()) @map("created_at") @db.Timestamptz(6) |
| `updatedAt` | `DateTime` | @updatedAt @map("updated_at") @db.Timestamptz(6) |
| `artifactVersion` | `DecisionArtifactVersion` | @relation(fields: [artifactVersionId], references: [id], onDelete: Cascade) |
| `reasonCodes` | `DecisionOutputFieldReasonMap[]` | — |

Índices y restricciones:

- `unique([artifactVersionId, fieldCode])`
- `index([tenantId, artifactVersionId])`

## DecisionOutputFieldReasonMap

Tabla `decision_output_field_reason_map`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `outputFieldId` | `BigInt` | @map("output_field_id") |
| `reasonCodeId` | `BigInt` | @map("reason_code_id") |
| `priority` | `Int` | @default(100) |
| `outputField` | `DecisionOutputContractField` | @relation(fields: [outputFieldId], references: [id], onDelete: Cascade) |
| `reasonCode` | `DecisionReasonCode` | @relation(fields: [reasonCodeId], references: [id], onDelete: Restrict) |

Índices y restricciones:

- `unique([outputFieldId, reasonCodeId])`

## DecisionReasonCode

Tabla `decision_reason_code`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `tenantId` | `BigInt` | @map("tenant_id") |
| `reasonCode` | `String` | @map("reason_code") @db.VarChar(120) |
| `category` | `String` | @db.VarChar(50) |
| `publicMessage` | `String` | @map("public_message") @db.Text |
| `internalMessage` | `String` | @map("internal_message") @db.Text |
| `severity` | `String` | @db.VarChar(30) |
| `isAdverseAction` | `Boolean` | @default(false) @map("is_adverse_action") |
| `isActive` | `Boolean` | @default(true) @map("is_active") |
| `actionMappings` | `DecisionActionReasonMapping[]` | — |
| `executionReasons` | `DecisionExecutionReason[]` | — |
| `outputFieldMappings` | `DecisionOutputFieldReasonMap[]` | — |

Índices y restricciones:

- `unique([tenantId, reasonCode])`
- `index([tenantId, isActive])`

## DecisionRuleAction

Tabla `decision_rule_action`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `artifactVersionId` | `BigInt` | @map("artifact_version_id") |
| `actionCode` | `String` | @map("action_code") @db.VarChar(120) |
| `actionType` | `String` | @map("action_type") @db.VarChar(50) |
| `payloadSchemaJson` | `Json?` | @map("payload_schema_json") |
| `payloadTemplateJson` | `Json` | @map("payload_template_json") |
| `isTerminal` | `Boolean` | @default(false) @map("is_terminal") |
| `artifactVersion` | `DecisionArtifactVersion` | @relation(fields: [artifactVersionId], references: [id], onDelete: Cascade) |
| `nodeActions` | `DecisionNodeAction[]` | — |
| `reasonMappings` | `DecisionActionReasonMapping[]` | — |
| `executionReasons` | `DecisionExecutionReason[]` | — |

Índices y restricciones:

- `unique([artifactVersionId, actionCode])`

## DecisionRuleCondition

Tabla `decision_rule_condition`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `artifactVersionId` | `BigInt` | @map("artifact_version_id") |
| `conditionCode` | `String` | @map("condition_code") @db.VarChar(120) |
| `name` | `String` | @db.VarChar(200) |
| `expressionType` | `String` | @map("expression_type") @db.VarChar(50) |
| `expressionJson` | `Json` | @map("expression_json") |
| `severity` | `String` | @db.VarChar(30) |
| `isReusable` | `Boolean` | @default(false) @map("is_reusable") |
| `artifactVersion` | `DecisionArtifactVersion` | @relation(fields: [artifactVersionId], references: [id], onDelete: Cascade) |
| `nodeConditions` | `DecisionNodeCondition[]` | — |
| `edgeConditions` | `DecisionEdgeCondition[]` | — |

Índices y restricciones:

- `unique([artifactVersionId, conditionCode])`

## DecisionRuleEdge

Tabla `decision_rule_edge`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `artifactVersionId` | `BigInt` | @map("artifact_version_id") |
| `fromNodeId` | `BigInt` | @map("from_node_id") |
| `toNodeId` | `BigInt` | @map("to_node_id") |
| `edgeKey` | `String` | @map("edge_key") @db.VarChar(120) |
| `edgeType` | `String` | @map("edge_type") @db.VarChar(50) |
| `priority` | `Int` | @default(100) |
| `isDefault` | `Boolean` | @default(false) @map("is_default") |
| `artifactVersion` | `DecisionArtifactVersion` | @relation(fields: [artifactVersionId], references: [id], onDelete: Cascade) |
| `fromNode` | `DecisionRuleNode` | @relation("FromNode", fields: [fromNodeId], references: [id], onDelete: Cascade) |
| `toNode` | `DecisionRuleNode` | @relation("ToNode", fields: [toNodeId], references: [id], onDelete: Cascade) |
| `edgeConditions` | `DecisionEdgeCondition[]` | — |

Índices y restricciones:

- `unique([artifactVersionId, edgeKey])`
- `index([artifactVersionId, fromNodeId, priority])`

## DecisionRuleNode

Tabla `decision_rule_node`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `artifactVersionId` | `BigInt` | @map("artifact_version_id") |
| `nodeKey` | `String` | @map("node_key") @db.VarChar(120) |
| `nodeType` | `String` | @map("node_type") @db.VarChar(50) |
| `label` | `String` | @db.VarChar(200) |
| `configJson` | `Json` | @map("config_json") |
| `xPos` | `Float` | @default(0) @map("x_pos") |
| `yPos` | `Float` | @default(0) @map("y_pos") |
| `orderIndex` | `Int` | @default(0) @map("order_index") |
| `isTerminal` | `Boolean` | @default(false) @map("is_terminal") |
| `artifactVersion` | `DecisionArtifactVersion` | @relation(fields: [artifactVersionId], references: [id], onDelete: Cascade) |
| `outgoingEdges` | `DecisionRuleEdge[]` | @relation("FromNode") |
| `incomingEdges` | `DecisionRuleEdge[]` | @relation("ToNode") |
| `nodeConditions` | `DecisionNodeCondition[]` | — |
| `nodeActions` | `DecisionNodeAction[]` | — |
| `executionSteps` | `DecisionExecutionStep[]` | — |

Índices y restricciones:

- `unique([artifactVersionId, nodeKey])`
- `index([artifactVersionId, orderIndex])`

## DecisionRuntimeBinding

Tabla `decision_runtime_binding`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `tenantId` | `BigInt` | @map("tenant_id") |
| `artifactCode` | `String` | @map("artifact_code") @db.VarChar(100) |
| `environmentId` | `BigInt` | @map("environment_id") |
| `activeDeploymentId` | `BigInt` | @map("active_deployment_id") |
| `bindingKey` | `String` | @default("default") @map("binding_key") @db.VarChar(100) |
| `updatedAt` | `DateTime` | @updatedAt @map("updated_at") @db.Timestamptz(6) |
| `environment` | `DecisionEnvironment` | @relation(fields: [environmentId], references: [id], onDelete: Restrict) |
| `activeDeployment` | `DecisionDeployment` | @relation(fields: [activeDeploymentId], references: [id], onDelete: Restrict) |

Índices y restricciones:

- `unique([tenantId, artifactCode, environmentId, bindingKey])`
- `index([tenantId, artifactCode, environmentId])`

## DecisionSubject

Tabla `decision_subject`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `tenantId` | `BigInt` | @map("tenant_id") |
| `subjectReferenceHash` | `String` | @map("subject_reference_hash") @db.VarChar(128) |
| `firstSeenAt` | `DateTime` | @default(now()) @map("first_seen_at") @db.Timestamptz(6) |
| `lastSeenAt` | `DateTime` | @default(now()) @updatedAt @map("last_seen_at") @db.Timestamptz(6) |
| `decisionCount` | `Int` | @default(0) @map("decision_count") |
| `executions` | `DecisionExecution[]` | — |
| `facilities` | `CreditFacility[]` | — |
| `consents` | `SubjectConsent[]` | — |
| `reidentifications` | `ReidentificationRequest[]` | — |

Índices y restricciones:

- `unique([tenantId, subjectReferenceHash])`
- `index([tenantId, lastSeenAt])`

## DecisionTestAssertion

Tabla `decision_test_assertion`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `testCaseRunId` | `BigInt` | @map("test_case_run_id") |
| `assertionPath` | `String` | @map("assertion_path") @db.VarChar(500) |
| `operator` | `String` | @db.VarChar(30) |
| `expectedJson` | `Json?` | @map("expected_json") |
| `actualJson` | `Json?` | @map("actual_json") |
| `passed` | `Boolean` | — |
| `testCaseRun` | `DecisionTestCaseRun` | @relation(fields: [testCaseRunId], references: [id], onDelete: Cascade) |

## DecisionTestCase

Tabla `decision_test_case`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `testSuiteId` | `BigInt` | @map("test_suite_id") |
| `caseCode` | `String` | @map("case_code") @db.VarChar(100) |
| `testName` | `String` | @map("test_name") @db.VarChar(200) |
| `inputJson` | `Json` | @map("input_json") |
| `expectedResultJson` | `Json` | @map("expected_result_json") |
| `tagsJson` | `Json?` | @map("tags_json") |
| `isActive` | `Boolean` | @default(true) @map("is_active") |
| `testSuite` | `DecisionTestSuite` | @relation(fields: [testSuiteId], references: [id], onDelete: Cascade) |
| `caseRuns` | `DecisionTestCaseRun[]` | — |

Índices y restricciones:

- `unique([testSuiteId, caseCode])`

## DecisionTestCaseRun

Tabla `decision_test_case_run`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `testRunId` | `BigInt` | @map("test_run_id") |
| `testCaseId` | `BigInt` | @map("test_case_id") |
| `actualResultJson` | `Json?` | @map("actual_result_json") |
| `resultStatus` | `TestCaseRunStatus` | @map("result_status") |
| `durationMs` | `Int` | @map("duration_ms") |
| `errorJson` | `Json?` | @map("error_json") |
| `testRun` | `DecisionTestRun` | @relation(fields: [testRunId], references: [id], onDelete: Cascade) |
| `testCase` | `DecisionTestCase` | @relation(fields: [testCaseId], references: [id], onDelete: Cascade) |
| `assertions` | `DecisionTestAssertion[]` | — |

Índices y restricciones:

- `unique([testRunId, testCaseId])`

## DecisionTestCoverage

Tabla `decision_test_coverage`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `testRunId` | `BigInt` | @map("test_run_id") |
| `coverageType` | `String` | @map("coverage_type") @db.VarChar(50) |
| `coveredCount` | `Int` | @map("covered_count") |
| `totalCount` | `Int` | @map("total_count") |
| `coveragePercentage` | `Decimal` | @map("coverage_percentage") @db.Decimal(7, 4) |
| `detailsJson` | `Json?` | @map("details_json") |
| `testRun` | `DecisionTestRun` | @relation(fields: [testRunId], references: [id], onDelete: Cascade) |

Índices y restricciones:

- `unique([testRunId, coverageType])`

## DecisionTestRun

Tabla `decision_test_run`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `testSuiteId` | `BigInt` | @map("test_suite_id") |
| `compiledArtifactId` | `BigInt` | @map("compiled_artifact_id") |
| `triggerType` | `String` | @map("trigger_type") @db.VarChar(50) |
| `triggeredBy` | `String` | @map("triggered_by") @db.VarChar(160) |
| `status` | `TestRunStatus` | @default(QUEUED) |
| `queuedAt` | `DateTime` | @default(now()) @map("queued_at") @db.Timestamptz(6) |
| `startedAt` | `DateTime?` | @map("started_at") @db.Timestamptz(6) |
| `finishedAt` | `DateTime?` | @map("finished_at") @db.Timestamptz(6) |
| `leaseExpiresAt` | `DateTime?` | @map("lease_expires_at") @db.Timestamptz(6) |
| `attemptCount` | `Int` | @default(0) @map("attempt_count") |
| `traceCarrier` | `Json?` | @map("trace_carrier") |
| `testSuite` | `DecisionTestSuite` | @relation(fields: [testSuiteId], references: [id], onDelete: Cascade) |
| `compiledArtifact` | `DecisionCompiledArtifact` | @relation(fields: [compiledArtifactId], references: [id], onDelete: Restrict) |
| `caseRuns` | `DecisionTestCaseRun[]` | — |
| `coverage` | `DecisionTestCoverage[]` | — |

Índices y restricciones:

- `index([testSuiteId, startedAt])`
- `index([status, queuedAt])`

## DecisionTestSuite

Tabla `decision_test_suite`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `artifactVersionId` | `BigInt` | @map("artifact_version_id") |
| `suiteCode` | `String` | @map("suite_code") @db.VarChar(100) |
| `name` | `String` | @db.VarChar(200) |
| `suiteType` | `String` | @map("suite_type") @db.VarChar(50) |
| `isBlocking` | `Boolean` | @default(true) @map("is_blocking") |
| `artifactVersion` | `DecisionArtifactVersion` | @relation(fields: [artifactVersionId], references: [id], onDelete: Cascade) |
| `cases` | `DecisionTestCase[]` | — |
| `runs` | `DecisionTestRun[]` | — |
| `policyLinks` | `PolicyTestLink[]` | — |

Índices y restricciones:

- `unique([artifactVersionId, suiteCode])`

## DecisionVariableDefinition

Tabla `decision_variable_definition`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `tenantId` | `BigInt` | @map("tenant_id") |
| `variableCode` | `String` | @map("variable_code") @db.VarChar(120) |
| `canonicalName` | `String` | @map("canonical_name") @db.VarChar(160) |
| `businessDescription` | `String` | @map("business_description") @db.Text |
| `dataClassification` | `String` | @map("data_classification") @db.VarChar(50) |
| `ownerTeam` | `String` | @map("owner_team") @db.VarChar(100) |
| `isSensitive` | `Boolean` | @default(false) @map("is_sensitive") |
| `isActive` | `Boolean` | @default(true) @map("is_active") |
| `sensitivityClass` | `SensitivityClass` | @default(INTERNAL) @map("sensitivity_class") |
| `lifecycleState` | `VariableLifecycleState` | @default(ACTIVE) @map("lifecycle_state") |
| `contractVersion` | `String` | @default("1") @map("contract_version") @db.VarChar(20) |
| `metadataJson` | `Json?` | @map("metadata_json") |
| `decisionUseRestriction` | `DecisionUseRestriction` | @default(NONE) @map("decision_use_restriction") |
| `versions` | `DecisionVariableVersion[]` | — |

Índices y restricciones:

- `unique([tenantId, variableCode])`
- `index([tenantId, isActive])`
- `index([tenantId, lifecycleState])`

## DecisionVariableSource

Tabla `decision_variable_source`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `variableVersionId` | `BigInt` | @map("variable_version_id") |
| `sourceSystemCode` | `String` | @map("source_system_code") @db.VarChar(100) |
| `sourcePath` | `String` | @map("source_path") @db.VarChar(500) |
| `sourceField` | `String` | @map("source_field") @db.VarChar(160) |
| `freshnessSlaSeconds` | `Int` | @map("freshness_sla_seconds") |
| `precedence` | `Int` | @default(1) |
| `isAuthoritative` | `Boolean` | @default(false) @map("is_authoritative") |
| `variableVersion` | `DecisionVariableVersion` | @relation(fields: [variableVersionId], references: [id], onDelete: Cascade) |

Índices y restricciones:

- `unique([variableVersionId, sourceSystemCode, sourcePath, sourceField])`

## DecisionVariableValidationRule

Tabla `decision_variable_validation_rule`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `variableVersionId` | `BigInt` | @map("variable_version_id") |
| `ruleType` | `String` | @map("rule_type") @db.VarChar(50) |
| `ruleConfigJson` | `Json` | @map("rule_config_json") |
| `severity` | `String` | @db.VarChar(30) |
| `errorCode` | `String` | @map("error_code") @db.VarChar(100) |
| `variableVersion` | `DecisionVariableVersion` | @relation(fields: [variableVersionId], references: [id], onDelete: Cascade) |

## DecisionVariableVersion

Tabla `decision_variable_version`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `variableDefinitionId` | `BigInt` | @map("variable_definition_id") |
| `versionNumber` | `Int` | @map("version_number") |
| `dataType` | `String` | @map("data_type") @db.VarChar(40) |
| `unitCode` | `String?` | @map("unit_code") @db.VarChar(40) |
| `nullable` | `Boolean` | @default(false) |
| `defaultValueJson` | `Json?` | @map("default_value_json") |
| `validationSchemaJson` | `Json?` | @map("validation_schema_json") |
| `derivationExpressionJson` | `Json?` | @map("derivation_expression_json") |
| `effectiveFrom` | `DateTime` | @default(now()) @map("effective_from") @db.Timestamptz(6) |
| `effectiveTo` | `DateTime?` | @map("effective_to") @db.Timestamptz(6) |
| `displayName` | `String?` | @map("display_name") @db.VarChar(160) |
| `description` | `String?` | @map("description") @db.Text |
| `constraintsJson` | `Json?` | @map("constraints_json") |
| `validationMessage` | `String?` | @map("validation_message") @db.VarChar(400) |
| `exampleValidJson` | `Json?` | @map("example_valid_json") |
| `exampleInvalidJson` | `Json?` | @map("example_invalid_json") |
| `expectedOrigin` | `String` | @default("REQUEST") @map("expected_origin") @db.VarChar(40) |
| `contractVersion` | `String` | @default("1") @map("contract_version") @db.VarChar(20) |
| `definition` | `DecisionVariableDefinition` | @relation(fields: [variableDefinitionId], references: [id], onDelete: Cascade) |
| `sources` | `DecisionVariableSource[]` | — |
| `validationRules` | `DecisionVariableValidationRule[]` | — |
| `artifactUses` | `DecisionArtifactVariableDependency[]` | — |
| `executionVariables` | `DecisionExecutionVariable[]` | — |

Índices y restricciones:

- `unique([variableDefinitionId, versionNumber])`
- `index([variableDefinitionId, effectiveFrom])`

## DecisionVersionStatusHistory

Tabla `decision_version_status_history`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `artifactVersionId` | `BigInt` | @map("artifact_version_id") |
| `fromStatus` | `VersionStatus?` | @map("from_status") |
| `toStatus` | `VersionStatus` | @map("to_status") |
| `changedBy` | `String` | @map("changed_by") @db.VarChar(160) |
| `changedAt` | `DateTime` | @default(now()) @map("changed_at") @db.Timestamptz(6) |
| `reason` | `String?` | @db.Text |
| `artifactVersion` | `DecisionArtifactVersion` | @relation(fields: [artifactVersionId], references: [id], onDelete: Cascade) |

Índices y restricciones:

- `index([artifactVersionId, changedAt])`

## ExposureLimit

Tabla `exposure_limit`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `tenantId` | `BigInt` | @map("tenant_id") |
| `limitCode` | `String` | @map("limit_code") @db.VarChar(60) |
| `segment` | `String` | @default("") @db.VarChar(120) |
| `maxValue` | `Decimal` | @map("max_value") @db.Decimal(18, 4) |
| `currencyCode` | `String` | @map("currency_code") @db.VarChar(3) |
| `enforced` | `Boolean` | @default(false) |
| `isActive` | `Boolean` | @default(true) @map("is_active") |
| `createdAt` | `DateTime` | @default(now()) @map("created_at") @db.Timestamptz(6) |
| `createdBy` | `String` | @map("created_by") @db.VarChar(160) |

Índices y restricciones:

- `unique([tenantId, limitCode, segment])`
- `index([tenantId, isActive])`

## FinancialInstitution

Tabla `decision_financial_institution`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `tenantId` | `BigInt` | @map("tenant_id") |
| `code` | `String` | @db.VarChar(16) |
| `name` | `String` | @db.VarChar(200) |
| `kind` | `FinancialInstitutionKind` | — |
| `licenseStatus` | `InstitutionLicenseStatus` | @default(LICENSED) @map("license_status") |
| `retailDeposits` | `Boolean` | @default(true) @map("retail_deposits") |
| `markers` | `Json` | — |
| `exclusions` | `Json` | — |
| `note` | `String?` | @db.Text |
| `website` | `String?` | @map("website") @db.VarChar(200) |
| `logoData` | `Bytes?` | @map("logo_data") |
| `logoContentType` | `String?` | @map("logo_content_type") @db.VarChar(80) |
| `logoSource` | `String?` | @map("logo_source") @db.VarChar(16) |
| `logoSourceUrl` | `String?` | @map("logo_source_url") @db.VarChar(500) |
| `logoUpdatedAt` | `DateTime?` | @map("logo_updated_at") @db.Timestamptz(6) |
| `expectedSignals` | `Json?` | @map("expected_signals") |
| `isActive` | `Boolean` | @default(true) @map("is_active") |
| `createdAt` | `DateTime` | @default(now()) @map("created_at") @db.Timestamptz(6) |
| `updatedAt` | `DateTime` | @updatedAt @map("updated_at") @db.Timestamptz(6) |
| `updatedBy` | `String?` | @map("updated_by") @db.VarChar(160) |

Índices y restricciones:

- `unique([tenantId, code])`
- `index([tenantId, isActive])`
- `index([tenantId, licenseStatus])`

## IdentityVerificationRun

Tabla `decision_identity_verification_run`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `tenantId` | `BigInt` | @map("tenant_id") |
| `requestId` | `String` | @map("request_id") @db.VarChar(64) |
| `status` | `WorkerRunStatus` | @default(QUEUED) |
| `progress` | `Int` | @default(0) |
| `inputSource` | `WorkerInputSource` | @map("input_source") |
| `fixtureCode` | `String?` | @map("fixture_code") @db.VarChar(60) |
| `inputHash` | `String` | @map("input_hash") @db.Char(64) |
| `documentCountry` | `String` | @map("document_country") @db.VarChar(2) |
| `documentFileName` | `String` | @map("document_file_name") @db.VarChar(255) |
| `selfieFileName` | `String` | @map("selfie_file_name") @db.VarChar(255) |
| `imageSizeBytes` | `Int` | @map("image_size_bytes") |
| `documentBytes` | `Bytes?` | @map("document_bytes") |
| `documentBackBytes` | `Bytes?` | @map("document_back_bytes") |
| `selfieBytes` | `Bytes?` | @map("selfie_bytes") |
| `documentObjectKey` | `String?` | @map("document_object_key") @db.VarChar(512) |
| `documentBackObjectKey` | `String?` | @map("document_back_object_key") @db.VarChar(512) |
| `selfieObjectKey` | `String?` | @map("selfie_object_key") @db.VarChar(512) |
| `resultJson` | `Json?` | @map("result_json") |
| `warningsJson` | `Json?` | @map("warnings_json") |
| `decision` | `String?` | @db.VarChar(30) |
| `documentType` | `String?` | @map("document_type") @db.VarChar(30) |
| `similarityScore` | `Decimal?` | @map("similarity_score") @db.Decimal(4, 3) |
| `documentTypeConfidence` | `Decimal?` | @map("document_type_confidence") @db.Decimal(4, 3) |
| `reviewReason` | `IdentityReviewReason?` | @map("review_reason") |
| `rejectionReason` | `IdentityRejectionReason?` | @map("rejection_reason") |
| `arbitrationMode` | `IdentityArbitrationMode?` | @map("arbitration_mode") |
| `reviewPriority` | `Int?` | @map("review_priority") |
| `reviewOpenedAt` | `DateTime?` | @map("review_opened_at") @db.Timestamptz(6) |
| `reviewClaimedBy` | `String?` | @map("review_claimed_by") @db.VarChar(160) |
| `reviewClaimedAt` | `DateTime?` | @map("review_claimed_at") @db.Timestamptz(6) |
| `reviewResolvedBy` | `String?` | @map("review_resolved_by") @db.VarChar(160) |
| `reviewResolvedAt` | `DateTime?` | @map("review_resolved_at") @db.Timestamptz(6) |
| `reviewNotes` | `String?` | @map("review_notes") @db.Text |
| `errorCode` | `String?` | @map("error_code") @db.VarChar(120) |
| `errorMessage` | `String?` | @map("error_message") @db.Text |
| `attemptCount` | `Int` | @default(0) @map("attempt_count") |
| `leaseExpiresAt` | `DateTime?` | @map("lease_expires_at") @db.Timestamptz(6) |
| `queuedAt` | `DateTime` | @default(now()) @map("queued_at") @db.Timestamptz(6) |
| `startedAt` | `DateTime?` | @map("started_at") @db.Timestamptz(6) |
| `finishedAt` | `DateTime?` | @map("finished_at") @db.Timestamptz(6) |
| `requestedBy` | `String` | @map("requested_by") @db.VarChar(160) |
| `correlationId` | `String` | @map("correlation_id") @db.VarChar(64) |
| `traceCarrier` | `Json?` | @map("trace_carrier") |

Índices y restricciones:

- `unique([tenantId, inputHash])`
- `unique([tenantId, requestId])`
- `index([status, queuedAt])`
- `index([tenantId, queuedAt])`
- `index([tenantId, status, reviewReason, reviewPriority, reviewOpenedAt], map: "decision_identity_verification_run_review_queue_idx")`

## IntegrationClient

Tabla `integration_client`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `clientKey` | `String` | @unique @map("client_key") @db.VarChar(120) |
| `displayName` | `String` | @map("display_name") @db.VarChar(200) |
| `audience` | `String` | @db.VarChar(20) |
| `status` | `IntegrationClientStatus` | @default(ACTIVE) |
| `createdAt` | `DateTime` | @default(now()) @map("created_at") @db.Timestamptz(6) |
| `updatedAt` | `DateTime` | @updatedAt @map("updated_at") @db.Timestamptz(6) |
| `credentials` | `IntegrationCredential[]` | — |
| `scopes` | `IntegrationScope[]` | — |
| `tenantAccess` | `IntegrationTenantAccess[]` | — |

Índices y restricciones:

- `index([status])`

## IntegrationCredential

Tabla `integration_credential`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `clientId` | `BigInt` | @map("client_id") |
| `secretHash` | `String` | @unique @map("secret_hash") @db.VarChar(128) |
| `label` | `String` | @db.VarChar(120) |
| `status` | `IntegrationCredentialStatus` | @default(ACTIVE) |
| `expiresAt` | `DateTime?` | @map("expires_at") @db.Timestamptz(6) |
| `lastUsedAt` | `DateTime?` | @map("last_used_at") @db.Timestamptz(6) |
| `revokedAt` | `DateTime?` | @map("revoked_at") @db.Timestamptz(6) |
| `createdAt` | `DateTime` | @default(now()) @map("created_at") @db.Timestamptz(6) |
| `updatedAt` | `DateTime` | @updatedAt @map("updated_at") @db.Timestamptz(6) |
| `client` | `IntegrationClient` | @relation(fields: [clientId], references: [id], onDelete: Cascade) |

Índices y restricciones:

- `index([clientId, status])`
- `index([expiresAt])`

## IntegrationScope

Tabla `integration_scope`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `clientId` | `BigInt` | @map("client_id") |
| `scope` | `String` | @db.VarChar(80) |
| `client` | `IntegrationClient` | @relation(fields: [clientId], references: [id], onDelete: Cascade) |

Índices y restricciones:

- `unique([clientId, scope])`

## IntegrationTenantAccess

Tabla `integration_tenant_access`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `clientId` | `BigInt` | @map("client_id") |
| `tenantId` | `BigInt` | @map("tenant_id") |
| `client` | `IntegrationClient` | @relation(fields: [clientId], references: [id], onDelete: Cascade) |

Índices y restricciones:

- `unique([clientId, tenantId])`
- `index([tenantId])`

## MonitoringBaseline

Tabla `monitoring_baseline`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `tenantId` | `BigInt` | @map("tenant_id") |
| `artifactVersionId` | `BigInt` | @map("artifact_version_id") |
| `variableCode` | `String` | @map("variable_code") @db.VarChar(120) |
| `bucketsJson` | `Json` | @map("buckets_json") |
| `sampleSize` | `Int` | @map("sample_size") |
| `capturedAt` | `DateTime` | @default(now()) @map("captured_at") @db.Timestamptz(6) |
| `capturedBy` | `String` | @map("captured_by") @db.VarChar(160) |
| `artifactVersion` | `DecisionArtifactVersion` | @relation(fields: [artifactVersionId], references: [id], onDelete: Cascade) |

Índices y restricciones:

- `unique([artifactVersionId, variableCode])`
- `index([tenantId, capturedAt])`

## MonitoringEvaluation

Tabla `monitoring_evaluation`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `tenantId` | `BigInt` | @map("tenant_id") |
| `artifactVersionId` | `BigInt` | @map("artifact_version_id") |
| `metricCode` | `String` | @map("metric_code") @db.VarChar(60) |
| `scope` | `String` | @db.VarChar(120) |
| `value` | `Decimal` | @db.Decimal(18, 8) |
| `threshold` | `Decimal` | @db.Decimal(18, 8) |
| `verdict` | `MonitoringVerdict` | — |
| `sampleSize` | `Int` | @map("sample_size") |
| `detailsJson` | `Json?` | @map("details_json") |
| `evaluatedAt` | `DateTime` | @default(now()) @map("evaluated_at") @db.Timestamptz(6) |
| `artifactVersion` | `DecisionArtifactVersion` | @relation(fields: [artifactVersionId], references: [id], onDelete: Cascade) |

Índices y restricciones:

- `index([tenantId, artifactVersionId, metricCode, evaluatedAt])`
- `index([tenantId, verdict, evaluatedAt])`

## Notification

Tabla `decision_notification`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `tenantId` | `BigInt` | @map("tenant_id") |
| `recipientRole` | `String?` | @map("recipient_role") @db.VarChar(80) |
| `recipientId` | `String?` | @map("recipient_id") @db.VarChar(160) |
| `category` | `String` | @db.VarChar(50) |
| `priority` | `String` | @default("NORMAL") @db.VarChar(20) |
| `title` | `String` | @db.VarChar(200) |
| `body` | `String` | @db.Text |
| `entityType` | `String?` | @map("entity_type") @db.VarChar(80) |
| `entityId` | `String?` | @map("entity_id") @db.VarChar(160) |
| `actionUrl` | `String?` | @map("action_url") @db.VarChar(500) |
| `eventType` | `String` | @map("event_type") @db.VarChar(120) |
| `correlationId` | `String?` | @map("correlation_id") @db.VarChar(120) |
| `readAt` | `DateTime?` | @map("read_at") @db.Timestamptz(6) |
| `createdAt` | `DateTime` | @default(now()) @map("created_at") @db.Timestamptz(6) |

Índices y restricciones:

- `index([tenantId, recipientRole, readAt, id])`
- `index([tenantId, recipientId, readAt, id])`

## OutcomeWindowSchedule

Tabla `outcome_window_schedule`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `tenantId` | `BigInt` | @map("tenant_id") |
| `executionId` | `BigInt` | @map("execution_id") |
| `facilityId` | `BigInt?` | @map("facility_id") |
| `windowDays` | `Int` | @map("window_days") |
| `dueAt` | `DateTime` | @map("due_at") @db.Timestamptz(6) |
| `observedAt` | `DateTime?` | @map("observed_at") @db.Timestamptz(6) |
| `execution` | `DecisionExecution` | @relation(fields: [executionId], references: [id], onDelete: Cascade) |
| `facility` | `CreditFacility?` | @relation(fields: [facilityId], references: [id], onDelete: SetNull) |

Índices y restricciones:

- `unique([executionId, windowDays])`
- `index([tenantId, dueAt, observedAt])`

## PolicyArtifactLink

Tabla `decision_policy_artifact_link`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `policyRequirementId` | `BigInt` | @map("policy_requirement_id") |
| `artifactVersionId` | `BigInt` | @map("artifact_version_id") |
| `policyRequirement` | `PolicyRequirement` | @relation(fields: [policyRequirementId], references: [id], onDelete: Cascade) |
| `artifactVersion` | `DecisionArtifactVersion` | @relation(fields: [artifactVersionId], references: [id], onDelete: Cascade) |

Índices y restricciones:

- `unique([policyRequirementId, artifactVersionId])`

## PolicyRequirement

Tabla `decision_policy_requirement`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `businessObjectiveId` | `BigInt` | @map("business_objective_id") |
| `policyCode` | `String` | @map("policy_code") @db.VarChar(100) |
| `rationale` | `String` | @db.Text |
| `owner` | `String` | @db.VarChar(160) |
| `severity` | `String` | @db.VarChar(30) |
| `createdAt` | `DateTime` | @default(now()) @map("created_at") @db.Timestamptz(6) |
| `businessObjective` | `BusinessObjective` | @relation(fields: [businessObjectiveId], references: [id], onDelete: Cascade) |
| `artifactLinks` | `PolicyArtifactLink[]` | — |
| `testLinks` | `PolicyTestLink[]` | — |

Índices y restricciones:

- `unique([businessObjectiveId, policyCode])`

## PolicyTestLink

Tabla `decision_policy_test_link`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `policyRequirementId` | `BigInt` | @map("policy_requirement_id") |
| `testSuiteId` | `BigInt` | @map("test_suite_id") |
| `policyRequirement` | `PolicyRequirement` | @relation(fields: [policyRequirementId], references: [id], onDelete: Cascade) |
| `testSuite` | `DecisionTestSuite` | @relation(fields: [testSuiteId], references: [id], onDelete: Cascade) |

Índices y restricciones:

- `unique([policyRequirementId, testSuiteId])`

## PortfolioState

Tabla `portfolio_state`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `tenantId` | `BigInt` | @map("tenant_id") |
| `asOf` | `DateTime` | @map("as_of") @db.Timestamptz(6) |
| `metricCode` | `String` | @map("metric_code") @db.VarChar(60) |
| `segment` | `String` | @default("") @db.VarChar(120) |
| `value` | `Decimal` | @db.Decimal(18, 4) |
| `recordedBy` | `String` | @map("recorded_by") @db.VarChar(160) |

Índices y restricciones:

- `unique([tenantId, asOf, metricCode, segment])`
- `index([tenantId, metricCode, asOf])`

## ProcessedEvent

Tabla `decision_processed_event`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `consumerName` | `String` | @map("consumer_name") @db.VarChar(120) |
| `outboxEventId` | `BigInt` | @map("outbox_event_id") |
| `processedAt` | `DateTime` | @default(now()) @map("processed_at") @db.Timestamptz(6) |

Índices y restricciones:

- `unique([consumerName, outboxEventId])`

## QaCounterexample

Tabla `decision_qa_counterexample`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `tenantId` | `BigInt` | @map("tenant_id") |
| `qaRunId` | `BigInt` | @map("qa_run_id") |
| `property` | `String` | @db.VarChar(120) |
| `shrunkInputJson` | `Json` | @map("shrunk_input_json") |
| `originalInputJson` | `Json?` | @map("original_input_json") |
| `observedJson` | `Json?` | @map("observed_json") |
| `failureCode` | `String` | @map("failure_code") @db.VarChar(120) |
| `failureMessage` | `String` | @map("failure_message") @db.Text |
| `replaySeed` | `String` | @map("replay_seed") @db.VarChar(64) |
| `replayPath` | `String?` | @map("replay_path") @db.VarChar(200) |
| `resolvedAt` | `DateTime?` | @map("resolved_at") @db.Timestamptz(6) |
| `createdAt` | `DateTime` | @default(now()) @map("created_at") @db.Timestamptz(6) |
| `qaRun` | `QaGenerationRun` | @relation(fields: [qaRunId], references: [id], onDelete: Cascade) |

Índices y restricciones:

- `index([tenantId, qaRunId])`
- `index([tenantId, property, createdAt])`

## QaGenerationRun

Tabla `decision_qa_generation_run`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `tenantId` | `BigInt` | @map("tenant_id") |
| `artifactVersionId` | `BigInt` | @map("artifact_version_id") |
| `environmentCode` | `String` | @map("environment_code") @db.VarChar(40) |
| `status` | `QaRunStatus` | @default(QUEUED) |
| `seed` | `String` | @db.VarChar(64) |
| `configJson` | `Json` | @map("config_json") |
| `generatorVersion` | `String` | @map("generator_version") @db.VarChar(40) |
| `toolingJson` | `Json` | @map("tooling_json") |
| `contractSnapshotJson` | `Json` | @map("contract_snapshot_json") |
| `totalCases` | `Int` | @default(0) @map("total_cases") |
| `passedCases` | `Int` | @default(0) @map("passed_cases") |
| `failedCases` | `Int` | @default(0) @map("failed_cases") |
| `erroredCases` | `Int` | @default(0) @map("errored_cases") |
| `durationMs` | `Int` | @default(0) @map("duration_ms") |
| `summaryJson` | `Json?` | @map("summary_json") |
| `startedAt` | `DateTime` | @default(now()) @map("started_at") @db.Timestamptz(6) |
| `finishedAt` | `DateTime?` | @map("finished_at") @db.Timestamptz(6) |
| `createdBy` | `String` | @map("created_by") @db.VarChar(160) |
| `artifactVersion` | `DecisionArtifactVersion` | @relation(fields: [artifactVersionId], references: [id], onDelete: Cascade) |
| `counterexamples` | `QaCounterexample[]` | — |

Índices y restricciones:

- `index([tenantId, artifactVersionId, startedAt])`

## ReidentificationRequest

Tabla `reidentification_request`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `tenantId` | `BigInt` | @map("tenant_id") |
| `subjectId` | `BigInt` | @map("subject_id") |
| `purpose` | `String` | @db.Text |
| `status` | `ReidentificationStatus` | @default(REQUESTED) |
| `requestedBy` | `String` | @map("requested_by") @db.VarChar(160) |
| `requestedAt` | `DateTime` | @default(now()) @map("requested_at") @db.Timestamptz(6) |
| `decidedBy` | `String?` | @map("decided_by") @db.VarChar(160) |
| `decidedAt` | `DateTime?` | @map("decided_at") @db.Timestamptz(6) |
| `consumedAt` | `DateTime?` | @map("consumed_at") @db.Timestamptz(6) |
| `subject` | `DecisionSubject` | @relation(fields: [subjectId], references: [id], onDelete: Cascade) |

Índices y restricciones:

- `index([tenantId, status, requestedAt])`
- `index([tenantId, subjectId])`

## RuntimeIdempotency

Tabla `decision_runtime_idempotency`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `tenantId` | `BigInt` | @map("tenant_id") |
| `artifactCode` | `String` | @map("artifact_code") @db.VarChar(100) |
| `idempotencyKey` | `String` | @map("idempotency_key") @db.VarChar(160) |
| `requestHash` | `String` | @map("request_hash") @db.VarChar(128) |
| `status` | `IdempotencyStatus` | @default(PROCESSING) |
| `responseJson` | `Json?` | @map("response_json") |
| `responseHash` | `String?` | @map("response_hash") @db.VarChar(128) |
| `leaseExpiresAt` | `DateTime` | @default(now()) @map("lease_expires_at") @db.Timestamptz(6) |
| `expiresAt` | `DateTime` | @map("expires_at") @db.Timestamptz(6) |
| `createdAt` | `DateTime` | @default(now()) @map("created_at") @db.Timestamptz(6) |
| `updatedAt` | `DateTime` | @updatedAt @map("updated_at") @db.Timestamptz(6) |

Índices y restricciones:

- `unique([tenantId, artifactCode, idempotencyKey])`
- `index([expiresAt])`

## SemanticAnalysisRun

Tabla `decision_semantic_analysis_run`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `tenantId` | `BigInt` | @map("tenant_id") |
| `requestId` | `String` | @map("request_id") @db.VarChar(64) |
| `idempotencyKey` | `String` | @map("idempotency_key") @db.VarChar(200) |
| `status` | `WorkerRunStatus` | @default(QUEUED) |
| `progress` | `Int` | @default(0) |
| `inputSource` | `WorkerInputSource` | @map("input_source") |
| `inputText` | `String` | @map("input_text") @db.Text |
| `inputMetadata` | `Json?` | @map("input_metadata") |
| `fixtureCode` | `String?` | @map("fixture_code") @db.VarChar(60) |
| `resultJson` | `Json?` | @map("result_json") |
| `warningsJson` | `Json?` | @map("warnings_json") |
| `errorCode` | `String?` | @map("error_code") @db.VarChar(120) |
| `errorMessage` | `String?` | @map("error_message") @db.Text |
| `attemptCount` | `Int` | @default(0) @map("attempt_count") |
| `leaseExpiresAt` | `DateTime?` | @map("lease_expires_at") @db.Timestamptz(6) |
| `queuedAt` | `DateTime` | @default(now()) @map("queued_at") @db.Timestamptz(6) |
| `startedAt` | `DateTime?` | @map("started_at") @db.Timestamptz(6) |
| `finishedAt` | `DateTime?` | @map("finished_at") @db.Timestamptz(6) |
| `requestedBy` | `String` | @map("requested_by") @db.VarChar(160) |
| `correlationId` | `String` | @map("correlation_id") @db.VarChar(64) |
| `traceCarrier` | `Json?` | @map("trace_carrier") |

Índices y restricciones:

- `unique([tenantId, idempotencyKey])`
- `unique([tenantId, requestId])`
- `index([status, queuedAt])`
- `index([tenantId, queuedAt])`

## SemanticCategory

Tabla `decision_semantic_category`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `tenantId` | `BigInt` | @map("tenant_id") |
| `code` | `String` | @db.VarChar(120) |
| `name` | `String` | @db.VarChar(200) |
| `description` | `String` | @db.Text |
| `parentCode` | `String?` | @map("parent_code") @db.VarChar(120) |
| `positiveExamples` | `Json` | @map("positive_examples") |
| `counterExamples` | `Json` | @map("counter_examples") |
| `restrictions` | `Json` | — |
| `relatedCategoryCodes` | `Json` | @map("related_category_codes") |
| `acceptanceThreshold` | `Decimal` | @map("acceptance_threshold") @db.Decimal(4, 3) |
| `version` | `Int` | @default(1) |
| `isActive` | `Boolean` | @default(true) @map("is_active") |
| `embeddings` | `SemanticCategoryEmbedding[]` | — |
| `parent` | `SemanticCategory?` | @relation("SemanticCategoryTree", fields: [tenantId, parentCode], references: [tenantId, code], onDelete: Restrict, onUpdate: Cascade) |
| `children` | `SemanticCategory[]` | @relation("SemanticCategoryTree") |

Índices y restricciones:

- `unique([tenantId, code])`
- `index([tenantId, isActive])`
- `index([tenantId, parentCode])`

## SemanticCategoryEmbedding

Tabla `decision_semantic_category_embedding`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `categoryId` | `BigInt` | @map("category_id") |
| `model` | `String` | @db.VarChar(120) |
| `version` | `Int` | @default(1) |
| `vector` | `Json` | — |
| `category` | `SemanticCategory` | @relation(fields: [categoryId], references: [id], onDelete: Cascade) |

Índices y restricciones:

- `unique([categoryId, model])`

## SemanticEntityAlias

Tabla `decision_semantic_entity_alias`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `tenantId` | `BigInt` | @map("tenant_id") |
| `alias` | `String` | @db.VarChar(200) |
| `canonicalName` | `String` | @map("canonical_name") @db.VarChar(200) |
| `entityType` | `String` | @map("entity_type") @db.VarChar(60) |
| `isActive` | `Boolean` | @default(true) @map("is_active") |

Índices y restricciones:

- `unique([tenantId, entityType, alias])`
- `index([tenantId, isActive])`

## SemanticModelSetting

Tabla `decision_semantic_model_setting`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `Int` | @id |
| `gateway` | `SemanticModelGateway` | — |
| `fastModel` | `String` | @map("fast_model") @db.VarChar(160) |
| `deepModel` | `String` | @map("deep_model") @db.VarChar(160) |
| `version` | `Int` | @default(1) |
| `updatedBy` | `String` | @map("updated_by") @db.VarChar(160) |
| `updatedAt` | `DateTime` | @updatedAt @map("updated_at") @db.Timestamptz(6) |
| `createdAt` | `DateTime` | @default(now()) @map("created_at") @db.Timestamptz(6) |

## SemanticTenantBudget

Tabla `decision_semantic_tenant_budget`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `tenantId` | `BigInt` | @map("tenant_id") |
| `windowStart` | `DateTime` | @map("window_start") @db.Timestamptz(6) |
| `analyses` | `Int` | @default(0) |
| `providerCalls` | `Int` | @default(0) @map("provider_calls") |

Índices y restricciones:

- `unique([tenantId, windowStart])`

## SqlConsoleQueryLog

Tabla `sql_console_query_log`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `tenantId` | `BigInt` | @map("tenant_id") |
| `actorId` | `String` | @map("actor_id") @db.VarChar(160) |
| `requestId` | `String?` | @map("request_id") @db.VarChar(120) |
| `statement` | `String` | @db.Text |
| `relations` | `String[]` | — |
| `outcome` | `String` | @db.VarChar(20) |
| `errorCode` | `String?` | @map("error_code") @db.VarChar(60) |
| `rowCount` | `Int?` | @map("row_count") |
| `durationMs` | `Int?` | @map("duration_ms") |
| `estimatedRows` | `BigInt?` | @map("estimated_rows") |
| `truncated` | `Boolean` | @default(false) |
| `executedAt` | `DateTime` | @default(now()) @map("executed_at") @db.Timestamptz(6) |

Índices y restricciones:

- `index([tenantId, executedAt])`
- `index([tenantId, actorId, executedAt])`

## SubjectConsent

Tabla `subject_consent`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `tenantId` | `BigInt` | @map("tenant_id") |
| `subjectId` | `BigInt` | @map("subject_id") |
| `purpose` | `String` | @db.VarChar(120) |
| `basis` | `ProcessingLegalBasis` | — |
| `grantedAt` | `DateTime` | @map("granted_at") @db.Timestamptz(6) |
| `expiresAt` | `DateTime?` | @map("expires_at") @db.Timestamptz(6) |
| `revokedAt` | `DateTime?` | @map("revoked_at") @db.Timestamptz(6) |
| `evidenceRef` | `String?` | @map("evidence_ref") @db.VarChar(200) |
| `recordedBy` | `String` | @map("recorded_by") @db.VarChar(160) |
| `subject` | `DecisionSubject` | @relation(fields: [subjectId], references: [id], onDelete: Cascade) |

Índices y restricciones:

- `unique([tenantId, subjectId, purpose])`
- `index([tenantId, expiresAt])`

## UnresolvedClassification

Tabla `decision_unresolved_classification`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `tenantId` | `BigInt` | @map("tenant_id") |
| `rawValue` | `String` | @map("raw_value") @db.Text |
| `normalizedValue` | `String` | @map("normalized_value") @db.VarChar(500) |
| `source` | `String` | @db.VarChar(120) |
| `context` | `Json` | @default("{}") |
| `suggestedCategoryCode` | `String?` | @map("suggested_category_code") @db.VarChar(120) |
| `confidence` | `Decimal?` | @db.Decimal(4, 3) |
| `alternatives` | `Json` | @default("[]") |
| `occurrenceCount` | `Int` | @default(1) @map("occurrence_count") |
| `firstSeenAt` | `DateTime` | @default(now()) @map("first_seen_at") @db.Timestamptz(6) |
| `lastSeenAt` | `DateTime` | @default(now()) @map("last_seen_at") @db.Timestamptz(6) |
| `status` | `String` | @default("PENDING") @db.VarChar(20) |
| `resolvedCategoryCode` | `String?` | @map("resolved_category_code") @db.VarChar(120) |
| `resolvedBy` | `String?` | @map("resolved_by") @db.VarChar(160) |
| `resolvedAt` | `DateTime?` | @map("resolved_at") @db.Timestamptz(6) |
| `resolutionType` | `String?` | @map("resolution_type") @db.VarChar(30) |
| `metadata` | `Json` | @default("{}") |
| `createdAt` | `DateTime` | @default(now()) @map("created_at") @db.Timestamptz(6) |
| `updatedAt` | `DateTime` | @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6) |

Índices y restricciones:

- `unique([tenantId, source, normalizedValue])`
- `index([tenantId, status, occurrenceCount])`
- `index([tenantId, status, lastSeenAt])`

## UserTutorialProgress

Tabla `user_tutorial_progress`.

| Campo | Tipo | Atributos |
| --- | --- | --- |
| `id` | `BigInt` | @id @default(autoincrement()) |
| `tenantId` | `BigInt` | @map("tenant_id") |
| `userId` | `String` | @map("user_id") @db.VarChar(200) |
| `tutorialId` | `String` | @map("tutorial_id") @db.VarChar(200) |
| `status` | `String` | @default("STARTED") @db.VarChar(30) |
| `lastStep` | `Int` | @default(0) @map("last_step") |
| `version` | `Int` | @default(1) |
| `autoShow` | `Boolean` | @default(true) @map("auto_show") |
| `completedAt` | `DateTime?` | @map("completed_at") @db.Timestamptz(6) |
| `createdAt` | `DateTime` | @default(now()) @map("created_at") @db.Timestamptz(6) |
| `updatedAt` | `DateTime` | @updatedAt @map("updated_at") @db.Timestamptz(6) |

Índices y restricciones:

- `unique([tenantId, userId, tutorialId])`
- `index([tenantId, userId])`

