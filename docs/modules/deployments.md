<!-- GENERADO POR scripts/docs/generate-catalogs.mjs — NO EDITAR A MANO.
     Fuente: src/modules/deployments/. Ejecute `yarn docs:catalog` tras cambiar el código. -->

# Módulo `deployments`


## Responsabilidad

Código: [`src/modules/deployments/`](https://github.com/) · 6 ficheros TypeScript.

Etiquetas de API: **Decision Deployments**.

## Endpoints

| Método | Ruta | Operación | Resumen |
| --- | --- | --- | --- |
| `POST` | `/v1/artifact-versions/{versionId}/deployments` | `deploymentDeploy` | Publish an approved compiled artifact version |
| `GET` | `/v1/deployments` | `deploymentList` | List deployment history with filters |
| `POST` | `/v1/deployments/{deploymentId}/rollback` | `deploymentRollback` | Rollback an active deployment to its predecessor |
| `POST` | `/v1/deployments/{deploymentId}/suspend` | `deploymentSuspend` | Suspend a deployment and invalidate its runtime binding |
| `GET` | `/v1/environments` | `deploymentEnvironments` | List active decision environments |

## Autorización

Roles exigidos por sus rutas: `AUDITOR`, `COMPLIANCE`, `OPERATIONS`, `PLATFORM_ADMIN`, `QA_ANALYST`, `RISK_ANALYST`. La decisión es del servidor (`RolesGuard`), nunca del frontend.

## Códigos de error propios

- `ACTIVE_DEPLOYMENT_NOT_FOUND`
- `COMPILED_ARTIFACT_NOT_FOUND`
- `DEPLOYMENT_ALREADY_SUSPENDED`
- `DEPLOYMENT_NOT_ACTIVE`
- `DEPLOYMENT_NOT_FOUND`
- `ENVIRONMENT_NOT_FOUND`
- `INVALID_TRAFFIC_PERCENTAGE`
- `ROLLBACK_TARGET_NOT_FOUND`
- `SEPARATION_OF_DUTIES_VIOLATION`
- `VERSION_NOT_FOUND`

## Clases exportadas

- `DeployVersionDto`
- `DeploymentController`
- `DeploymentEnvironmentDto`
- `DeploymentListItemDto`
- `DeploymentListQueryDto`
- `DeploymentModule`
- `DeploymentResolverService`
- `DeploymentRolledBackDto`
- `DeploymentService`
- `DeploymentSuspendedDto`
- `RollbackDeploymentDto`
- `SuspendDeploymentDto`
- `TrafficRuleDto`
