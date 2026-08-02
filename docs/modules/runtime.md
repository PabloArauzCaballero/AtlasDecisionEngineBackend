<!-- GENERADO POR scripts/docs/generate-catalogs.mjs — NO EDITAR A MANO.
     Fuente: src/modules/runtime/. Ejecute `yarn docs:catalog` tras cambiar el código. -->

# Módulo `runtime`


## Responsabilidad

Código: [`src/modules/runtime/`](https://github.com/) · 11 ficheros TypeScript.

Etiquetas de API: **Decision Runtime**, **Decision Simulation**.

## Endpoints

| Método | Ruta | Operación | Resumen |
| --- | --- | --- | --- |
| `POST` | `/v1/decisions/{artifactCode}` | `runtimeExecute` | Execute an idempotent decision against the active deployment |
| `POST` | `/v1/simulations/{artifactCode}` | `simulationSimulate` | Simulate a SANDBOX or TEST decision without persistence |
| `POST` | `/v1/simulations/{artifactCode}/sample-inputs` | `simulationGenerateSampleInputs` | Generar valores de prueba a partir del contrato de entrada |

## Autorización

Roles exigidos por sus rutas: `FRAUD_ANALYST`, `QA_ANALYST`, `RISK_ANALYST`. La decisión es del servidor (`RolesGuard`), nunca del frontend.

## Códigos de error propios

- `ARTIFACT_HAS_NO_INPUTS`
- `EXECUTION_PERSISTENCE_CONFLICT`
- `IDEMPOTENCY_CONTENDED`
- `IDEMPOTENCY_IN_PROGRESS`
- `IDEMPOTENCY_PAYLOAD_MISMATCH`
- `SIMULATION_PROD_FORBIDDEN`

## Clases exportadas

- `ExecuteDecisionDto`
- `ExecutionWriterService`
- `GenerateSampleInputsDto`
- `IdempotencyService`
- `RetentionSweeperService`
- `RuntimeController`
- `RuntimeModule`
- `RuntimeService`
- `SampleInputService`
- `SimulateDecisionDto`
- `SimulationController`
- `SimulationService`
