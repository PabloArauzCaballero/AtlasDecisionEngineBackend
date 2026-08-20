<!-- GENERADO POR scripts/docs/generate-catalogs.mjs — NO EDITAR A MANO.
     Fuente: src/**/*.ts (llamadas a new DomainException). Ejecute `yarn docs:catalog` tras cambiar el código. -->

# Catálogo de códigos de error

237 códigos de dominio. Todos viajan en el mismo sobre (`ProblemDetails`), con
el código en `title` y en `error.code`; ver `docs/api/error-model.md`.

| Código | Mensaje de referencia | Origen |
| --- | --- | --- |
| `ACTIVE_DEPLOYMENT_NOT_FOUND` | No active deployment for ${artifactCode} in ${environmentCode} | `src/modules/deployments/deployment-resolver.service.ts` |
| `APPROVAL_REQUEST_EXISTS` | An active approval request already exists | `src/modules/governance/governance.service.ts` |
| `APPROVAL_REQUEST_NOT_FOUND` | Approval request not found | `src/modules/governance/governance.service.ts` |
| `APPROVAL_ROLE_REQUIRED` | Role ${step.requiredRole} is required | `src/modules/governance/governance.service.ts` |
| `APPROVAL_STEP_CLOSED` | Approval step is no longer open | `src/modules/governance/governance.service.ts` |
| `APPROVAL_STEP_NOT_FOUND` | Approval step not found | `src/modules/governance/governance.service.ts` |
| `APPROVAL_STEP_OUT_OF_ORDER` | Previous approval steps must complete first | `src/modules/governance/governance.service.ts` |
| `ARTIFACT_HAS_NO_INPUTS` | La versión no declara variables de entrada, así que no hay valores que generar | `src/modules/qa-lab/qa-lab.service.ts` |
| `ARTIFACT_NOT_FOUND` | Artifact not found | `src/modules/artifacts/artifact.service.ts` |
| `AUDIO_ASSET_NOT_READY` | El audio de esta locución ya no está disponible. | `src/modules/workers/audio-tts/audio-tts.service.ts` |
| `AUDIO_RUN_NOT_CANCELLABLE` | — | `src/modules/workers/audio-tts/audio-tts.service.ts` |
| `AUDIO_RUN_NOT_FOUND` | No existe esa locución. | `src/modules/workers/audio-tts/audio-tts.service.ts` |
| `AUDIO_RUN_WITHOUT_AUDIO` | Esta locución todavía no tiene audio. | `src/modules/workers/audio-tts/audio-tts.service.ts` |
| `AUTH_RATE_LIMIT_EXCEEDED` | Too many failed authentication attempts | `src/common/security/authentication.guard.ts` |
| `BANK_STATEMENT_DOCUMENT_UNAVAILABLE` | El documento original ya no está disponible: hay que volver a subirlo. | `src/modules/workers/bank-statement/review/statement-review.service.ts` |
| `BANK_STATEMENT_FILE_EMPTY` | El archivo recibido está vacío. | `src/modules/workers/bank-statement/bank-statement-input.ts` |
| `BANK_STATEMENT_FILE_NAME_INVALID` | El nombre del archivo contiene caracteres no permitidos. | `src/modules/workers/bank-statement/bank-statement-input.ts` |
| `BANK_STATEMENT_FILE_NOT_PDF` | El archivo no es un PDF. Se comprueba su contenido, no su extensión. | `src/modules/workers/bank-statement/bank-statement-input.ts` |
| `BANK_STATEMENT_FILE_REQUIRED` | Se requiere un archivo PDF del extracto. | `src/modules/workers/bank-statement/bank-statement-input.ts` |
| `BANK_STATEMENT_FILE_TOO_LARGE` | El archivo supera el máximo permitido de ${Math.floor(maxBytes / 1_048_576)} MiB. | `src/modules/workers/bank-statement/bank-statement-input.ts` |
| `BANK_STATEMENT_REJECTION_REASON_REQUIRED` | Marcar un documento como no válido exige declarar el motivo. | `src/modules/workers/bank-statement/review/statement-review.service.ts` |
| `BANK_STATEMENT_RESULT_NOT_READY` | — | `src/modules/workers/bank-statement/bank-statement.controller.ts` |
| `BANK_STATEMENT_REVIEW_ASSIGNEE_MISMATCH` | Sólo quien reclamó este caso puede resolverlo. | `src/modules/workers/bank-statement/review/statement-review.service.ts` |
| `BANK_STATEMENT_REVIEW_NOT_CLAIMABLE` | — | `src/modules/workers/bank-statement/review/statement-review.service.ts` |
| `BANK_STATEMENT_REVIEW_NOT_CLAIMED` | Hay que reclamar el caso antes de resolverlo. | `src/modules/workers/bank-statement/review/statement-review.service.ts` |
| `BANK_STATEMENT_REVIEW_NOT_FOUND` | No hay ningún caso de revisión con ese identificador. | `src/modules/workers/bank-statement/review/statement-review.service.ts` |
| `BANK_STATEMENT_RUN_NOT_CANCELLABLE` | — | `src/modules/workers/bank-statement/bank-statement.service.ts` |
| `BANK_STATEMENT_RUN_NOT_FOUND` | No existe esa ejecución. | `src/modules/workers/bank-statement/bank-statement.service.ts` |
| `BASELINE_COMPARISON_NOT_SUPPORTED` | Baseline comparison is not available; omit baselineCompiledArtifactId and use explicit expected results | `src/modules/testing/test-execution.service.ts` |
| `BLOCKING_TESTS_NOT_PASSED` | Blocking tests and minimum coverage must pass before review | `src/modules/governance/governance.service.ts` |
| `CALCULATED_FIELD_ARGUMENT_INVALID` | ${operation} espera un número y recibió ${describe(value)} | `src/modules/calculated-fields/operation-evaluator.ts` |
| `CALCULATED_FIELD_CODE_TAKEN` | Ya existe un campo calculado con el código ${dto.fieldCode} | `src/modules/calculated-fields/calculated-field.service.ts` |
| `CALCULATED_FIELD_CONTRACT_INVALID` | El contrato del campo calculado no es válido | `src/modules/calculated-fields/calculated-field-preview.service.ts` |
| `CALCULATED_FIELD_CONVERSION_FAILED` | TO_NUMBER no pudo convertir el valor recibido | `src/modules/calculated-fields/operation-evaluator.ts` |
| `CALCULATED_FIELD_DIVISION_BY_ZERO` | División entre cero en el campo calculado | `src/modules/calculated-fields/operation-evaluator.ts` |
| `CALCULATED_FIELD_HAS_NO_INPUTS` | Este borrador no declara entradas, así que no hay valores que generar | `src/modules/calculated-fields/calculated-field-preview.service.ts` |
| `CALCULATED_FIELD_INPUT_INVALID` | La entrada ${input.id} de ${field.fieldCode} ${violations[0].message} | `src/modules/calculated-fields/calculated-field-runtime.ts` |
| `CALCULATED_FIELD_INPUT_MISSING` | El campo calculado ${field.fieldCode} requiere la entrada ${input.id} | `src/modules/calculated-fields/calculated-field-runtime.ts` |
| `CALCULATED_FIELD_LIBRARY_BLOCKED` | El campo calculado ${version.calculatedField.fieldCode} usa la librería ${blocked.library.packageName}, que está bloqueada | `src/modules/artifacts/calculated-field-binding.service.ts` |
| `CALCULATED_FIELD_LIBRARY_UNAVAILABLE` | Alguna librería seleccionada no tiene implementación autorizada para ${language} | `src/modules/calculated-fields/calculated-field-runtime.ts` |
| `CALCULATED_FIELD_NOT_FOUND` | Campo calculado no encontrado | `src/modules/calculated-fields/calculated-field.service.ts` |
| `CALCULATED_FIELD_NOT_USABLE` | El campo calculado ${version.calculatedField.fieldCode} está en estado ${version.status}; solo puede invocarse APPROVED o PUBLISHED | `src/modules/artifacts/calculated-field-binding.service.ts` |
| `CALCULATED_FIELD_OPERATION_MISSING` | El campo calculado ${field.fieldCode} no tiene árbol de operaciones | `src/modules/calculated-fields/calculated-field-runtime.ts` |
| `CALCULATED_FIELD_OPERATION_UNKNOWN` | La operación ${operationId \|\| '(vacía)'} no está en el catálogo autorizado | `src/modules/calculated-fields/operation-evaluator.ts` |
| `CALCULATED_FIELD_TESTS_FAILED` | No se puede publicar: ${report.failed} de ${report.total} casos de prueba fallan | `src/modules/calculated-fields/calculated-field.service.ts` |
| `CALCULATED_FIELD_TRANSITION_INVALID` | No se puede pasar de ${version.status} a ${target} | `src/modules/calculated-fields/calculated-field.service.ts` |
| `CALCULATED_FIELD_TREE_TOO_DEEP` | El árbol de operaciones supera la profundidad máxima de ${MAX_DEPTH} | `src/modules/calculated-fields/operation-evaluator.ts` |
| `CALCULATED_FIELD_TREE_TOO_LARGE` | El árbol de operaciones supera los ${MAX_NODES} nodos | `src/modules/calculated-fields/operation-evaluator.ts` |
| `CALCULATED_FIELD_VERSION_IN_USE` | No se puede retirar: ${uses} artefacto(s) invocan esta versión | `src/modules/calculated-fields/calculated-field.service.ts` |
| `CALCULATED_FIELD_VERSION_NOT_FOUND` | El nodo ${nodeKey} invoca la versión de campo calculado ${call.calculatedFieldVersionId}, que no existe en este tenant | `src/modules/artifacts/calculated-field-binding.service.ts` |
| `CHECKSUM_MISMATCH` | Graph changed after validation; validate again | `src/modules/artifacts/artifact-lifecycle.service.ts` |
| `CHILD_ARTIFACT_NOT_FOUND` | Child artifact not found | `src/modules/nested-trees/nested-tree.service.ts` |
| `CHILD_VERSION_NOT_COMPILED` | The referenced child version has no successful compiled artifact | `src/modules/nested-trees/nested-tree-execution.service.ts` |
| `CHILD_VERSION_NOT_FOUND` | Child artifact version not found | `src/modules/nested-trees/nested-tree.service.ts` |
| `CIRCULAR_ARTIFACT_REFERENCE` | This reference would create a circular dependency: ${(cycle.path ?? []).join(' -> ')} | `src/modules/nested-trees/nested-tree.service.ts` |
| `CODE_IMPORT_HAS_BLOCKING_ISSUES` | This code import has unresolved errors and cannot be written to an artifact graph | `src/modules/code-import/code-import.service.ts` |
| `CODE_IMPORT_NOT_FOUND` | Code import not found | `src/modules/code-import/code-import.service.ts` |
| `CODE_IMPORT_REASON_CODE_MISSING` | These reason codes no longer exist in the catalog: ${missing.join(', ')} | `src/modules/code-import/code-import.service.ts` |
| `CODE_IMPORT_SOURCE_TOO_LARGE` | Source exceeds ${maxBytes} bytes | `src/modules/code-import/code-import.service.ts` |
| `CODE_IMPORT_VARIABLE_NOT_IN_CATALOG` | These variables are not declared in the catalog: ${missing.join(', ')} | `src/modules/code-import/code-import.service.ts` |
| `COMPILED_ARTIFACT_NOT_FOUND` | Compiled artifact not found | `src/modules/deployments/deployment.service.ts` |
| `DEPLOYMENT_ALREADY_SUSPENDED` | Deployment is already suspended | `src/modules/deployments/deployment.service.ts` |
| `DEPLOYMENT_NOT_ACTIVE` | Deployment is no longer the active deployment for this environment | `src/modules/deployments/deployment.service.ts` |
| `DEPLOYMENT_NOT_FOUND` | Deployment not found | `src/modules/deployments/deployment.service.ts` |
| `DUPLICATE_APPROVAL_DECISION` | This principal already decided this step | `src/modules/governance/governance.service.ts` |
| `ECONOMIC_CONTRACT_INCOMPLETE` | ${problems.join(' ')} Si esta decisión no origina crédito, decláralo en su | `src/modules/deployments/deployment.service.ts` |
| `EDGE_CONDITION_NOT_FOUND` | Edge ${edge.key} references unknown condition ${binding.conditionCode} | `src/modules/artifacts/artifact-graph-writer.service.ts` |
| `EDGE_NODE_NOT_FOUND` | Edge ${edge.key} references an unknown node | `src/modules/artifacts/artifact-graph-writer.service.ts` |
| `ENVIRONMENT_NOT_FOUND` | Deployment environment not found or inactive | `src/modules/deployments/deployment.service.ts` |
| `EXECUTION_NOT_FOUND` | Decision execution not found | `src/modules/audit-query/audit-query.service.ts` |
| `EXECUTION_PERSISTENCE_CONFLICT` | The request or execution evidence already exists | `src/modules/runtime/execution-writer.service.ts` |
| `EXECUTION_WITHOUT_TERMINAL` | Execution ended without a terminal node | `src/modules/graph/execution-engine.service.ts` |
| `EXPOSURE_LIMIT_EXCEEDED` | La exposición proyectada (${verdict.projectedValue}) supera el límite | `src/modules/risk-governance/decision-guard.service.ts` |
| `EXPRESSION_DIVISION_BY_ZERO` | Division by zero | `src/modules/graph/expression-evaluator.ts` |
| `EXPRESSION_INCOMPARABLE_OPERANDS` | Cannot order a non-finite numeric value | `src/modules/graph/expression-evaluator.ts` |
| `EXPRESSION_INVALID_ARGUMENTS` | min requires at least one argument | `src/modules/graph/expression-evaluator.ts` |
| `EXPRESSION_INVALID_DATE` | Cannot compare an invalid date value | `src/modules/graph/expression-evaluator.ts` |
| `EXPRESSION_NOT_NUMERIC` | Expected numeric value, got ${String(value)} | `src/modules/graph/expression-evaluator.ts` |
| `FORBIDDEN` | The identity has no Decision Engine role | `src/common/security/identity-provider-verifier.service.ts` |
| `FORBIDDEN_TENANT` | Client is not authorised for the requested tenant | `src/common/security/authentication.guard.ts` |
| `IDEMPOTENCY_CONTENDED` | The idempotency key is under contention; retry the request | `src/modules/runtime/idempotency.service.ts` |
| `IDEMPOTENCY_IN_PROGRESS` | An identical request is still being processed | `src/modules/runtime/idempotency.service.ts` |
| `IDEMPOTENCY_PAYLOAD_MISMATCH` | The idempotency key was already used with a different request payload | `src/modules/runtime/idempotency.service.ts` |
| `IDENTITY_PROVIDER_ERROR` | Identity provider rejected the request | `src/common/security/identity-provider.client.ts` |
| `IDENTITY_PROVIDER_INVALID_RESPONSE` | Identity provider did not return ${what} matching the expected contract | `src/common/security/identity-provider.client.ts` |
| `IDENTITY_PROVIDER_NOT_CONFIGURED` | Identity provider is not configured | `src/common/security/identity-provider.client.ts` |
| `IDENTITY_PROVIDER_UNAVAILABLE` | Identity provider is unavailable | `src/common/security/identity-provider.client.ts` |
| `IDENTITY_RATE_LIMITED` | Too many authentication attempts | `src/common/security/identity-provider.client.ts` |
| `IDENTITY_REJECTION_REASON_REQUIRED` | Rechazar un documento exige declarar el motivo: un rechazo sin motivo no es medible. | `src/modules/workers/identity-verification/review/identity-review.service.ts` |
| `IDENTITY_REQUEST_INVALID` | Invalid identity request | `src/common/security/identity-provider.client.ts` |
| `IDENTITY_REQUEST_REJECTED` | — | `src/common/security/identity-provider.client.ts` |
| `IDENTITY_REVIEW_DOCUMENT_TYPE_REQUIRED` | Confirmar el documento exige declarar cuál es: sin tipo no hay analizador y el caso volvería a la misma cola. | `src/modules/workers/identity-verification/review/identity-review.service.ts` |
| `IDENTITY_REVIEW_NOT_ASSIGNED` | Sólo quien reclamó el caso puede cerrarlo. Recláma1o primero. | `src/modules/workers/identity-verification/review/identity-review.service.ts` |
| `IDENTITY_REVIEW_NOT_CLAIMABLE` | — | `src/modules/workers/identity-verification/review/identity-review.service.ts` |
| `IDENTITY_REVIEW_NOT_FOUND` | No hay ningún caso de arbitraje con ese identificador. | `src/modules/workers/identity-verification/review/identity-review.service.ts` |
| `IDENTITY_RUN_NOT_CANCELLABLE` | — | `src/modules/workers/identity-verification/identity-verification.service.ts` |
| `IDENTITY_RUN_NOT_FOUND` | No existe esa verificación. | `src/modules/workers/identity-verification/identity-verification.service.ts` |
| `IF_MATCH_REQUIRED` | If-Match header with current lock_version is required | `src/common/http/id.ts` |
| `INSTITUTION_INVALID_PATTERN` | El patrón de ${field} «${source}» ${reason}. | `src/modules/workers/bank-statement/institutions/financial-institution.service.ts` |
| `INSTITUTION_NOTE_REQUIRED` | Una entidad sin licencia vigente necesita un motivo escrito: es lo único que quien revise el caso podrá leer. | `src/modules/workers/bank-statement/institutions/financial-institution.service.ts` |
| `INSTITUTION_NOT_FOUND` | No hay ninguna entidad con código ${code} en el padrón. | `src/modules/workers/bank-statement/institutions/financial-institution.service.ts` |
| `INSTITUTION_WITHOUT_MARKERS` | Una entidad sin marcadores no puede atribuir ningún documento. | `src/modules/workers/bank-statement/institutions/financial-institution.service.ts` |
| `INTERMEDIATE_ACCUMULATE_UNSUPPORTED` | La variable intermedia ${code} no admite acumulación para este tipo de valor | `src/modules/graph/intermediate-scope.ts` |
| `INTERMEDIATE_ALREADY_WRITTEN` | La variable intermedia ${code} es de escritura única y ya tiene valor | `src/modules/graph/intermediate-scope.ts` |
| `INTERMEDIATE_NOT_DECLARED` | El nodo ${nodeKey} intenta escribir la variable intermedia ${code}, que no está declarada | `src/modules/graph/intermediate-scope.ts` |
| `INTERMEDIATE_NULL_NOT_ALLOWED` | La variable intermedia ${code} no admite valores nulos | `src/modules/graph/intermediate-scope.ts` |
| `INTERMEDIATE_VALUE_INVALID` | La variable intermedia ${code} ${violations[0].message} | `src/modules/graph/intermediate-scope.ts` |
| `INTERMEDIATE_WRITE_UNAUTHORIZED` | Solo ${slot.definition.producerNodeKey} puede escribir la variable intermedia ${code} | `src/modules/graph/intermediate-scope.ts` |
| `INVALID_CURSOR` | The pagination cursor is malformed | `src/common/http/pagination.ts` |
| `INVALID_ID` | ${name} must be a positive integer | `src/common/http/id.ts` |
| `INVALID_IF_MATCH` | If-Match must be a positive integer | `src/common/http/id.ts` |
| `INVALID_SECURITY_CONTEXT` | x-tenant-id is required for clients authorised on multiple tenants | `src/common/security/authentication.guard.ts` |
| `INVALID_TRAFFIC_PERCENTAGE` | Traffic percentages must total 100 | `src/modules/deployments/deployment.service.ts` |
| `INVALID_VERSION_TRANSITION` | Cannot transition artifact version from ${version.status} to ${to} | `src/modules/artifacts/version-state.service.ts` |
| `LIBRARY_ENVIRONMENT_FORBIDDEN` | La librería ${row.logicalName} no está habilitada en el ambiente ${environmentCode} | `src/modules/libraries/library.service.ts` |
| `LIBRARY_FUNCTION_NOT_EXPOSED` | El prelude de ${dto.packageName} no expone: ${unknown.join(', ')} | `src/modules/libraries/library.service.ts` |
| `LIBRARY_LANGUAGE_MISMATCH` | La librería ${row.logicalName} es para ${row.language}, no para ${language} | `src/modules/libraries/library.service.ts` |
| `LIBRARY_NOT_APPROVED` | La librería ${row.logicalName}@${row.version} está en estado ${row.status} | `src/modules/libraries/library.service.ts` |
| `LIBRARY_NOT_FOUND` | Alguna de las librerías seleccionadas no existe en este tenant | `src/modules/libraries/library.service.ts` |
| `LIBRARY_PRELUDE_NOT_IMPLEMENTED` | No existe una implementación autorizada de ${dto.packageName} para ${dto.language}. Las librerías solo pueden habilitar preludes ya revisados en el repositorio. | `src/modules/libraries/library.service.ts` |
| `LIVE_EXECUTION_DISABLED` | Live execution is disabled for this environment | `src/modules/live-execution/live-execution.controller.ts` |
| `LIVE_EXECUTION_PROD_FORBIDDEN` | Production decisions cannot be executed through live execution | `src/modules/live-execution/live-execution.controller.ts` |
| `LIVE_EXECUTION_VARIABLES_INVALID` | variables must be a JSON object | `src/modules/live-execution/live-execution.controller.ts` |
| `LOCK_CONFLICT` | The version was modified by another actor | `src/modules/artifacts/artifact-graph-writer.service.ts` |
| `MANUAL_REVIEW_ASSIGNEE_MISMATCH` | Only the analyst assigned to this manual review case may resolve it | `src/modules/manual-review/manual-review.service.ts` |
| `MANUAL_REVIEW_CLOSED` | Manual review case is already closed | `src/modules/manual-review/manual-review.service.ts` |
| `MANUAL_REVIEW_NOT_ASSIGNED` | Manual review case must be assigned before it can be resolved | `src/modules/manual-review/manual-review.service.ts` |
| `MANUAL_REVIEW_NOT_FOUND` | Manual review case not found | `src/modules/manual-review/manual-review.service.ts` |
| `MAX_EXECUTION_STEPS_EXCEEDED` | Execution exceeded ${this.maxSteps} steps | `src/modules/graph/execution-engine.service.ts` |
| `METRICS_DISABLED` | Metrics endpoint is disabled | `src/common/observability/metrics.controller.ts` |
| `MODEL_VALIDATION_NOT_INDEPENDENT` | Quien creó la versión no puede firmar su validación independiente. | `src/modules/risk-governance/risk-governance.service.ts` |
| `MONITORING_BATCH_EMPTY` | El lote de ${field} está vacío | `src/modules/model-monitoring/model-monitoring.service.ts` |
| `MONITORING_BATCH_TOO_LARGE` | Un lote admite como máximo ${MAX_BATCH} ${field}; divídalo | `src/modules/model-monitoring/model-monitoring.service.ts` |
| `NESTED_EXECUTION_FAILED` | — | `src/modules/nested-trees/nested-tree-execution.service.ts` |
| `NESTED_EXECUTION_TIMEOUT` | Nested artifact execution exceeded ${timeoutMs}ms | `src/modules/nested-trees/nested-tree-execution.service.ts` |
| `NESTED_REFERENCE_NOT_CONFIGURED` | RESULT node ${node.key} invokes a nested artifact reference, but no reference resolver was supplied to this execution | `src/modules/graph/execution-engine.service.ts` |
| `NESTED_TREE_MAX_ARTIFACTS_EXCEEDED` | La cadena supera los ${this.limits.maxArtifacts} artefactos encadenados (nodo ${nodeKey}) | `src/modules/nested-trees/chain-budget.ts` |
| `NESTED_TREE_MAX_DEPTH_EXCEEDED` | Nested execution depth ${cursor.depth} exceeds the configured maximum of ${maxDepth} | `src/modules/nested-trees/nested-tree-execution.service.ts` |
| `NESTED_TREE_MEMORY_EXCEEDED` | La cadena retiene ${this.retainedBytes} bytes de resultados y el máximo es ${this.limits.maxRetainedBytes} (nodo ${nodeKey}) | `src/modules/nested-trees/chain-budget.ts` |
| `NESTED_TREE_RESULT_TOO_LARGE` | El resultado de ${nodeKey} ocupa ${bytes} bytes y el máximo es ${this.limits.maxResultBytes} | `src/modules/nested-trees/chain-budget.ts` |
| `NESTED_TREE_TOTAL_TIMEOUT_EXCEEDED` | La cadena superó el tiempo total de ${this.limits.maxTotalMs} ms | `src/modules/nested-trees/chain-budget.ts` |
| `NODE_ACTION_NOT_FOUND` | Node ${node.key} references unknown action ${binding.actionCode} | `src/modules/artifacts/artifact-graph-writer.service.ts` |
| `NODE_CONDITION_NOT_FOUND` | Node ${node.key} references unknown condition ${binding.conditionCode} | `src/modules/artifacts/artifact-graph-writer.service.ts` |
| `NON_NUMERIC_DECISION_VALUE` | ${what} de ${code} no produjo un número finito | `src/modules/graph/execution-engine.service.ts` |
| `NOTIFICATION_NOT_FOUND` | Notification not found | `src/modules/notifications/notification.service.ts` |
| `NO_MATCHING_EDGE` | No outgoing edge matched node ${node.key} | `src/modules/graph/execution-engine.service.ts` |
| `OBJECTIVE_NOT_FOUND` | Business objective not found | `src/modules/traceability/traceability.service.ts` |
| `OUTCOME_BATCH_EMPTY` | El lote de ${field} está vacío | `src/modules/outcome-ingestion/outcome-ingestion.service.ts` |
| `OUTCOME_BATCH_TOO_LARGE` | Un lote admite como máximo ${MAX_BATCH} ${field}; divídalo | `src/modules/outcome-ingestion/outcome-ingestion.service.ts` |
| `OUTPUT_TYPE_INVALID` | Output ${code} cannot be null | `src/modules/graph/execution-engine.service.ts` |
| `POLICY_NOT_FOUND` | Policy requirement not found | `src/modules/traceability/traceability.service.ts` |
| `PRIMARY_OUTPUT_TOO_LONG` | Primary output ${code} exceeds 80 characters | `src/modules/graph/execution-engine.service.ts` |
| `QA_COUNTEREXAMPLE_NOT_FOUND` | Contraejemplo no encontrado | `src/modules/qa-lab/qa-lab.service.ts` |
| `QA_DISTRIBUTION_DUPLICATED` | La variable ${entry.variableCode} tiene más de una distribución declarada | `src/modules/qa-lab/qa-lab.service.ts` |
| `QA_DISTRIBUTION_VARIABLE_UNKNOWN` | La variable ${entry.variableCode} no es una entrada del contrato de esta versión | `src/modules/qa-lab/qa-lab.service.ts` |
| `QA_DISTRIBUTION_WEIGHT_INVALID` | El peso de ${entry.variableCode}.${value} debe ser un número finito no negativo | `src/modules/qa-lab/qa-lab.service.ts` |
| `QA_RUN_NOT_FOUND` | Corrida de QA no encontrada | `src/modules/qa-lab/qa-lab.service.ts` |
| `QA_RUN_OUTCOME_UNKNOWN` | Estos desenlaces no existen en la versión: ${unknown.join(', ')}. Los alcanzables son: ${reachable.join(', ')} | `src/modules/qa-lab/qa-lab.service.ts` |
| `QA_RUN_OUTCOME_WEIGHT_INVALID` | Los pesos por desenlace tienen que ser números no negativos | `src/modules/qa-lab/qa-lab.service.ts` |
| `QA_RUN_PROD_FORBIDDEN` | El QA Lab no puede ejecutarse contra PROD | `src/modules/qa-lab/qa-lab.service.ts` |
| `QA_VERSION_NOT_COMPILED` | La versión no tiene un artefacto compilado con éxito: compílala antes de generar casos | `src/modules/qa-lab/qa-lab.service.ts` |
| `RATE_LIMIT_EXCEEDED` | Too many requests | `src/common/security/rate-limit.guard.ts` |
| `REASON_CODE_NOT_FOUND` | Unknown reason codes in the output contract: ${missing.join(', ')} | `src/modules/artifacts/artifact-graph-writer.service.ts` |
| `REDIS_REQUIRED` | In-memory cache fallback is disabled in production | `src/common/cache/cache.service.ts` |
| `REDIS_UNAVAILABLE` | Redis is required but unavailable | `src/common/cache/cache.service.ts` |
| `REFERENCE_CONTRACT_INCOMPATIBLE` | El contrato del artefacto referenciado no puede satisfacerse: ${issues[0].message} | `src/modules/nested-trees/nested-tree.service.ts` |
| `REFERENCE_NOT_FOUND` | No artifact reference configured for node ${nodeKey} | `src/modules/nested-trees/nested-tree-execution.service.ts` |
| `REFERENCE_VERSION_POLICY_FORBIDDEN` | En PROD la referencia debe fijar una versión exacta: resolver la activa del ambiente haría la decisión irreproducible | `src/modules/nested-trees/nested-tree.service.ts` |
| `REIDENTIFICATION_ALREADY_DECIDED` | Esta solicitud ya se resolvió. Una autorización gastada no vale para la siguiente consulta. | `src/modules/risk-governance/risk-governance.service.ts` |
| `REIDENTIFICATION_NOT_FOUND` | La solicitud no existe | `src/modules/risk-governance/risk-governance.service.ts` |
| `REIDENTIFICATION_SELF_APPROVAL` | Quien pide una reidentificación no puede aprobarla. | `src/modules/risk-governance/risk-governance.service.ts` |
| `REQUEST_TIMEOUT` | Request exceeded ${this.timeoutMs} ms | `src/common/observability/request-timeout.interceptor.ts` |
| `REQUIRED_OUTPUT_MISSING` | Execution finished without required output ${contract.code} | `src/modules/graph/execution-engine.service.ts` |
| `RESOURCE_ALREADY_EXISTS` | Ya existe un registro con ese identificador único | `src/common/errors/domain-exception.filter.ts` |
| `RESULT_MODE_INVALID` | Unsupported RESULT mode ${mode} | `src/modules/graph/execution-engine.service.ts` |
| `RESULT_SCRIPT_LANGUAGE_INVALID` | — | `src/modules/graph/execution-engine.service.ts` |
| `ROLLBACK_TARGET_NOT_FOUND` | No previous deployment is available | `src/modules/deployments/deployment.service.ts` |
| `RUNTIME_ACTION_NOT_FOUND` | Action ${reference.code} not found | `src/modules/graph/execution-engine.service.ts` |
| `RUNTIME_CREDENTIAL_REQUIRED` | Runtime routes require a credential with a verifiable runtime audience | `src/common/security/authentication.guard.ts` |
| `RUNTIME_NODE_NOT_FOUND` | Compiled node ${currentKey} not found | `src/modules/graph/execution-engine.service.ts` |
| `SCRIPT_EXECUTION_FAILED` | RESULT ${language} script ${reason} | `src/modules/graph/script-node-runner.service.ts` |
| `SCRIPT_INVALID_OUTPUT` | RESULT script must return a JSON object | `src/modules/graph/script-node-runner.service.ts` |
| `SCRIPT_NODES_DISABLED` | Script RESULT nodes are disabled. Set SCRIPT_NODES_ENABLED=true only with an isolated runner. | `src/modules/graph/script-node-runner.service.ts` |
| `SCRIPT_RUNNER_INSECURE_IN_PRODUCTION` | The in-process script runner cannot execute in production; use SCRIPT_RUNNER_MODE=SIDECAR. | `src/modules/graph/script-node-runner.service.ts` |
| `SCRIPT_RUNNER_UNAVAILABLE` | Could not reach the isolated script runner: ${error.message} | `src/modules/graph/script-node-runner.service.ts` |
| `SCRIPT_SOURCE_TOO_LARGE` | Script exceeds ${this.maxSourceBytes} bytes | `src/modules/graph/script-node-runner.service.ts` |
| `SELF_REFERENCE_FORBIDDEN` | An artifact cannot directly reference itself | `src/modules/nested-trees/nested-tree.service.ts` |
| `SEMANTIC_CATEGORY_DUPLICATE_CODE` | El lote repite estos códigos: ${[...new Set(duplicados)].join(', ')}. | `src/modules/workers/semantic-analysis/semantic-category.service.ts` |
| `SEMANTIC_CATEGORY_HAS_ACTIVE_CHILDREN` | No se puede desactivar ${code}: tiene ${String(hijasActivas)} categoría(s) hija(s) activa(s). Desactívalas primero. | `src/modules/workers/semantic-analysis/semantic-category.service.ts` |
| `SEMANTIC_CATEGORY_NOT_FOUND` | No existe la categoría ${code}. | `src/modules/workers/semantic-analysis/semantic-category.service.ts` |
| `SEMANTIC_CATEGORY_PARENT_NOT_FOUND` | El padre ${parentCode} no existe en este tenant. | `src/modules/workers/semantic-analysis/semantic-category.service.ts` |
| `SEMANTIC_CATEGORY_SELF_PARENT` | Una categoría no puede ser su propio padre. | `src/modules/workers/semantic-analysis/semantic-category.service.ts` |
| `SEMANTIC_CATEGORY_TREE_BROKEN` | El árbol no se sostiene: hay un ciclo o un padre inexistente en ${rotas.join(', ')}. | `src/modules/workers/semantic-analysis/semantic-category.service.ts` |
| `SEMANTIC_INPUT_AMBIGUOUS` | Indica un texto o un escenario de prueba, no ambos. | `src/modules/workers/semantic-analysis/semantic-analysis.controller.ts` |
| `SEMANTIC_RUN_NOT_CANCELLABLE` | — | `src/modules/workers/semantic-analysis/semantic-analysis.service.ts` |
| `SEMANTIC_RUN_NOT_FOUND` | No existe ese análisis. | `src/modules/workers/semantic-analysis/semantic-analysis.service.ts` |
| `SEMANTIC_TEXT_EMPTY` | El texto a analizar está vacío. | `src/modules/workers/semantic-analysis/semantic-analysis.service.ts` |
| `SEMANTIC_TEXT_TOO_LONG` | El texto supera el máximo de ${maxLength} caracteres. | `src/modules/workers/semantic-analysis/semantic-analysis.service.ts` |
| `SEPARATION_OF_DUTIES_VIOLATION` | The version author cannot deploy the same version alone | `src/modules/deployments/deployment.service.ts` |
| `SERVICE_NOT_READY` | One or more required dependencies are unavailable | `src/modules/health/health.controller.ts` |
| `SIMULATION_PROD_FORBIDDEN` | El simulador no opera sobre PROD, tampoco para generar valores de prueba | `src/modules/runtime/sample-input.service.ts` |
| `SUBJECT_CONSENT_INVALID` | El titular tiene permisos que ya no amparan el tratamiento: | `src/modules/risk-governance/decision-guard.service.ts` |
| `SUBJECT_NOT_FOUND` | No hay ninguna decisión registrada sobre ese titular en este tenant. | `src/modules/risk-governance/risk-governance.service.ts` |
| `SUBJECT_REFERENCE_REQUIRED` | This environment requires subjectReference: a decision that cannot be attributed to | `src/modules/runtime/subject-policy.ts` |
| `TEST_RUN_NOT_CLAIMED` | Test run is missing or has not been claimed | `src/modules/testing/test-execution.service.ts` |
| `TEST_RUN_NOT_FOUND` | Test run not found | `src/modules/testing/test-execution.service.ts` |
| `TEST_SUITE_NOT_FOUND` | Test suite not found | `src/modules/testing/test-execution.service.ts` |
| `UNAUTHORIZED` | Invalid metrics token | `src/common/observability/metrics.controller.ts` |
| `UNDECLARED_OUTPUT` | RESULT node wrote undeclared output ${code} | `src/modules/graph/execution-engine.service.ts` |
| `UNRESOLVED_CATEGORY_REQUIRED` | Esta resolución necesita una categoría. | `src/modules/workers/semantic-analysis/unresolved-resolution.service.ts` |
| `UNRESOLVED_CLASSIFICATION_NOT_FOUND` | No existe el pendiente ${id}. | `src/modules/workers/semantic-analysis/unresolved-classification.service.ts` |
| `UNRESOLVED_NEW_CATEGORY_REQUIRED` | Para crear una categoría hay que enviarla. | `src/modules/workers/semantic-analysis/unresolved-resolution.service.ts` |
| `UNSUPPORTED_ACTION_TYPE` | Unsupported action type ${action.type} | `src/modules/graph/execution-engine.service.ts` |
| `UNSUPPORTED_EXPRESSION_OPERATOR` | Unsupported operator: ${op} | `src/modules/graph/expression-evaluator.ts` |
| `UNTRUSTED_ORIGIN` | Request origin is not allowed | `src/modules/identity-session/session-origin.service.ts` |
| `VALIDATION_REQUIRED` | Graph is no longer valid and cannot be compiled | `src/modules/artifacts/artifact-lifecycle.service.ts` |
| `VARIABLE_CONTRACT_INCOMPATIBLE` | El cambio rompe el contrato y ${deployedUses} versión(es) aprobadas o desplegadas usan esta variable | `src/modules/variables/variable-contract.service.ts` |
| `VARIABLE_CONTRACT_INVALID` | El contrato de ${dto.variableCode} no es válido: ${contract.issues[0].message} | `src/modules/variables/variable.service.ts` |
| `VARIABLE_DEPENDENCY_NOT_FOUND` | One or more variable versions do not exist in this tenant | `src/modules/artifacts/artifact-graph-writer.service.ts` |
| `VARIABLE_NOT_FOUND` | Variable definition not found | `src/modules/variables/variable.service.ts` |
| `VERSION_IMMUTABLE` | Only DRAFT or VALIDATION_FAILED versions are editable; current state is ${version.status} | `src/modules/artifacts/artifact-graph-writer.service.ts` |
| `VERSION_NOT_APPROVED` | Version is not fully approved | `src/modules/governance/governance.service.ts` |
| `VERSION_NOT_COMPILABLE` | No se puede compilar una versión en estado ${version.status}: sólo se compila lo que está VALIDATED. Si ya está desplegada, crea una versión nueva. | `src/modules/artifacts/artifact-lifecycle.service.ts` |
| `VERSION_NOT_FOUND` | Artifact version not found | `src/modules/artifacts/artifact-graph-reader.service.ts` |
| `VERSION_NOT_REVIEWABLE` | Version must be COMPILED before review | `src/modules/governance/governance.service.ts` |
| `VERSION_NOT_VALIDATABLE` | Version in state ${version.status} cannot be validated | `src/modules/artifacts/artifact-lifecycle.service.ts` |
| `WORKER_ARGUMENT_INVALID` | El argumento ${argumento} que el nodo ${request.nodeKey} envía no es base64 válido | `src/modules/workers/worker-service-invoker.service.ts` |
| `WORKER_ARGUMENT_MISSING` | El nodo ${request.nodeKey} llama a semantic-analysis.classify sin el argumento text | `src/modules/workers/worker-service-invoker.service.ts` |
| `WORKER_ARGUMENT_TOO_LONG` | El texto que el nodo ${request.nodeKey} envía a clasificar supera los ${maxLength} caracteres | `src/modules/workers/worker-service-invoker.service.ts` |
| `WORKER_FIXTURES_DISABLED` | Los escenarios de prueba están deshabilitados en este entorno. | `src/modules/workers/audio-tts/audio-tts.controller.ts` |
| `WORKER_FIXTURE_NOT_FOUND` | No existe ese escenario de prueba. | `src/modules/workers/audio-tts/audio-tts.controller.ts` |
| `WORKER_NOT_FOUND` | Este motor no publica ningún worker con ese código. | `src/modules/workers/workers.controller.ts` |
| `WORKER_SERVICE_FAILED` | La llamada del nodo ${request.nodeKey} a ${request.service}.${request.operation} falló: | `src/modules/workers/worker-service-invoker.service.ts` |
| `WORKER_SERVICE_NOT_CONFIGURED` | El nodo ${node.key} llama al servicio ${call.service}, pero esta ejecución no recibió un invocador de servicios | `src/modules/graph/execution-engine.service.ts` |
| `WORKER_SERVICE_TIMEOUT` | La llamada del nodo ${request.nodeKey} a ${request.service}.${request.operation} superó ${timeoutMs} ms | `src/modules/workers/worker-service-invoker.service.ts` |
| `WORKER_SERVICE_UNAVAILABLE` | El nodo ${nodeKey} llama al servicio ${service}, que no está habilitado en este despliegue | `src/modules/workers/worker-service-invoker.service.ts` |
| `WORKER_SERVICE_UNKNOWN` | El nodo ${request.nodeKey} invoca ${key}, que este motor no sabe ejecutar | `src/modules/workers/worker-service-invoker.service.ts` |

