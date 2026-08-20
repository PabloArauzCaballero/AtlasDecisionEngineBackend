<!-- GENERADO POR scripts/docs/generate-catalogs.mjs — NO EDITAR A MANO.
     Fuente: openapi/openapi.json. Ejecute `yarn docs:catalog` tras cambiar el código. -->

# Catálogo de endpoints

Contrato **v1** · 190 rutas · 212 operaciones.

La referencia interactiva completa —con esquemas, ejemplos y la posibilidad de probar cada
llamada— está en `/docs/{API_VERSION}/reference` del propio backend. Esta página existe para
buscar y enlazar desde el portal.

## Approved Libraries

Registro de librerías autorizadas. Una fila solo HABILITA un prelude ya revisado en el repositorio (§7).

| Método | Ruta | Operación | Resumen |
| --- | --- | --- | --- |
| `GET` | `/v1/libraries` | `libraryList` | Catálogo de librerías autorizadas, filtrable por lenguaje y ambiente |
| `POST` | `/v1/libraries` | `libraryUpsert` | Aprobar o actualizar una librería del registro |
| `GET` | `/v1/libraries/preludes` | `libraryPreludes` | Implementaciones disponibles que una librería puede habilitar |

## Audit and Observability

Consulta de ejecuciones y de la cadena de auditoría append-only, y su verificación.

| Método | Ruta | Operación | Resumen |
| --- | --- | --- | --- |
| `GET` | `/v1/audit/chain/verify` | `auditQueryVerify` | Verify the tenant audit HMAC chain in batches |
| `GET` | `/v1/audit/events` | `auditQueryEvents` | List audit events using offset pagination |
| `GET` | `/v1/audit/events/cursor` | `auditQueryEventsByCursor` | List audit events using a stable keyset cursor |
| `GET` | `/v1/audit/executions` | `auditQuerySearch` | Search decision executions with bounded pagination |
| `GET` | `/v1/audit/executions/{executionId}` | `auditQueryGetExecution` | Get one decision execution with its evidence |
| `GET` | `/v1/audit/metrics` | `auditQueryMetrics` | Aggregate decision outcomes and latency evidence |

## Calculated Fields

Funciones pequeñas, gobernadas y reutilizables, con contrato de retorno obligatorio (§5–§8).

| Método | Ruta | Operación | Resumen |
| --- | --- | --- | --- |
| `GET` | `/v1/calculated-fields` | `calculatedFieldList` | Listar campos calculados |
| `POST` | `/v1/calculated-fields` | `calculatedFieldCreate` | Crear un campo calculado |
| `GET` | `/v1/calculated-fields/{fieldId}` | `calculatedFieldGet` | Detalle de un campo calculado con todas sus versiones |
| `POST` | `/v1/calculated-fields/{fieldId}/versions` | `calculatedFieldCreateVersion` | Crear una versión con su contrato de retorno e implementación |
| `GET` | `/v1/calculated-fields/operations` | `calculatedFieldOperations` | Catálogo de operaciones del constructor visual |
| `POST` | `/v1/calculated-fields/preview/outcomes` | `calculatedFieldPreviewOutcomes` | Qué desenlaces del contrato alcanza un borrador |
| `POST` | `/v1/calculated-fields/preview/sample-inputs` | `calculatedFieldPreviewSampleInputs` | Generar entradas de ejemplo de un borrador, sin ejecutarlas |
| `POST` | `/v1/calculated-fields/preview/test` | `calculatedFieldPreviewTest` | Ejecutar los casos de prueba declarados en el borrador |
| `POST` | `/v1/calculated-fields/preview/try` | `calculatedFieldPreviewTry` | Ejecutar un borrador de versión sin crearlo |
| `POST` | `/v1/calculated-fields/versions/{versionId}/outcomes` | `calculatedFieldOutcomes` | Qué desenlaces del contrato alcanza una versión guardada |
| `POST` | `/v1/calculated-fields/versions/{versionId}/promote` | `calculatedFieldPromote` | Promover una versión en su ciclo de gobierno |
| `POST` | `/v1/calculated-fields/versions/{versionId}/sample-inputs` | `calculatedFieldSampleInputs` | Generar entradas de ejemplo del contrato de la versión, sin ejecutarlas |
| `POST` | `/v1/calculated-fields/versions/{versionId}/test` | `calculatedFieldTest` | Ejecutar los casos de prueba declarados de la versión |
| `POST` | `/v1/calculated-fields/versions/{versionId}/try` | `calculatedFieldTryRun` | Ejecutar la versión con entradas de ejemplo, sin persistir nada |

