<!-- GENERADO POR scripts/docs/generate-catalogs.mjs — NO EDITAR A MANO.
     Fuente: src/modules/health/. Ejecute `yarn docs:catalog` tras cambiar el código. -->

# Módulo `health`


## Responsabilidad

Código: [`src/modules/health/`](https://github.com/) · 4 ficheros TypeScript.

Etiquetas de API: **Health**.

## Endpoints

| Método | Ruta | Operación | Resumen |
| --- | --- | --- | --- |
| `GET` | `/health` | `healthLiveAlias` | Alias of /health/live kept for existing probes |
| `GET` | `/health/data-sources` | `healthDataSources` | Report registered data connections and their effective routing |
| `GET` | `/health/live` | `healthLive` | Report process liveness without checking dependencies |
| `GET` | `/health/ready` | `healthReady` | Report database and cache readiness with redacted failures |
| `GET` | `/ready` | `healthReadyAlias` | Alias of /health/ready kept for existing probes |

## Autorización

Este módulo no declara roles: o no expone rutas, o son públicas por diseño.

## Códigos de error propios

- `SERVICE_NOT_READY`

## Clases exportadas

- `DataSourcesResponseDto`
- `HealthController`
- `HealthModule`
- `HealthProbeService`
- `LivenessResponseDto`
- `ReadinessResponseDto`
