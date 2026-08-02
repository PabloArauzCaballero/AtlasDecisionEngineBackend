<!-- GENERADO POR scripts/docs/generate-catalogs.mjs — NO EDITAR A MANO.
     Fuente: src/modules/traceability/. Ejecute `yarn docs:catalog` tras cambiar el código. -->

# Módulo `traceability`


## Responsabilidad

Código: [`src/modules/traceability/`](https://github.com/) · 5 ficheros TypeScript.

Etiquetas de API: **Requirements Traceability**.

## Endpoints

| Método | Ruta | Operación | Resumen |
| --- | --- | --- | --- |
| `GET` | `/v1/traceability/coverage-matrix` | `traceabilityCoverageMatrix` | Compute objective-to-policy evidence coverage |
| `POST` | `/v1/traceability/objectives` | `traceabilityCreate` | Create a business objective and its policy requirements |
| `GET` | `/v1/traceability/objectives` | `traceabilityList` | List business objectives and policies |
| `GET` | `/v1/traceability/objectives/{objectiveId}` | `traceabilityGetObjective` | Get one objective with linked evidence |
| `POST` | `/v1/traceability/policies/{policyId}/artifacts` | `traceabilityLinkArtifact` | Link a policy requirement to an artifact version |
| `POST` | `/v1/traceability/policies/{policyId}/test-suites` | `traceabilityLinkTest` | Link a policy requirement to a test suite |

## Autorización

Roles exigidos por sus rutas: `AUDITOR`, `COMPLIANCE`, `QA_ANALYST`, `RISK_ANALYST`. La decisión es del servidor (`RolesGuard`), nunca del frontend.

## Códigos de error propios

- `OBJECTIVE_NOT_FOUND`
- `POLICY_NOT_FOUND`
- `TEST_SUITE_NOT_FOUND`
- `VERSION_NOT_FOUND`

## Clases exportadas

- `BusinessObjectiveCreatedDto`
- `BusinessObjectiveDetailDto`
- `BusinessObjectiveListItemDto`
- `CoverageMatrixDto`
- `CreateBusinessObjectiveDto`
- `LinkPolicyArtifactDto`
- `LinkPolicyTestSuiteDto`
- `ObjectiveListQueryDto`
- `PolicyArtifactLinkCreatedDto`
- `PolicyRequirementDto`
- `PolicyTestLinkCreatedDto`
- `TraceabilityController`
- `TraceabilityModule`
- `TraceabilityService`
