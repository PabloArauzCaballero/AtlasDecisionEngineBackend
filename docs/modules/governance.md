<!-- GENERADO POR scripts/docs/generate-catalogs.mjs — NO EDITAR A MANO.
     Fuente: src/modules/governance/. Ejecute `yarn docs:catalog` tras cambiar el código. -->

# Módulo `governance`


## Responsabilidad

Código: [`src/modules/governance/`](https://github.com/) · 5 ficheros TypeScript.

Etiquetas de API: **Decision Governance**.

## Endpoints

| Método | Ruta | Operación | Resumen |
| --- | --- | --- | --- |
| `GET` | `/v1/approval-requests` | `governanceList` | List the tenant approval queue |
| `GET` | `/v1/approval-requests/{requestId}` | `governanceGet` | Get one approval request and all evidence |
| `POST` | `/v1/approval-steps/{stepId}/decisions` | `governanceDecide` | Record a role-authorized approval decision |
| `POST` | `/v1/artifact-versions/{versionId}/submit-for-review` | `governanceSubmit` | Submit a validated version for ordered review |

## Autorización

Roles exigidos por sus rutas: `AUDITOR`, `COMPLIANCE`, `FRAUD_ANALYST`, `QA_ANALYST`, `RISK_ANALYST`, `RISK_APPROVER`. La decisión es del servidor (`RolesGuard`), nunca del frontend.

## Códigos de error propios

- `APPROVAL_REQUEST_EXISTS`
- `APPROVAL_REQUEST_NOT_FOUND`
- `APPROVAL_ROLE_REQUIRED`
- `APPROVAL_STEP_CLOSED`
- `APPROVAL_STEP_NOT_FOUND`
- `APPROVAL_STEP_OUT_OF_ORDER`
- `BLOCKING_TESTS_NOT_PASSED`
- `DUPLICATE_APPROVAL_DECISION`
- `SEPARATION_OF_DUTIES_VIOLATION`
- `VERSION_NOT_APPROVED`
- `VERSION_NOT_FOUND`
- `VERSION_NOT_REVIEWABLE`

## Clases exportadas

- `ApprovalEvidenceDto`
- `ApprovalRequestListItemDto`
- `ApprovalRequestListQueryDto`
- `CreateCustomApprovalStepDto`
- `GovernanceController`
- `GovernanceModule`
- `GovernanceService`
- `RecordApprovalDecisionDto`
- `SubmitReviewDto`
