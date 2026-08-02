<!-- GENERADO POR scripts/docs/generate-catalogs.mjs — NO EDITAR A MANO.
     Fuente: openapi/openapi.json. Ejecute `yarn docs:catalog` tras cambiar el código. -->

# Catálogo de endpoints

Contrato **v1** · 97 rutas · 109 operaciones.

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
| `POST` | `/v1/calculated-fields/versions/{versionId}/promote` | `calculatedFieldPromote` | Promover una versión en su ciclo de gobierno |
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
| `POST` | `/v1/simulations/{artifactCode}` | `simulationSimulate` | Simulate a SANDBOX or TEST decision without persistence |
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

## Portal Session

Inicio y cierre de sesión del portal contra el proveedor de identidad.

| Método | Ruta | Operación | Resumen |
| --- | --- | --- | --- |
| `POST` | `/v1/session/login` | `identitySessionLogin` | Authenticate through the configured identity provider |
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
| `POST` | `/v1/qa-lab/versions/{versionId}/runs` | `qaLabRun` | Generar y ejecutar un lote de casos contra una versión compilada |
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

## Security Review

Revisión de seguridad de una versión antes de su promoción.

| Método | Ruta | Operación | Resumen |
| --- | --- | --- | --- |
| `GET` | `/v1/security-review/versions/{versionId}` | `securityReviewGet` | Aggregate security and governance evidence for a version |
| `GET` | `/v1/security-review/versions/{versionId}/export` | `securityReviewExport` | Export a reproducible security-review snapshot |

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