## Code to Flow Import

Importación de código existente y su conversión asistida a un grafo (§5).

| Método | Ruta | Operación | Resumen |
| --- | --- | --- | --- |
| `POST` | `/v1/code-imports` | `codeImportAnalyze` | Analyze source code and create a graph preview |
| `GET` | `/v1/code-imports` | `codeImportList` | List code-import analyses |
| `GET` | `/v1/code-imports/{id}` | `codeImportGet` | Get source, contract, issues and generated graph |
| `POST` | `/v1/code-imports/{id}/cancel` | `codeImportCancel` | Cancel a code import without changing an artifact |
| `POST` | `/v1/code-imports/{id}/confirm` | `codeImportConfirm` | Write, validate and compile an analyzed import |
| `POST` | `/v1/code-imports/{id}/save-draft` | `codeImportSaveDraft` | Write the generated graph into an editable artifact version |

## Data Subject Rights

| Método | Ruta | Operación | Resumen |
| --- | --- | --- | --- |
| `POST` | `/v1/data-subject-requests` | `dataSubjectSubmit` | Register a data subject request and resolve it against the decision history |
| `POST` | `/v1/data-subject-requests/history` | `dataSubjectHistory` | List the requests already handled for a data subject |

## Decision Artifacts

Algoritmos de decisión, sus versiones y el grafo que las define. Solo un borrador es editable.

| Método | Ruta | Operación | Resumen |
| --- | --- | --- | --- |
| `GET` | `/v1/artifact-versions/{leftVersionId}/diff/{rightVersionId}` | `artifactDiff` | Compare two version snapshots canonically |
| `GET` | `/v1/artifact-versions/{versionId}` | `artifactGetVersion` | Get one artifact version and governance state |
| `POST` | `/v1/artifact-versions/{versionId}/clone` | `artifactClone` | Clone an immutable version into a new draft |
| `POST` | `/v1/artifact-versions/{versionId}/compile` | `artifactCompile` | Compile a valid version into an immutable runtime payload |
| `GET` | `/v1/artifact-versions/{versionId}/graph` | `artifactGetGraph` | Load the complete authoring graph snapshot |
| `PUT` | `/v1/artifact-versions/{versionId}/graph` | `artifactReplaceGraph` | Atomically replace a draft graph using optimistic locking |
| `PATCH` | `/v1/artifact-versions/{versionId}/notes` | `artifactUpdateNotes` | Update non-executable authoring notes on an editable version |
| `PATCH` | `/v1/artifact-versions/{versionId}/processing-basis` | `artifactUpdateProcessingBasis` | Declare the processing purpose and legal basis of a version |
| `POST` | `/v1/artifact-versions/{versionId}/validate` | `artifactValidate` | Validate graph structure, expressions and determinism |
| `POST` | `/v1/artifact-versions/{versionId}/validate-and-compile` | `artifactValidateAndCompile` | Validate and compile a version in one command |
| `POST` | `/v1/artifacts` | `artifactCreate` | Create an artifact with its first editable version |
| `GET` | `/v1/artifacts` | `artifactList` | List decision artifacts with filters and pagination |
| `GET` | `/v1/artifacts/{artifactId}` | `artifactGet` | Get an artifact and its version history |

## Decision Deployments

Ambientes, despliegues activos y reversión a una versión anterior.

| Método | Ruta | Operación | Resumen |
| --- | --- | --- | --- |
| `POST` | `/v1/artifact-versions/{versionId}/deployments` | `deploymentDeploy` | Publish an approved compiled artifact version |
| `GET` | `/v1/deployments` | `deploymentList` | List deployment history with filters |
| `POST` | `/v1/deployments/{deploymentId}/rollback` | `deploymentRollback` | Rollback an active deployment to its predecessor |
| `POST` | `/v1/deployments/{deploymentId}/suspend` | `deploymentSuspend` | Suspend a deployment and invalidate its runtime binding |
| `GET` | `/v1/environments` | `deploymentEnvironments` | List active decision environments |

## Decision Governance

Envío a revisión, aprobaciones y segregación de funciones sobre una versión.

