<!-- GENERADO POR scripts/docs/generate-catalogs.mjs — NO EDITAR A MANO.
     Fuente: src/modules/qa-lab/. Ejecute `yarn docs:catalog` tras cambiar el código. -->

# Módulo `qa-lab`


## Responsabilidad

Código: [`src/modules/qa-lab/`](https://github.com/) · 13 ficheros TypeScript.

Etiquetas de API: **QA Lab**.

## Endpoints

| Método | Ruta | Operación | Resumen |
| --- | --- | --- | --- |
| `POST` | `/v1/qa-lab/counterexamples/{counterexampleId}/replay` | `qaLabReplay` | Volver a ejecutar un contraejemplo archivado |
| `GET` | `/v1/qa-lab/properties` | `qaLabProperties` | Propiedades que el QA Lab verifica en cada ejecución |
| `GET` | `/v1/qa-lab/runs` | `qaLabListRuns` | Historial de corridas generativas |
| `GET` | `/v1/qa-lab/runs/{runId}` | `qaLabGetRun` | Detalle de una corrida con sus contraejemplos mínimos |
| `POST` | `/v1/qa-lab/versions/{versionId}/runs` | `qaLabRun` | Generar y ejecutar un lote de casos contra una versión compilada |
| `POST` | `/v1/qa-lab/versions/{versionId}/sample-inputs` | `qaLabSampleInputs` | Generar valores de prueba de una versión compilada, sin ejecutarlos |

## Autorización

Roles exigidos por sus rutas: `AUDITOR`, `COMPLIANCE`, `FRAUD_ANALYST`, `PLATFORM_ADMIN`, `QA_ANALYST`, `RISK_ANALYST`. La decisión es del servidor (`RolesGuard`), nunca del frontend.

## Códigos de error propios

- `ARTIFACT_HAS_NO_INPUTS`
- `QA_COUNTEREXAMPLE_NOT_FOUND`
- `QA_DISTRIBUTION_DUPLICATED`
- `QA_DISTRIBUTION_VARIABLE_UNKNOWN`
- `QA_DISTRIBUTION_WEIGHT_INVALID`
- `QA_RUN_NOT_FOUND`
- `QA_RUN_PROD_FORBIDDEN`
- `QA_VERSION_NOT_COMPILED`

## Clases exportadas

- `GenerateQaRunDto`
- `GenerateSampleCasesDto`
- `QaLabController`
- `QaLabModule`
- `QaLabService`
- `QaReplayResultDto`
- `QaRunDto`
- `QaRunListItemDto`
- `QaRunQueryDto`
- `ReplayCounterexampleDto`
- `SampleCaseDto`
- `SeededRandom`
- `SimulatorSampleInputsDto`
- `VariableDistributionDto`
- `VersionSampleInputsDto`
