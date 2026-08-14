<!-- GENERADO POR scripts/docs/generate-catalogs.mjs — NO EDITAR A MANO.
     Fuente: src/modules/calculated-fields/. Ejecute `yarn docs:catalog` tras cambiar el código. -->

# Módulo `calculated-fields`


## Responsabilidad

Código: [`src/modules/calculated-fields/`](https://github.com/) · 14 ficheros TypeScript.

Etiquetas de API: **Calculated Fields**.

## Endpoints

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

## Autorización

Roles exigidos por sus rutas: `AUDITOR`, `COMPLIANCE`, `FRAUD_ANALYST`, `PLATFORM_ADMIN`, `QA_ANALYST`, `RISK_ANALYST`. La decisión es del servidor (`RolesGuard`), nunca del frontend.

## Códigos de error propios

- `CALCULATED_FIELD_ARGUMENT_INVALID`
- `CALCULATED_FIELD_CODE_TAKEN`
- `CALCULATED_FIELD_CONTRACT_INVALID`
- `CALCULATED_FIELD_CONVERSION_FAILED`
- `CALCULATED_FIELD_DIVISION_BY_ZERO`
- `CALCULATED_FIELD_HAS_NO_INPUTS`
- `CALCULATED_FIELD_INPUT_INVALID`
- `CALCULATED_FIELD_INPUT_MISSING`
- `CALCULATED_FIELD_LIBRARY_UNAVAILABLE`
- `CALCULATED_FIELD_NOT_FOUND`
- `CALCULATED_FIELD_OPERATION_MISSING`
- `CALCULATED_FIELD_OPERATION_UNKNOWN`
- `CALCULATED_FIELD_TESTS_FAILED`
- `CALCULATED_FIELD_TRANSITION_INVALID`
- `CALCULATED_FIELD_TREE_TOO_DEEP`
- `CALCULATED_FIELD_TREE_TOO_LARGE`
- `CALCULATED_FIELD_VERSION_IN_USE`
- `CALCULATED_FIELD_VERSION_NOT_FOUND`

## Clases exportadas

- `CalculatedFieldCommentsDto`
- `CalculatedFieldController`
- `CalculatedFieldCreatedDto`
- `CalculatedFieldDetailDto`
- `CalculatedFieldExecutorService`
- `CalculatedFieldInputDto`
- `CalculatedFieldListItemDto`
- `CalculatedFieldOutcomeCoverageDto`
- `CalculatedFieldOutcomeCoverageReportDto`
- `CalculatedFieldPreviewService`
- `CalculatedFieldPreviewTryRunDto`
- `CalculatedFieldPromotedDto`
- `CalculatedFieldQueryDto`
- `CalculatedFieldReturnDto`
- `CalculatedFieldService`
- `CalculatedFieldTestCaseDto`
- `CalculatedFieldTestReportDto`
- `CalculatedFieldTryRunDto`
- `CalculatedFieldVersionCreatedDto`
- `CalculatedFieldsModule`
- `CreateCalculatedFieldDto`
- `CreateCalculatedFieldVersionDto`
- `OperationCatalogDto`
- `PreviewCalculatedFieldDto`
- `PreviewOutcomeCoverageDto`
- `PreviewSampleCalculatedFieldInputsDto`
- `PreviewTryCalculatedFieldDto`
- `PromoteCalculatedFieldVersionDto`
- `SampleCalculatedFieldInputsDto`
- `TryCalculatedFieldDto`