| Método | Ruta | Operación | Resumen |
| --- | --- | --- | --- |
| `GET` | `/v1/approval-requests` | `governanceList` | List the tenant approval queue |
| `GET` | `/v1/approval-requests/{requestId}` | `governanceGet` | Get one approval request and all evidence |
| `POST` | `/v1/approval-steps/{stepId}/decisions` | `governanceDecide` | Record a role-authorized approval decision |
| `POST` | `/v1/artifact-versions/{versionId}/submit-for-review` | `governanceSubmit` | Submit a validated version for ordered review |

## Decision Runtime

Ejecución en línea de una decisión, idempotente y con evidencia persistida.

| Método | Ruta | Operación | Resumen |
| --- | --- | --- | --- |
| `POST` | `/v1/decisions/{artifactCode}` | `runtimeExecute` | Execute an idempotent decision against the active deployment |

## Decision Simulation

Ejecución de prueba sin persistir nada, con comparación opcional contra PROD (§12).

| Método | Ruta | Operación | Resumen |
| --- | --- | --- | --- |
| `POST` | `/v1/simulations/{artifactCode}` | `simulationSimulate` | Simulate a non-production decision (DEV, STAGING or TEST) without persistence |
| `POST` | `/v1/simulations/{artifactCode}/sample-inputs` | `simulationGenerateSampleInputs` | Generar valores de prueba a partir del contrato de entrada |

## Decision Testing

Suites de regresión, casos y corridas deterministas por versión.

| Método | Ruta | Operación | Resumen |
| --- | --- | --- | --- |
| `POST` | `/v1/artifact-versions/{versionId}/test-suites` | `testingCreateSuite` | Create a version-scoped suite with initial cases |
| `GET` | `/v1/artifact-versions/{versionId}/test-suites` | `testingListSuites` | List suites and recent run evidence for a version |
| `GET` | `/v1/test-runs/{runId}` | `testingGetRun` | Get run status, assertions and graph coverage |
| `GET` | `/v1/test-suites/{suiteId}/cases` | `testingListCases` | List deterministic cases in a suite |
| `POST` | `/v1/test-suites/{suiteId}/cases` | `testingCreateCase` | Add one case to a suite |
| `POST` | `/v1/test-suites/{suiteId}/cases/import` | `testingImportCases` | Add a bounded batch of cases to a suite |
| `POST` | `/v1/test-suites/{suiteId}/runs` | `testingRun` | Queue an asynchronous test run |

## Health

Sondas de vida y disponibilidad para el orquestador. Públicas y sin límite de tasa.

| Método | Ruta | Operación | Resumen |
| --- | --- | --- | --- |
| `GET` | `/health` | `healthLiveAlias` | Alias of /health/live kept for existing probes |
| `GET` | `/health/data-sources` | `healthDataSources` | Report registered data connections and their effective routing |
| `GET` | `/health/live` | `healthLive` | Report process liveness without checking dependencies |
| `GET` | `/health/ready` | `healthReady` | Report database and cache readiness with redacted failures |
| `GET` | `/ready` | `healthReadyAlias` | Alias of /health/ready kept for existing probes |

## Live Execution

Vista paso a paso de una ejecución no productiva por SSE. Opt-in.

| Método | Ruta | Operación | Resumen |
| --- | --- | --- | --- |
| `GET` | `/v1/live-executions/stream` | `liveExecutionStream` | Stream an opt-in non-production decision preview node by node |

## Manual Review

Cola de casos derivados a revisión humana y su resolución.

| Método | Ruta | Operación | Resumen |
| --- | --- | --- | --- |
| `GET` | `/v1/manual-reviews` | `manualReviewList` | List manual-review cases visible to the tenant |
| `GET` | `/v1/manual-reviews/{caseId}` | `manualReviewGet` | Get one manual-review case and decision context |
| `POST` | `/v1/manual-reviews/{caseId}/assign` | `manualReviewAssign` | Assign an open case to an analyst |
| `POST` | `/v1/manual-reviews/{caseId}/resolve` | `manualReviewResolve` | Resolve a case as its assigned analyst |

## Model Monitoring

