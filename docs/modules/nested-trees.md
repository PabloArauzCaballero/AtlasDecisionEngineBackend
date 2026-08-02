<!-- GENERADO POR scripts/docs/generate-catalogs.mjs — NO EDITAR A MANO.
     Fuente: src/modules/nested-trees/. Ejecute `yarn docs:catalog` tras cambiar el código. -->

# Módulo `nested-trees`


## Responsabilidad

Código: [`src/modules/nested-trees/`](https://github.com/) · 9 ficheros TypeScript.

Etiquetas de API: **Nested Decision Trees**.

## Endpoints

| Método | Ruta | Operación | Resumen |
| --- | --- | --- | --- |
| `POST` | `/v1/artifact-versions/{versionId}/references` | `nestedTreeCreate` | Create a validated child-artifact reference |
| `GET` | `/v1/artifact-versions/{versionId}/references` | `nestedTreeList` | List references owned by an artifact version |
| `PUT` | `/v1/artifact-versions/{versionId}/references/{referenceId}` | `nestedTreeUpdate` | Update mappings, timeout or error policy of a reference |
| `DELETE` | `/v1/artifact-versions/{versionId}/references/{referenceId}` | `nestedTreeRemove` | Delete a reference from an editable parent version |
| `GET` | `/v1/artifacts/{artifactId}/dependency-graph` | `dependencyGraphGet` | Get upstream and downstream artifact dependencies |

## Autorización

Roles exigidos por sus rutas: `AUDITOR`, `COMPLIANCE`, `FRAUD_ANALYST`, `QA_ANALYST`, `RISK_ANALYST`. La decisión es del servidor (`RolesGuard`), nunca del frontend.

## Códigos de error propios

- `CHILD_ARTIFACT_NOT_FOUND`
- `CHILD_VERSION_NOT_COMPILED`
- `CHILD_VERSION_NOT_FOUND`
- `CIRCULAR_ARTIFACT_REFERENCE`
- `FORBIDDEN`
- `NESTED_EXECUTION_FAILED`
- `NESTED_EXECUTION_TIMEOUT`
- `NESTED_TREE_MAX_ARTIFACTS_EXCEEDED`
- `NESTED_TREE_MAX_DEPTH_EXCEEDED`
- `NESTED_TREE_MEMORY_EXCEEDED`
- `NESTED_TREE_RESULT_TOO_LARGE`
- `NESTED_TREE_TOTAL_TIMEOUT_EXCEEDED`
- `REFERENCE_CONTRACT_INCOMPATIBLE`
- `REFERENCE_NOT_FOUND`
- `REFERENCE_VERSION_POLICY_FORBIDDEN`
- `SELF_REFERENCE_FORBIDDEN`
- `VERSION_IMMUTABLE`
- `VERSION_NOT_FOUND`

## Clases exportadas

- `ArtifactReferenceDto`
- `ChainBudget`
- `CreateArtifactReferenceDto`
- `DependencyGraphController`
- `DependencyGraphResponseDto`
- `InputMappingEntryDto`
- `NestedTreeController`
- `NestedTreeExecutionService`
- `NestedTreeService`
- `NestedTreesModule`
- `OutputMappingEntryDto`
- `ReferenceListQueryDto`
- `UpdateArtifactReferenceDto`
