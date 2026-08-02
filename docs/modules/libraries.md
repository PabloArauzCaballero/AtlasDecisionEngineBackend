<!-- GENERADO POR scripts/docs/generate-catalogs.mjs — NO EDITAR A MANO.
     Fuente: src/modules/libraries/. Ejecute `yarn docs:catalog` tras cambiar el código. -->

# Módulo `libraries`


## Responsabilidad

Código: [`src/modules/libraries/`](https://github.com/) · 6 ficheros TypeScript.

Etiquetas de API: **Approved Libraries**.

## Endpoints

| Método | Ruta | Operación | Resumen |
| --- | --- | --- | --- |
| `GET` | `/v1/libraries` | `libraryList` | Catálogo de librerías autorizadas, filtrable por lenguaje y ambiente |
| `POST` | `/v1/libraries` | `libraryUpsert` | Aprobar o actualizar una librería del registro |
| `GET` | `/v1/libraries/preludes` | `libraryPreludes` | Implementaciones disponibles que una librería puede habilitar |

## Autorización

Roles exigidos por sus rutas: `AUDITOR`, `COMPLIANCE`, `FRAUD_ANALYST`, `PLATFORM_ADMIN`, `QA_ANALYST`, `RISK_ANALYST`. La decisión es del servidor (`RolesGuard`), nunca del frontend.

## Códigos de error propios

- `LIBRARY_ENVIRONMENT_FORBIDDEN`
- `LIBRARY_FUNCTION_NOT_EXPOSED`
- `LIBRARY_LANGUAGE_MISMATCH`
- `LIBRARY_NOT_APPROVED`
- `LIBRARY_NOT_FOUND`
- `LIBRARY_PRELUDE_NOT_IMPLEMENTED`

## Clases exportadas

- `ApprovedLibraryDto`
- `LibraryController`
- `LibraryModule`
- `LibraryQueryDto`
- `LibraryService`
- `PreludeDto`
- `UpsertLibraryDto`