| Método | Ruta | Operación | Resumen |
| --- | --- | --- | --- |
| `GET` | `/v1/model-monitoring/ab` | `modelMonitoringAbComparison` | Champion vs challenger compared by observed outcome |
| `POST` | `/v1/model-monitoring/adverse-impact` | `modelMonitoringAdverseImpact` | Adverse impact ratio per group (four-fifths rule) |
| `POST` | `/v1/model-monitoring/attributes` | `modelMonitoringRecordAttributes` | Record monitoring-only demographic attributes for bias testing |
| `GET` | `/v1/model-monitoring/coverage` | `modelMonitoringCoverage` | Coverage of the decision feedback loop: subjects and outcomes |
| `GET` | `/v1/model-monitoring/cutoff-analysis` | `modelMonitoringCutoffAnalysis` | Approval and loss trade-off at every possible score cutoff |
| `POST` | `/v1/model-monitoring/outcomes` | `modelMonitoringRecordOutcomes` | Record the realized outcome of decisions already taken |
| `POST` | `/v1/model-monitoring/performance` | `modelMonitoringPerformance` | Outcome analysis: realized rates against the decisions taken |
| `POST` | `/v1/model-monitoring/stability` | `modelMonitoringStability` | Population stability index between a reference and current window |

## Nested Decision Trees

Referencias de un artefacto a otro, con presupuesto, reintentos y política de fallo (§9).

| Método | Ruta | Operación | Resumen |
| --- | --- | --- | --- |
| `POST` | `/v1/artifact-versions/{versionId}/references` | `nestedTreeCreate` | Create a validated child-artifact reference |
| `GET` | `/v1/artifact-versions/{versionId}/references` | `nestedTreeList` | List references owned by an artifact version |
| `PUT` | `/v1/artifact-versions/{versionId}/references/{referenceId}` | `nestedTreeUpdate` | Update mappings, timeout or error policy of a reference |
| `DELETE` | `/v1/artifact-versions/{versionId}/references/{referenceId}` | `nestedTreeRemove` | Delete a reference from an editable parent version |
| `GET` | `/v1/artifacts/{artifactId}/dependency-graph` | `dependencyGraphGet` | Get upstream and downstream artifact dependencies |

## Notifications

Bandeja persistente alimentada por el outbox transaccional.

| Método | Ruta | Operación | Resumen |
| --- | --- | --- | --- |
| `GET` | `/v1/notifications` | `notificationList` | List notifications addressed to the caller or its roles |
| `POST` | `/v1/notifications/{id}/read` | `notificationMarkRead` | Mark one visible notification as read |
| `POST` | `/v1/notifications/read-all` | `notificationMarkAllRead` | Mark every visible notification as read |
| `GET` | `/v1/notifications/unread-count` | `notificationUnreadCount` | Count unread notifications visible to the caller |

## Outcome Ingestion

| Método | Ruta | Operación | Resumen |
| --- | --- | --- | --- |
| `POST` | `/v1/outcomes/batch` | `outcomeIngestionRecordBatch` | Record observed outcomes for known facilities, row by row |
| `POST` | `/v1/outcomes/facilities` | `outcomeIngestionRegisterFacilities` | Register disbursed credit facilities and schedule their outcome windows |
| `GET` | `/v1/outcomes/pending` | `outcomeIngestionPending` | Overdue observation windows nobody has closed |
| `GET` | `/v1/outcomes/vintage` | `outcomeIngestionVintage` | Vintage matrix: bad rate by decision cohort and maturity window |

## pdf

| Método | Ruta | Operación | Resumen |
| --- | --- | --- | --- |
| `GET` | `/pdf/artifacts` | `pdfCatalogArtifactsForBinding` | Artefactos publicados que pueden alimentar un documento |
| `POST` | `/pdf/generate` | `pdfGenerationGeneratePdf` | Genera un documento PDF a partir de un template y su payload |
| `POST` | `/pdf/generate/async` | `pdfGenerationGenerateAsync` | Encola la generación y responde de inmediato |
| `GET` | `/pdf/health` | `pdfCatalogHealthReport` | Sonda del generador documental |
| `POST` | `/pdf/preview` | `pdfGenerationPreviewTemplate` | Previsualiza un template con sus datos ficticios |
| `GET` | `/pdf/templates` | `pdfCatalogListTemplates` | Lista los templates publicados, en su última versión |
| `GET` | `/pdf/templates/{templateId}` | `pdfCatalogDefinition` | Definición completa de un template |
| `GET` | `/pdf/templates/{templateId}/compatibility` | `pdfCatalogCompatibility` | ¿Lo que responde este artefacto lo acepta este documento? |
| `GET` | `/pdf/templates/{templateId}/sample` | `pdfCatalogSampleFromArtifact` | Dato de prueba construido con la salida REAL de un artefacto |
| `GET` | `/pdf/templates/{templateId}/schema` | `pdfCatalogSchema` | Contrato de datos que exige el template |
| `POST` | `/pdf/templates/{templateId}/validate` | `pdfCatalogValidatePayload` | Comprueba un payload sin generar nada |
| `GET` | `/pdf/templates/{templateId}/versions` | `pdfCatalogVersions` | Versiones publicadas, en orden semántico ascendente |

