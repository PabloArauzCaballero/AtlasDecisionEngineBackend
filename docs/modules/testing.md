<!-- GENERADO POR scripts/docs/generate-catalogs.mjs — NO EDITAR A MANO.
     Fuente: src/modules/testing/. Ejecute `yarn docs:catalog` tras cambiar el código. -->

# Módulo `testing`


## Responsabilidad

Código: [`src/modules/testing/`](https://github.com/) · 8 ficheros TypeScript.

Etiquetas de API: **Decision Testing**.

## Endpoints

| Método | Ruta | Operación | Resumen |
| --- | --- | --- | --- |
| `POST` | `/v1/artifact-versions/{versionId}/test-suites` | `testingCreateSuite` | Create a version-scoped suite with initial cases |
| `GET` | `/v1/artifact-versions/{versionId}/test-suites` | `testingListSuites` | List suites and recent run evidence for a version |
| `GET` | `/v1/test-runs/{runId}` | `testingGetRun` | Get run status, assertions and graph coverage |
| `GET` | `/v1/test-suites/{suiteId}/cases` | `testingListCases` | List deterministic cases in a suite |
| `POST` | `/v1/test-suites/{suiteId}/cases` | `testingCreateCase` | Add one case to a suite |
| `POST` | `/v1/test-suites/{suiteId}/cases/import` | `testingImportCases` | Add a bounded batch of cases to a suite |
| `POST` | `/v1/test-suites/{suiteId}/runs` | `testingRun` | Queue an asynchronous test run |

## Autorización

Roles exigidos por sus rutas: `AUDITOR`, `COMPLIANCE`, `FRAUD_ANALYST`, `QA_ANALYST`, `RISK_ANALYST`. La decisión es del servidor (`RolesGuard`), nunca del frontend.

## Códigos de error propios

- `BASELINE_COMPARISON_NOT_SUPPORTED`
- `COMPILED_ARTIFACT_NOT_FOUND`
- `TEST_RUN_NOT_CLAIMED`
- `TEST_RUN_NOT_FOUND`
- `TEST_SUITE_NOT_FOUND`
- `VERSION_NOT_FOUND`

## Clases exportadas

- `CreateTestSuiteDto`
- `ImportTestCasesDto`
- `RunTestSuiteDto`
- `TestCaseDto`
- `TestCaseExecutorService`
- `TestCaseRecordDto`
- `TestExecutionService`
- `TestRunDetailDto`
- `TestRunQueuedDto`
- `TestRunWorkerService`
- `TestSuiteCreatedDto`
- `TestSuiteListQueryDto`
- `TestSuiteService`
- `TestSuiteWithEvidenceDto`
- `TestingController`
- `TestingModule`
