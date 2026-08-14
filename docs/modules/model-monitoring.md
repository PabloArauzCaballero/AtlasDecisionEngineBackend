<!-- GENERADO POR scripts/docs/generate-catalogs.mjs — NO EDITAR A MANO.
     Fuente: src/modules/model-monitoring/. Ejecute `yarn docs:catalog` tras cambiar el código. -->

# Módulo `model-monitoring`


## Responsabilidad

Código: [`src/modules/model-monitoring/`](https://github.com/) · 12 ficheros TypeScript.

Etiquetas de API: **Model Monitoring**.

## Endpoints

| Método | Ruta | Operación | Resumen |
| --- | --- | --- | --- |
| `GET` | `/v1/model-monitoring/ab` | `modelMonitoringAbComparison` | Champion vs challenger compared by observed outcome |
| `POST` | `/v1/model-monitoring/adverse-impact` | `modelMonitoringAdverseImpact` | Adverse impact ratio per group (four-fifths rule) |
| `POST` | `/v1/model-monitoring/attributes` | `modelMonitoringRecordAttributes` | Record monitoring-only demographic attributes for bias testing |
| `GET` | `/v1/model-monitoring/coverage` | `modelMonitoringCoverage` | Coverage of the decision feedback loop: subjects and outcomes |
| `GET` | `/v1/model-monitoring/cutoff-analysis` | `modelMonitoringCutoffAnalysis` | Approval and loss trade-off at every possible score cutoff |
| `POST` | `/v1/model-monitoring/outcomes` | `modelMonitoringRecordOutcomes` | Record the realized outcome of decisions already taken |
| `POST` | `/v1/model-monitoring/performance` | `modelMonitoringPerformance` | Outcome analysis: realized rates against the decisions taken |
| `POST` | `/v1/model-monitoring/stability` | `modelMonitoringStability` | Population stability index between a reference and current window |

## Autorización

Roles exigidos por sus rutas: `AUDITOR`, `COMPLIANCE`, `OPERATIONS`, `RISK_ANALYST`, `RISK_APPROVER`. La decisión es del servidor (`RolesGuard`), nunca del frontend.

## Códigos de error propios

- `EXECUTION_NOT_FOUND`
- `MONITORING_BATCH_EMPTY`
- `MONITORING_BATCH_TOO_LARGE`
- `VERSION_NOT_FOUND`

## Clases exportadas

- `AdverseImpactQueryDto`
- `AdverseImpactReportDto`
- `BaselineCaptureService`
- `CoverageQueryDto`
- `CutoffAnalysisService`
- `DecisionCoverageDto`
- `DecisionCoverageService`
- `ModelMonitoringController`
- `ModelMonitoringModule`
- `ModelMonitoringService`
- `MonitoringEvaluatorService`
- `MonitoringWindowQueryDto`
- `MonitoringWriteResultDto`
- `PerformanceReportDto`
- `RecordMonitoringAttributeBatchDto`
- `RecordMonitoringAttributeDto`
- `RecordOutcomeBatchDto`
- `RecordOutcomeDto`
- `StabilityQueryDto`
- `StabilityReportDto`
