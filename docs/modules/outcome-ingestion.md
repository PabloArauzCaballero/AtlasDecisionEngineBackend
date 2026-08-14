<!-- GENERADO POR scripts/docs/generate-catalogs.mjs — NO EDITAR A MANO.
     Fuente: src/modules/outcome-ingestion/. Ejecute `yarn docs:catalog` tras cambiar el código. -->

# Módulo `outcome-ingestion`


## Responsabilidad

Código: [`src/modules/outcome-ingestion/`](https://github.com/) · 6 ficheros TypeScript.

Etiquetas de API: **Outcome Ingestion**.

## Endpoints

| Método | Ruta | Operación | Resumen |
| --- | --- | --- | --- |
| `POST` | `/v1/outcomes/batch` | `outcomeIngestionRecordBatch` | Record observed outcomes for known facilities, row by row |
| `POST` | `/v1/outcomes/facilities` | `outcomeIngestionRegisterFacilities` | Register disbursed credit facilities and schedule their outcome windows |
| `GET` | `/v1/outcomes/pending` | `outcomeIngestionPending` | Overdue observation windows nobody has closed |
| `GET` | `/v1/outcomes/vintage` | `outcomeIngestionVintage` | Vintage matrix: bad rate by decision cohort and maturity window |

## Autorización

Roles exigidos por sus rutas: `AUDITOR`, `COMPLIANCE`, `OPERATIONS`, `RISK_ANALYST`, `RISK_APPROVER`. La decisión es del servidor (`RolesGuard`), nunca del frontend.

## Códigos de error propios

- `OUTCOME_BATCH_EMPTY`
- `OUTCOME_BATCH_TOO_LARGE`

## Clases exportadas

- `FacilityOutcomeBatchDto`
- `FacilityOutcomeDto`
- `FacilityRegistrationResultDto`
- `OutcomeBatchResultDto`
- `OutcomeIngestionController`
- `OutcomeIngestionModule`
- `OutcomeIngestionService`
- `PendingWindowsDto`
- `PendingWindowsQueryDto`
- `RegisterFacilityBatchDto`
- `RegisterFacilityDto`
- `RowResultDto`
- `VintageMatrixDto`
- `VintageQueryDto`
- `VintageService`
