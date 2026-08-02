<!-- GENERADO POR scripts/docs/generate-catalogs.mjs — NO EDITAR A MANO.
     Fuente: src/modules/live-execution/. Ejecute `yarn docs:catalog` tras cambiar el código. -->

# Módulo `live-execution`


## Responsabilidad

Código: [`src/modules/live-execution/`](https://github.com/) · 3 ficheros TypeScript.

Etiquetas de API: **Live Execution**.

## Endpoints

| Método | Ruta | Operación | Resumen |
| --- | --- | --- | --- |
| `GET` | `/v1/live-executions/stream` | `liveExecutionStream` | Stream an opt-in non-production decision preview node by node |

## Autorización

Roles exigidos por sus rutas: `FRAUD_ANALYST`, `QA_ANALYST`, `RISK_ANALYST`. La decisión es del servidor (`RolesGuard`), nunca del frontend.

## Códigos de error propios

- `LIVE_EXECUTION_DISABLED`
- `LIVE_EXECUTION_PROD_FORBIDDEN`
- `LIVE_EXECUTION_VARIABLES_INVALID`

## Clases exportadas

- `LiveExecutionController`
- `LiveExecutionModule`
- `LiveExecutionStreamQueryDto`