## pdf-templates

| Método | Ruta | Operación | Resumen |
| --- | --- | --- | --- |
| `GET` | `/pdf/admin/templates` | `pdfTemplateAdminInventory` | Inventario completo, con origen y estado de cada versión |
| `POST` | `/pdf/admin/templates` | `pdfTemplateAdminPublish` | Publica un template nuevo |
| `DELETE` | `/pdf/admin/templates/{templateId}/{version}` | `pdfTemplateAdminRemove` | Borra una versión publicada por la API |
| `POST` | `/pdf/admin/templates/{templateId}/{version}/deprecate` | `pdfTemplateAdminDeprecate` | Marca una versión como obsoleta |
| `GET` | `/pdf/admin/templates/{templateId}/{version}/source` | `pdfTemplateAdminSource` | Descarga el paquete de un template publicado por la API |
| `GET` | `/pdf/errors` | `pdfTemplateAdminErrorCatalog` | Catálogo completo de errores del generador documental |
| `GET` | `/pdf/template-format/example` | `pdfTemplateAdminExampleBundle` | Descarga un paquete de template de EJEMPLO, completo y funcional |
| `GET` | `/pdf/template-format/schema` | `pdfTemplateAdminFormatSchema` | JSON Schema del paquete que el backend acepta |

## Portal Session

Inicio y cierre de sesión del portal contra el proveedor de identidad.

| Método | Ruta | Operación | Resumen |
| --- | --- | --- | --- |
| `POST` | `/v1/session/login` | `identitySessionLogin` | Authenticate through the configured identity provider |
| `POST` | `/v1/session/login/pin` | `identitySessionVerifyLoginPin` | Complete a second-factor sign-in with the mailed PIN |
| `POST` | `/v1/session/logout` | `identitySessionLogout` | Revoke the provider session and clear the refresh cookie |
| `POST` | `/v1/session/refresh` | `identitySessionRefresh` | Rotate the provider session using the HttpOnly refresh cookie |

## QA Lab

Generación masiva guiada por contrato y contraejemplos reproducibles (§10).

| Método | Ruta | Operación | Resumen |
| --- | --- | --- | --- |
| `POST` | `/v1/qa-lab/counterexamples/{counterexampleId}/replay` | `qaLabReplay` | Volver a ejecutar un contraejemplo archivado |
| `GET` | `/v1/qa-lab/properties` | `qaLabProperties` | Propiedades que el QA Lab verifica en cada ejecución |
| `GET` | `/v1/qa-lab/runs` | `qaLabListRuns` | Historial de corridas generativas |
| `GET` | `/v1/qa-lab/runs/{runId}` | `qaLabGetRun` | Detalle de una corrida con sus contraejemplos mínimos |
| `GET` | `/v1/qa-lab/versions/{versionId}/outcomes` | `qaLabListOutcomes` | Desenlaces que alcanza el grafo de una versión |
| `POST` | `/v1/qa-lab/versions/{versionId}/runs` | `qaLabRun` | Lanzar un lote de casos contra una versión compilada |
| `POST` | `/v1/qa-lab/versions/{versionId}/sample-inputs` | `qaLabSampleInputs` | Generar valores de prueba de una versión compilada, sin ejecutarlos |

## Read Model Views

Vistas de solo lectura que alimentan catálogos y selectores del portal.

| Método | Ruta | Operación | Resumen |
| --- | --- | --- | --- |
| `GET` | `/v1/views/artifact-inputs` | `viewsArtifactInputs` | Get the latest artifact input and validation contract |
| `GET` | `/v1/views/options` | `viewsOptions` | List authoritative catalog options for forms |
| `GET` | `/v1/views/pickers/artifact-versions` | `viewsArtifactVersions` | List artifact versions for portal pickers |
| `GET` | `/v1/views/pickers/artifacts` | `viewsArtifacts` | List active artifacts for portal pickers |
| `GET` | `/v1/views/pickers/test-runs` | `viewsTestRuns` | List recent test runs for portal pickers |
| `GET` | `/v1/views/pickers/test-suites` | `viewsTestSuites` | List test suites for portal pickers |
| `GET` | `/v1/views/pickers/variables` | `viewsVariables` | List current variables for portal pickers |
| `GET` | `/v1/views/scripts` | `viewsScripts` | List script nodes without exposing source in picker views |
| `GET` | `/v1/views/search` | `viewsSearch` | Search governed entities across portal read models |

