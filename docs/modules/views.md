<!-- GENERADO POR scripts/docs/generate-catalogs.mjs — NO EDITAR A MANO.
     Fuente: src/modules/views/. Ejecute `yarn docs:catalog` tras cambiar el código. -->

# Módulo `views`


## Responsabilidad

Código: [`src/modules/views/`](https://github.com/) · 5 ficheros TypeScript.

Etiquetas de API: **Read Model Views**.

## Endpoints

| Método | Ruta | Operación | Resumen |
| --- | --- | --- | --- |
| `GET` | `/v1/views/artifact-inputs` | `viewsArtifactInputs` | Get the latest artifact input and validation contract |
| `GET` | `/v1/views/options` | `viewsOptions` | List authoritative catalog options for forms |
| `GET` | `/v1/views/pickers/artifact-versions` | `viewsArtifactVersions` | List artifact versions for portal pickers |
| `GET` | `/v1/views/pickers/artifacts` | `viewsArtifacts` | List active artifacts for portal pickers |
| `GET` | `/v1/views/pickers/test-runs` | `viewsTestRuns` | List recent test runs for portal pickers |
| `GET` | `/v1/views/pickers/test-suites` | `viewsTestSuites` | List test suites for portal pickers |
| `GET` | `/v1/views/pickers/variables` | `viewsVariables` | List current variables for portal pickers |
| `GET` | `/v1/views/scripts` | `viewsScripts` | List script nodes without exposing source in picker views |
| `GET` | `/v1/views/search` | `viewsSearch` | Search governed entities across portal read models |

## Autorización

Este módulo no declara roles: o no expone rutas, o son públicas por diseño.

## Códigos de error propios

No lanza `DomainException` propias.

## Clases exportadas

- `ArtifactInputContractDto`
- `ArtifactInputContractQueryDto`
- `ArtifactPickerQueryDto`
- `ArtifactPickerRowDto`
- `ArtifactVersionPickerQueryDto`
- `ArtifactVersionPickerRowDto`
- `FormOptionQueryDto`
- `FormOptionRowDto`
- `GlobalSearchQueryDto`
- `GlobalSearchResultDto`
- `NodeScriptListQueryDto`
- `NodeScriptRowDto`
- `TestRunPickerQueryDto`
- `TestRunPickerRowDto`
- `TestSuitePickerQueryDto`
- `TestSuitePickerRowDto`
- `VariablePickerQueryDto`
- `VariablePickerRowDto`
- `ViewsController`
- `ViewsModule`
- `ViewsService`
