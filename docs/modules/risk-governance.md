<!-- GENERADO POR scripts/docs/generate-catalogs.mjs — NO EDITAR A MANO.
     Fuente: src/modules/risk-governance/. Ejecute `yarn docs:catalog` tras cambiar el código. -->

# Módulo `risk-governance`


## Responsabilidad

Código: [`src/modules/risk-governance/`](https://github.com/) · 9 ficheros TypeScript.

Etiquetas de API: **Risk Governance**.

## Endpoints

| Método | Ruta | Operación | Resumen |
| --- | --- | --- | --- |
| `POST` | `/v1/risk-governance/calibration` | `riskGovernanceCalibrate` | Compute and store the calibration curve of a deployed version |
| `GET` | `/v1/risk-governance/calibration` | `riskGovernanceStoredCalibration` | Last stored calibration curve, without recomputing |
| `POST` | `/v1/risk-governance/consents` | `riskGovernanceRecordConsent` | Record a data subject consent with its validity window |
| `POST` | `/v1/risk-governance/consents/lookup` | `riskGovernanceConsents` | Consents of one data subject, each with its verdict for today |
| `POST` | `/v1/risk-governance/consents/revoke` | `riskGovernanceRevokeConsent` | Revoke a consent |
| `GET` | `/v1/risk-governance/limits` | `riskGovernanceListLimits` | Portfolio exposure limits with their current utilisation |
| `POST` | `/v1/risk-governance/limits` | `riskGovernanceUpsertLimit` | Create or update a portfolio exposure limit |
| `POST` | `/v1/risk-governance/model-dossier` | `riskGovernanceRecordDossier` | Record independent validation and revalidation due date of a version |
| `POST` | `/v1/risk-governance/portfolio-state` | `riskGovernanceRecordPortfolioState` | Record a portfolio metric observation (exposure, PAR30, budget…) |
| `GET` | `/v1/risk-governance/reidentifications` | `riskGovernanceListReidentifications` | Reidentification requests and who decided them |
| `POST` | `/v1/risk-governance/reidentifications` | `riskGovernanceRequestReidentification` | Ask to reidentify a pseudonymous subject, stating why |
| `POST` | `/v1/risk-governance/reidentifications/decide` | `riskGovernanceDecideReidentification` | Approve or reject a reidentification request |

## Autorización

Roles exigidos por sus rutas: `AUDITOR`, `COMPLIANCE`, `OPERATIONS`, `RISK_ANALYST`, `RISK_APPROVER`. La decisión es del servidor (`RolesGuard`), nunca del frontend.

## Códigos de error propios

- `EXPOSURE_LIMIT_EXCEEDED`
- `MODEL_VALIDATION_NOT_INDEPENDENT`
- `REIDENTIFICATION_ALREADY_DECIDED`
- `REIDENTIFICATION_NOT_FOUND`
- `REIDENTIFICATION_SELF_APPROVAL`
- `SUBJECT_CONSENT_INVALID`
- `SUBJECT_NOT_FOUND`
- `VERSION_NOT_FOUND`

## Clases exportadas

- `CalibrationReportDto`
- `CalibrationRequestDto`
- `CalibrationService`
- `ConsentListDto`
- `DecideReidentificationDto`
- `DecisionGuardService`
- `ExposureLimitListDto`
- `GovernanceWriteResultDto`
- `RecordConsentDto`
- `RecordModelDossierDto`
- `RecordPortfolioStateDto`
- `ReidentificationListDto`
- `RequestReidentificationDto`
- `RevokeConsentDto`
- `RiskGovernanceController`
- `RiskGovernanceModule`
- `RiskGovernanceService`
- `UpsertExposureLimitDto`