## Requirements Traceability

Objetivos de negocio y su cobertura por artefactos y pruebas.

| Método | Ruta | Operación | Resumen |
| --- | --- | --- | --- |
| `GET` | `/v1/traceability/coverage-matrix` | `traceabilityCoverageMatrix` | Compute objective-to-policy evidence coverage |
| `POST` | `/v1/traceability/objectives` | `traceabilityCreate` | Create a business objective and its policy requirements |
| `GET` | `/v1/traceability/objectives` | `traceabilityList` | List business objectives and policies |
| `GET` | `/v1/traceability/objectives/{objectiveId}` | `traceabilityGetObjective` | Get one objective with linked evidence |
| `POST` | `/v1/traceability/policies/{policyId}/artifacts` | `traceabilityLinkArtifact` | Link a policy requirement to an artifact version |
| `POST` | `/v1/traceability/policies/{policyId}/test-suites` | `traceabilityLinkTest` | Link a policy requirement to a test suite |

## Risk Governance

| Método | Ruta | Operación | Resumen |
| --- | --- | --- | --- |
| `POST` | `/v1/risk-governance/calibration` | `riskGovernanceCalibrate` | Compute and store the calibration curve of a deployed version |
| `GET` | `/v1/risk-governance/calibration` | `riskGovernanceStoredCalibration` | Last stored calibration curve, without recomputing |
| `POST` | `/v1/risk-governance/consents` | `riskGovernanceRecordConsent` | Record a data subject consent with its validity window |
| `POST` | `/v1/risk-governance/consents/lookup` | `riskGovernanceConsents` | Consents of one data subject, each with its verdict for today |
| `POST` | `/v1/risk-governance/consents/revoke` | `riskGovernanceRevokeConsent` | Revoke a consent |
| `GET` | `/v1/risk-governance/limits` | `riskGovernanceListLimits` | Portfolio exposure limits with their current utilisation |
| `POST` | `/v1/risk-governance/limits` | `riskGovernanceUpsertLimit` | Create or update a portfolio exposure limit |
| `POST` | `/v1/risk-governance/model-dossier` | `riskGovernanceRecordDossier` | Record independent validation and revalidation due date of a version |
| `POST` | `/v1/risk-governance/portfolio-state` | `riskGovernanceRecordPortfolioState` | Record a portfolio metric observation (exposure, PAR30, budget…) |
| `GET` | `/v1/risk-governance/reidentifications` | `riskGovernanceListReidentifications` | Reidentification requests and who decided them |
| `POST` | `/v1/risk-governance/reidentifications` | `riskGovernanceRequestReidentification` | Ask to reidentify a pseudonymous subject, stating why |
| `POST` | `/v1/risk-governance/reidentifications/decide` | `riskGovernanceDecideReidentification` | Approve or reject a reidentification request |

## Security Review

Revisión de seguridad de una versión antes de su promoción.

| Método | Ruta | Operación | Resumen |
| --- | --- | --- | --- |
| `GET` | `/v1/security-review/versions/{versionId}` | `securityReviewGet` | Aggregate security and governance evidence for a version |
| `GET` | `/v1/security-review/versions/{versionId}/export` | `securityReviewExport` | Export a reproducible security-review snapshot |

## SQL Console

| Método | Ruta | Operación | Resumen |
| --- | --- | --- | --- |
| `GET` | `/v1/sql-console/catalog` | `sqlConsoleCatalog` | List the governed datasets, tables and columns the console can query |
| `GET` | `/v1/sql-console/history` | `sqlConsoleHistory` | List the caller´s own recent queries |
| `POST` | `/v1/sql-console/query` | `sqlConsoleQuery` | Execute a read-only query against the governed datasets |
| `POST` | `/v1/sql-console/validate` | `sqlConsoleValidate` | Validate and estimate a query without executing it |

## Tutorials

Contenido guiado del portal.

| Método | Ruta | Operación | Resumen |
| --- | --- | --- | --- |
| `GET` | `/v1/tutorial-progress` | `tutorialList` | List tutorial progress for the authenticated user |
| `PUT` | `/v1/tutorial-progress/{tutorialId}` | `tutorialUpsert` | Create or update one tutorial progress record |

