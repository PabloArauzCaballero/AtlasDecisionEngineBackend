# Ambientes

## Dos conceptos distintos con el mismo nombre

!!! important "No confunda ambiente de despliegue con ambiente de decisión"
    | | Ambiente de despliegue | Ambiente de decisión |
    | --- | --- | --- |
    | Qué es | Dónde corre el software | Contra qué versión se decide |
    | Ejemplos | local, staging, producción | `DEV`, `STAGING`, `TEST`, `PROD` |
    | Se configura en | Variables de entorno | Fila de `decision_environment` |

    Una instalación productiva sirve decisiones de **varios** ambientes de decisión: un analista
    prueba contra `TEST` en el mismo despliegue que atiende `PROD`.

    Los dos juegos comparten la palabra «staging» y NO son lo mismo: el despliegue de staging es
    una instalación entera del motor; `STAGING` es una fila del catálogo que cualquier instalación
    —incluida la productiva— puede servir.

## Ambientes de decisión

| Código | Para qué | Restricciones propias |
| --- | --- | --- |
| `DEV` | Diseño y exploración | Permite simulación y stream en vivo |
| `TEST` | Regresión y QA | El QA Lab puede ejecutar aquí |
| `STAGING` | Ensayo previo a producción | Mismas restricciones que `PROD` salvo que no decide sobre clientes |
| `PROD` | Decisiones reales | **Excluido del QA Lab**; una referencia a otro artefacto exige versión exacta |

`DEFAULT_ENVIRONMENT` (`PROD`) es el que se asume cuando no se indica otro.

`DEV` se llamaba `SANDBOX` hasta la migración `20260808120000_four_decision_environments`, que lo
renombra —no lo duplica— para no partir en dos el histórico de despliegues y ejecuciones. Una base
que todavía no la haya aplicado sigue funcionando: el motor acepta `SANDBOX` como sinónimo de `DEV`.

Que PROD esté excluido del QA Lab no es una precaución genérica: una corrida mete miles de
ejecuciones sintéticas que contaminarían métricas y datos reales.

## Ambientes de despliegue

| | Local | Staging | Producción |
| --- | --- | --- | --- |
| `NODE_ENV` | `development` | `production` | `production` |
| `AUTH_MODE` | cualquiera | JWT / híbrido / IdP | **no** `API_KEY` |
| `SWAGGER_ENABLED` | `true` | según política | **`false`** (rechazado por el esquema) |
| `LOG_LEVEL` | `debug` | `log` | `log` (`debug` rechazado) |
| Redis | opcional | obligatorio | **obligatorio** |
| `SCRIPT_RUNNER_MODE` | `IN_PROCESS` | `SIDECAR` | **`SIDECAR`** obligatorio |
| Siembra MOCKUP | sí | no | no |
| `WORKER_ROLE` | `ALL` | `API` + `WORKER` | `API` + `WORKER` |

## Lo que el esquema rechaza en producción

No son recomendaciones: el arranque falla.

- `AUTH_MODE=API_KEY`
- `SWAGGER_ENABLED=true`
- `LOG_LEVEL` en `debug` o `verbose`
- Redis ausente con `REQUIRE_REDIS_IN_PRODUCTION`
- Métricas activas sin `METRICS_TOKEN`
- URLs de JWKS, proveedor de identidad o backend de variables que no sean HTTPS
- `SCRIPT_NODES_ENABLED=true` sin `SCRIPT_RUNNER_MODE=SIDECAR`
- Cualquier secreto con un valor de ejemplo

## Promoción entre ambientes

Se promueve una **versión aprobada**, no un contenido copiado: el artefacto compilado es el
mismo binario lógico en `TEST` y en `PROD`. Ver [despliegue](deployment.md).

El camino previsto es `DEV → TEST → STAGING → PROD`. `TEST → PROD` sigue permitido: `STAGING` es
un escalón que se ofrece, no un peaje nuevo, y convertirlo en obligatorio habría invalidado de
golpe promociones ya auditadas.
