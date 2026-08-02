<!-- GENERADO POR scripts/docs/generate-catalogs.mjs — NO EDITAR A MANO.
     Fuente: src/modules/manual-review/. Ejecute `yarn docs:catalog` tras cambiar el código. -->

# Módulo `manual-review`


## Responsabilidad

Código: [`src/modules/manual-review/`](https://github.com/) · 5 ficheros TypeScript.

Etiquetas de API: **Manual Review**.

## Endpoints

| Método | Ruta | Operación | Resumen |
| --- | --- | --- | --- |
| `GET` | `/v1/manual-reviews` | `manualReviewList` | List manual-review cases visible to the tenant |
| `GET` | `/v1/manual-reviews/{caseId}` | `manualReviewGet` | Get one manual-review case and decision context |
| `POST` | `/v1/manual-reviews/{caseId}/assign` | `manualReviewAssign` | Assign an open case to an analyst |
| `POST` | `/v1/manual-reviews/{caseId}/resolve` | `manualReviewResolve` | Resolve a case as its assigned analyst |

## Autorización

Roles exigidos por sus rutas: `FRAUD_ANALYST`, `OPERATIONS`, `RISK_ANALYST`. La decisión es del servidor (`RolesGuard`), nunca del frontend.

## Códigos de error propios

- `MANUAL_REVIEW_ASSIGNEE_MISMATCH`
- `MANUAL_REVIEW_CLOSED`
- `MANUAL_REVIEW_NOT_ASSIGNED`
- `MANUAL_REVIEW_NOT_FOUND`

## Clases exportadas

- `AssignManualReviewDto`
- `ManualReviewController`
- `ManualReviewDetailDto`
- `ManualReviewListItemDto`
- `ManualReviewListQueryDto`
- `ManualReviewModule`
- `ManualReviewService`
- `ManualReviewWriteResultDto`
- `ResolveManualReviewDto`
