<!-- GENERADO POR scripts/docs/generate-catalogs.mjs — NO EDITAR A MANO.
     Fuente: src/modules/code-import/. Ejecute `yarn docs:catalog` tras cambiar el código. -->

# Módulo `code-import`


## Responsabilidad

Código: [`src/modules/code-import/`](https://github.com/) · 14 ficheros TypeScript.

Etiquetas de API: **Code to Flow Import**.

## Endpoints

| Método | Ruta | Operación | Resumen |
| --- | --- | --- | --- |
| `POST` | `/v1/code-imports` | `codeImportAnalyze` | Analyze source code and create a graph preview |
| `GET` | `/v1/code-imports` | `codeImportList` | List code-import analyses |
| `GET` | `/v1/code-imports/{id}` | `codeImportGet` | Get source, contract, issues and generated graph |
| `POST` | `/v1/code-imports/{id}/cancel` | `codeImportCancel` | Cancel a code import without changing an artifact |
| `POST` | `/v1/code-imports/{id}/confirm` | `codeImportConfirm` | Write, validate and compile an analyzed import |
| `POST` | `/v1/code-imports/{id}/save-draft` | `codeImportSaveDraft` | Write the generated graph into an editable artifact version |

## Autorización

Roles exigidos por sus rutas: `AUDITOR`, `FRAUD_ANALYST`, `QA_ANALYST`, `RISK_ANALYST`. La decisión es del servidor (`RolesGuard`), nunca del frontend.

## Códigos de error propios

- `CODE_IMPORT_HAS_BLOCKING_ISSUES`
- `CODE_IMPORT_NOT_FOUND`
- `CODE_IMPORT_REASON_CODE_MISSING`
- `CODE_IMPORT_SOURCE_TOO_LARGE`
- `CODE_IMPORT_VARIABLE_NOT_IN_CATALOG`

## Clases exportadas

- `AnalyzeCodeImportDto`
- `BranchExtractorService`
- `CodeImportAnalyzedDto`
- `CodeImportConfirmedDto`
- `CodeImportController`
- `CodeImportDraftSavedDto`
- `CodeImportListQueryDto`
- `CodeImportModule`
- `CodeImportRecordDto`
- `CodeImportService`
- `ContractExtractorService`
- `ContractValidatorService`
- `ExpressionParseError`
- `GraphGeneratorService`
- `SaveCodeImportDto`
- `SecurityAnalyzerService`
- `SyntaxAnalyzerService`
