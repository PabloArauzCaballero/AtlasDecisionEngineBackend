<!-- GENERADO POR scripts/docs/generate-catalogs.mjs — NO EDITAR A MANO.
     Fuente: src/modules/manual-review/. Ejecute `yarn docs:catalog` tras cambiar el código. -->

# Módulo `manual-review`


## Responsabilidad

Código: [`src/modules/manual-review/`](https://github.com/) · 8 ficheros TypeScript.

Etiquetas de API: **Manual Review**.

## Endpoints

| Método | Ruta | Operación | Resumen |
| --- | --- | --- | --- |
| `GET` | `/v1/manual-reviews` | `manualReviewList` | List manual-review cases visible to the tenant |
| `GET` | `/v1/manual-reviews/{caseId}` | `manualReviewGet` | Get one manual-review case and decision context |
| `POST` | `/v1/manual-reviews/{caseId}/assign` | `manualReviewAssign` | Take an open case, or assign it to another analyst |
| `POST` | `/v1/manual-reviews/{caseId}/resolve` | `manualReviewResolve` | Resolve a case as its assigned analyst |
| `PUT` | `/v1/manual-reviews/by-execution/{executionId}/onboarding-dossier` | `onboardingDossierAttach` | Attach the onboarding dossier to the review case of an execution |

## Autorización

Roles exigidos por sus rutas: `FRAUD_ANALYST`, `OPERATIONS`, `RISK_ANALYST`. La decisión es del servidor (`RolesGuard`), nunca del frontend.

## Códigos de error propios

- `EXECUTION_NOT_FOUND`
- `MANUAL_REVIEW_ASSIGNEE_MISMATCH`
- `MANUAL_REVIEW_ASSIGN_FORBIDDEN`
- `MANUAL_REVIEW_CLOSED`
- `MANUAL_REVIEW_NOT_ASSIGNED`
- `MANUAL_REVIEW_NOT_FOUND`
- `ONBOARDING_DOSSIER_TOO_LARGE`

## Clases exportadas

- `AssignManualReviewDto`
- `AttachOnboardingDossierDto`
- `ManualReviewController`
- `ManualReviewDetailDto`
- `ManualReviewListItemDto`
- `ManualReviewListQueryDto`
- `ManualReviewModule`
- `ManualReviewService`
- `ManualReviewWriteResultDto`
- `OnboardingDossierController`
- `OnboardingDossierResultDto`
- `OnboardingDossierService`
- `OpenIfMissingDto`
- `ResolveManualReviewDto`
