<!-- GENERADO POR scripts/docs/generate-catalogs.mjs — NO EDITAR A MANO.
     Fuente: src/modules/variables/. Ejecute `yarn docs:catalog` tras cambiar el código. -->

# Módulo `variables`


## Responsabilidad

Código: [`src/modules/variables/`](https://github.com/) · 8 ficheros TypeScript.

Etiquetas de API: **Variable Catalog**.

## Endpoints

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

## Autorización

Roles exigidos por sus rutas: `AUDITOR`, `COMPLIANCE`, `FRAUD_ANALYST`, `OPERATIONS`, `PLATFORM_ADMIN`, `QA_ANALYST`, `RISK_ANALYST`. La decisión es del servidor (`RolesGuard`), nunca del frontend.

## Códigos de error propios

- `VARIABLE_CONTRACT_INCOMPATIBLE`
- `VARIABLE_CONTRACT_INVALID`
- `VARIABLE_NOT_FOUND`

## Clases exportadas

- `CreateReasonCodeDto`
- `CreateVariableDefinitionDto`
- `CreateVariableVersionDto`
- `ReasonCodeCreatedDto`
- `ReasonCodeListQueryDto`
- `UpdateVariableDefinitionDto`
- `ValidateVariableContractDto`
- `VariableContractService`
- `VariableController`
- `VariableDependenciesDto`
- `VariableListQueryDto`
- `VariableModule`
- `VariableResolutionService`
- `VariableService`
- `VariableSourceDto`
- `VariableValidationRuleDto`
- `VariableVersionDto`