## Variable Catalog

Catálogo global de variables y sus versiones inmutables, con contrato, restricciones y ejemplos (§1).

| Método | Ruta | Operación | Resumen |
| --- | --- | --- | --- |
| `POST` | `/v1/reason-codes` | `variableCreateReason` | Create a governed explanation reason code |
| `GET` | `/v1/reason-codes` | `variableListReasons` | List reason codes with filters and pagination |
| `POST` | `/v1/variables` | `variableCreate` | Create a governed variable definition and initial version |
| `GET` | `/v1/variables` | `variableList` | List variable definitions with active versions |
| `GET` | `/v1/variables/{definitionId}` | `variableGet` | Get a variable definition and complete version history |
| `POST` | `/v1/variables/{definitionId}/compatibility` | `variableCompatibility` | Comparar un contrato candidato con la última versión |
| `GET` | `/v1/variables/{definitionId}/dependencies` | `variableDependencies` | Artefactos y versiones que usan esta variable |
| `POST` | `/v1/variables/{definitionId}/versions` | `variableCreateVersion` | Create a new immutable variable version |
| `POST` | `/v1/variables/validate-contract` | `variableValidateContract` | Validar un contrato de variable ANTES de guardarlo |

## Workers

Catálogo de los workers adicionales, con sus límites y su disponibilidad en este despliegue (ADR-0026).

| Método | Ruta | Operación | Resumen |
| --- | --- | --- | --- |
| `GET` | `/v1/workers` | `workersList` | Workers disponibles, con sus límites y disponibilidad |
| `GET` | `/v1/workers/{code}/metrics` | `workersWorkerMetrics` | Salud, latencia, cola e incidencias de un worker |

## Workers · Análisis semántico

Clasificación de texto libre contra el catálogo de categorías, con entidades y evidencia. Asíncrono: se encola y se consulta.

| Método | Ruta | Operación | Resumen |
| --- | --- | --- | --- |
| `GET` | `/v1/workers/semantic-analysis/fixtures` | `semanticAnalysisListFixtures` | Escenarios de prueba disponibles |
| `POST` | `/v1/workers/semantic-analysis/runs` | `semanticAnalysisCreateRun` | Encola un análisis semántico |
| `GET` | `/v1/workers/semantic-analysis/runs` | `semanticAnalysisListRuns` | Análisis del tenant |
| `GET` | `/v1/workers/semantic-analysis/runs/{requestId}` | `semanticAnalysisGetRun` | Estado, progreso y resultado de un análisis |
| `POST` | `/v1/workers/semantic-analysis/runs/{requestId}/cancel` | `semanticAnalysisCancelRun` | Cancela un análisis que nadie ha reclamado todavía |
| `POST` | `/v1/workers/semantic-analysis/runs/batch` | `semanticAnalysisCreateRunBatch` | Encola varios análisis semánticos de una vez |
| `POST` | `/v1/workers/semantic-analysis/runs/status` | `semanticAnalysisGetRunStatuses` | Estado y resultado de varias ejecuciones |

## Workers · Categorías semánticas

| Método | Ruta | Operación | Resumen |
| --- | --- | --- | --- |
| `GET` | `/v1/workers/semantic-analysis/categories` | `semanticCategoryList` | Árbol de categorías del tenant |
| `POST` | `/v1/workers/semantic-analysis/categories` | `semanticCategoryCreate` | Crea o reemplaza una categoría |
| `PUT` | `/v1/workers/semantic-analysis/categories/{code}` | `semanticCategoryUpdate` | Actualiza una categoría |
| `DELETE` | `/v1/workers/semantic-analysis/categories/{code}` | `semanticCategoryDeactivate` | Desactiva una categoría (no se borra: las trazas la citan) |
| `POST` | `/v1/workers/semantic-analysis/categories/import` | `semanticCategoryImport` | Inyecta un subárbol completo desde JSON |

## Workers · Extractos bancarios

Conversión de un extracto bancario en PDF a movimientos normalizados. Asíncrono; el documento no se conserva y la cuenta se publica enmascarada.

