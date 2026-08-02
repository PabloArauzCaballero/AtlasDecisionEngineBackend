<!-- GENERADO POR scripts/docs/generate-catalogs.mjs — NO EDITAR A MANO.
     Fuente: src/modules/audit-query/. Ejecute `yarn docs:catalog` tras cambiar el código. -->

# Módulo `audit-query`


## Responsabilidad

Código: [`src/modules/audit-query/`](https://github.com/) · 5 ficheros TypeScript.

Etiquetas de API: **Audit and Observability**.

## Endpoints

| Método | Ruta | Operación | Resumen |
| --- | --- | --- | --- |
| `GET` | `/v1/audit/chain/verify` | `auditQueryVerify` | Verify the tenant audit HMAC chain in batches |
| `GET` | `/v1/audit/events` | `auditQueryEvents` | List audit events using offset pagination |
| `GET` | `/v1/audit/events/cursor` | `auditQueryEventsByCursor` | List audit events using a stable keyset cursor |
| `GET` | `/v1/audit/executions` | `auditQuerySearch` | Search decision executions with bounded pagination |
| `GET` | `/v1/audit/executions/{executionId}` | `auditQueryGetExecution` | Get one decision execution with its evidence |
| `GET` | `/v1/audit/metrics` | `auditQueryMetrics` | Aggregate decision outcomes and latency evidence |

## Autorización

Roles exigidos por sus rutas: `AUDITOR`, `COMPLIANCE`, `OPERATIONS`, `RISK_ANALYST`. La decisión es del servidor (`RolesGuard`), nunca del frontend.

## Códigos de error propios

- `EXECUTION_NOT_FOUND`

## Clases exportadas

- `AuditChainVerificationDto`
- `AuditEventKeysetQueryDto`
- `AuditEventSearchQueryDto`
- `AuditQueryController`
- `AuditQueryModule`
- `AuditQueryService`
- `ExecutionMetricsDto`
- `ExecutionSearchQueryDto`
- `InvalidAuditEventDto`
