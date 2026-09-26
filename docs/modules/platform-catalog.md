<!-- GENERADO POR scripts/docs/generate-catalogs.mjs — NO EDITAR A MANO.
     Fuente: src/modules/platform-catalog/. Ejecute `yarn docs:catalog` tras cambiar el código. -->

# Módulo `platform-catalog`


## Responsabilidad

Código: [`src/modules/platform-catalog/`](https://github.com/) · 8 ficheros TypeScript.

Etiquetas de API: **Platform Catalog**.

## Endpoints

| Método | Ruta | Operación | Resumen |
| --- | --- | --- | --- |
| `GET` | `/v1/platform/catalog-manifest` | `platformCatalogManifest` | Describe this block: the routes it serves and the tables it owns |

## Autorización

Roles exigidos por sus rutas: `AUDITOR`, `COMPLIANCE`, `OPERATIONS`, `PLATFORM_ADMIN`. La decisión es del servidor (`RolesGuard`), nunca del frontend.

## Códigos de error propios

No lanza `DomainException` propias.

## Clases exportadas

- `CatalogManifestBlockDto`
- `CatalogManifestDataEntityDto`
- `CatalogManifestDto`
- `CatalogManifestEndpointDto`
- `OpenApiDocumentRegistry`
- `PlatformCatalogController`
- `PlatformCatalogModule`
- `PlatformCatalogService`
- `RouteInventoryService`
- `SchemaInventoryService`