| Método | Ruta | Operación | Resumen |
| --- | --- | --- | --- |
| `GET` | `/v1/workers/bank-statement/fixtures` | `bankStatementListFixtures` | Escenarios de prueba disponibles |
| `GET` | `/v1/workers/bank-statement/reviews` | `statementReviewList` | Cola de documentos pendientes de revisión humana |
| `GET` | `/v1/workers/bank-statement/reviews/{requestId}` | `statementReviewGet` | Un caso, con su clasificación, lo extraído y lo que falló |
| `POST` | `/v1/workers/bank-statement/reviews/{requestId}/claim` | `statementReviewClaim` | Reclama el caso para revisarlo |
| `POST` | `/v1/workers/bank-statement/reviews/{requestId}/reprocess` | `statementReviewReprocess` | Devuelve el documento a la cola del worker |
| `POST` | `/v1/workers/bank-statement/reviews/{requestId}/resolve` | `statementReviewResolve` | Cierra el caso: aprobar, corregir, rechazar o marcar no válido |
| `GET` | `/v1/workers/bank-statement/reviews/categories` | `statementReviewCategories` | Contadores por categoría de la cola de revisión |
| `POST` | `/v1/workers/bank-statement/runs` | `bankStatementCreateRun` | Encola una conversión de extracto |
| `GET` | `/v1/workers/bank-statement/runs` | `bankStatementListRuns` | Ejecuciones del tenant |
| `GET` | `/v1/workers/bank-statement/runs/{requestId}` | `bankStatementGetRun` | Estado, progreso y resultado de una ejecución |
| `POST` | `/v1/workers/bank-statement/runs/{requestId}/cancel` | `bankStatementCancelRun` | Cancela una ejecución que nadie ha reclamado todavía |
| `GET` | `/v1/workers/bank-statement/runs/{requestId}/download` | `bankStatementDownload` | Descarga el resultado en CSV o JSON |

## Workers · Locución

| Método | Ruta | Operación | Resumen |
| --- | --- | --- | --- |
| `GET` | `/v1/workers/audio-tts/fixtures` | `audioTtsListFixtures` | Escenarios de prueba disponibles |
| `POST` | `/v1/workers/audio-tts/runs` | `audioTtsCreateRun` | Encola una locución |
| `GET` | `/v1/workers/audio-tts/runs` | `audioTtsListRuns` | Locuciones del tenant |
| `GET` | `/v1/workers/audio-tts/runs/{requestId}` | `audioTtsGetRun` | Estado, progreso y desenlace de una locución |
| `GET` | `/v1/workers/audio-tts/runs/{requestId}/audio` | `audioTtsAudioOf` | Reproduce o descarga el audio de una locución |
| `POST` | `/v1/workers/audio-tts/runs/{requestId}/cancel` | `audioTtsCancelRun` | Cancela una locución que nadie ha reclamado todavía |
| `GET` | `/v1/workers/audio-tts/templates` | `audioTtsListTemplates` | Plantillas de locución del tenant, con sus variables |

## Workers · Pendientes de clasificación

| Método | Ruta | Operación | Resumen |
| --- | --- | --- | --- |
| `GET` | `/v1/workers/semantic-analysis/unresolved` | `unresolvedClassificationList` | Pendientes, los más frecuentes primero |
| `POST` | `/v1/workers/semantic-analysis/unresolved/{id}/resolve` | `unresolvedClassificationResolve` | Resuelve un pendiente y enseña el alias al catálogo |
| `GET` | `/v1/workers/semantic-analysis/unresolved/count` | `unresolvedClassificationCount` | Cuántos pendientes hay |
| `POST` | `/v1/workers/semantic-analysis/unresolved/reevaluate` | `unresolvedClassificationReevaluate` | Arranca la reevaluación de los pendientes con el catálogo de hoy |
| `GET` | `/v1/workers/semantic-analysis/unresolved/reevaluate/status` | `unresolvedClassificationReevaluationStatus` | Estado de la reevaluación en curso |

## Workers · Verificación de identidad

| Método | Ruta | Operación | Resumen |
| --- | --- | --- | --- |
| `GET` | `/v1/workers/identity-verification/fixtures` | `identityVerificationListFixtures` | Escenarios de prueba disponibles |
| `POST` | `/v1/workers/identity-verification/runs` | `identityVerificationCreateRun` | Encola una verificación de identidad |
| `GET` | `/v1/workers/identity-verification/runs` | `identityVerificationListRuns` | Verificaciones del tenant |
| `GET` | `/v1/workers/identity-verification/runs/{requestId}` | `identityVerificationGetRun` | Estado, progreso y veredicto de una verificación |
| `POST` | `/v1/workers/identity-verification/runs/{requestId}/cancel` | `identityVerificationCancelRun` | Cancela una verificación que nadie ha reclamado todavía |
