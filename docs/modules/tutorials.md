<!-- GENERADO POR scripts/docs/generate-catalogs.mjs — NO EDITAR A MANO.
     Fuente: src/modules/tutorials/. Ejecute `yarn docs:catalog` tras cambiar el código. -->

# Módulo `tutorials`


## Responsabilidad

Código: [`src/modules/tutorials/`](https://github.com/) · 5 ficheros TypeScript.

Etiquetas de API: **Tutorials**.

## Endpoints

| Método | Ruta | Operación | Resumen |
| --- | --- | --- | --- |
| `GET` | `/v1/tutorial-progress` | `tutorialList` | List tutorial progress for the authenticated user |
| `PUT` | `/v1/tutorial-progress/{tutorialId}` | `tutorialUpsert` | Create or update one tutorial progress record |

## Autorización

Este módulo no declara roles: o no expone rutas, o son públicas por diseño.

## Códigos de error propios

No lanza `DomainException` propias.

## Clases exportadas

- `TutorialController`
- `TutorialModule`
- `TutorialProgressDto`
- `TutorialService`
- `UpsertTutorialProgressDto`
