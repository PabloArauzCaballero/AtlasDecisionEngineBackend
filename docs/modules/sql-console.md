<!-- GENERADO POR scripts/docs/generate-catalogs.mjs — NO EDITAR A MANO.
     Fuente: src/modules/sql-console/. Ejecute `yarn docs:catalog` tras cambiar el código. -->

# Módulo `sql-console`


## Responsabilidad

Código: [`src/modules/sql-console/`](https://github.com/) · 13 ficheros TypeScript.

Etiquetas de API: **SQL Console**.

## Endpoints

| Método | Ruta | Operación | Resumen |
| --- | --- | --- | --- |
| `GET` | `/v1/sql-console/catalog` | `sqlConsoleCatalog` | List the governed datasets, tables and columns the console can query |
| `GET` | `/v1/sql-console/history` | `sqlConsoleHistory` | List the caller´s own recent queries |
| `POST` | `/v1/sql-console/query` | `sqlConsoleQuery` | Execute a read-only query against the governed datasets |
| `POST` | `/v1/sql-console/validate` | `sqlConsoleValidate` | Validate and estimate a query without executing it |

## Autorización

Roles exigidos por sus rutas: `AUDITOR`, `COMPLIANCE`, `FRAUD_ANALYST`, `RISK_ANALYST`, `RISK_APPROVER`. La decisión es del servidor (`RolesGuard`), nunca del frontend.

## Códigos de error propios

No lanza `DomainException` propias.

## Clases exportadas

- `CatalogDiscoveryService`
- `QueryEstimateDto`
- `QueryExecutorService`
- `QueryHistoryDto`
- `QueryHistoryEntryDto`
- `QueryHistoryPageDto`
- `QueryResultDto`
- `QueryValidationDto`
- `QueryViolationDto`
- `RunQueryDto`
- `SqlCatalogDto`
- `SqlConsoleController`
- `SqlConsoleModule`
- `SqlConsoleQueryError`
- `SqlConsoleService`
