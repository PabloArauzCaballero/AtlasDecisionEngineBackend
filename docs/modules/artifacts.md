<!-- GENERADO POR scripts/docs/generate-catalogs.mjs — NO EDITAR A MANO.
     Fuente: src/modules/artifacts/. Ejecute `yarn docs:catalog` tras cambiar el código. -->

# Módulo `artifacts`


## Responsabilidad

Código: [`src/modules/artifacts/`](https://github.com/) · 12 ficheros TypeScript.

Etiquetas de API: **Decision Artifacts**.

## Endpoints

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

## Autorización

Roles exigidos por sus rutas: `AUDITOR`, `COMPLIANCE`, `FRAUD_ANALYST`, `OPERATIONS`, `QA_ANALYST`, `RISK_ANALYST`. La decisión es del servidor (`RolesGuard`), nunca del frontend.

## Códigos de error propios

- `ARTIFACT_NOT_FOUND`
- `CALCULATED_FIELD_LIBRARY_BLOCKED`
- `CALCULATED_FIELD_NOT_USABLE`
- `CALCULATED_FIELD_VERSION_NOT_FOUND`
- `CHECKSUM_MISMATCH`
- `EDGE_CONDITION_NOT_FOUND`
- `EDGE_NODE_NOT_FOUND`
- `INVALID_VERSION_TRANSITION`
- `LOCK_CONFLICT`
- `NODE_ACTION_NOT_FOUND`
- `NODE_CONDITION_NOT_FOUND`
- `REASON_CODE_NOT_FOUND`
- `VALIDATION_REQUIRED`
- `VARIABLE_DEPENDENCY_NOT_FOUND`
- `VERSION_IMMUTABLE`
- `VERSION_NOT_COMPILABLE`
- `VERSION_NOT_FOUND`
- `VERSION_NOT_VALIDATABLE`

## Clases exportadas

- `ActionDto`
- `ActionReasonDto`
- `ArtifactController`
- `ArtifactCreatedDto`
- `ArtifactDetailDto`
- `ArtifactDetailVersionDto`
- `ArtifactGraphReaderService`
- `ArtifactGraphSnapshotDto`
- `ArtifactGraphWriterService`
- `ArtifactLifecycleService`
- `ArtifactListItemDto`
- `ArtifactListQueryDto`
- `ArtifactModule`
- `ArtifactService`
- `ArtifactVersionClonedDto`
- `ArtifactVersionDetailDto`
- `ArtifactVersionDiffDto`
- `ArtifactVersionStatusHistoryDto`
- `CalculatedFieldBindingService`
- `CalculatedFieldCallDto`
- `CalculatedFieldInputSourceDto`
- `CloneVersionDto`
- `CompiledArtifactSummaryDto`
- `ConditionDto`
- `ContractExtensionsDto`
- `CreateArtifactDto`
- `DependencyDto`
- `EdgeConditionBindingDto`
- `EdgeDto`
- `GraphValidationReportDto`
- `IntermediateVariableDto`
- `NodeActionBindingDto`
- `NodeConditionBindingDto`
- `NodeDto`
- `OutputContractFieldDto`
- `PdfArtifactContractAdapter`
- `ProcessingBasisDto`
- `ProcessingBasisResultDto`
- `ReplaceGraphDto`
- `UpdateVersionNotesDto`
- `ValidateAndCompileResultDto`
- `VersionStateService`
- `VersionWriteResultDto`
