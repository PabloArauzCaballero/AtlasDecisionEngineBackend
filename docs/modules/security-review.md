<!-- GENERADO POR scripts/docs/generate-catalogs.mjs — NO EDITAR A MANO.
     Fuente: src/modules/security-review/. Ejecute `yarn docs:catalog` tras cambiar el código. -->

# Módulo `security-review`


## Responsabilidad

Código: [`src/modules/security-review/`](https://github.com/) · 4 ficheros TypeScript.

Etiquetas de API: **Security Review**.

## Endpoints

| Método | Ruta | Operación | Resumen |
| --- | --- | --- | --- |
| `GET` | `/v1/security-review/versions/{versionId}` | `securityReviewGet` | Aggregate security and governance evidence for a version |
| `GET` | `/v1/security-review/versions/{versionId}/export` | `securityReviewExport` | Export a reproducible security-review snapshot |

## Autorización

Este módulo no declara roles: o no expone rutas, o son públicas por diseño.

## Códigos de error propios

- `VERSION_NOT_FOUND`

## Clases exportadas

- `SecurityReviewController`
- `SecurityReviewDto`
- `SecurityReviewModule`
- `SecurityReviewService`
