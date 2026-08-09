<!-- GENERADO POR scripts/docs/generate-catalogs.mjs — NO EDITAR A MANO.
     Fuente: src/modules/data-subject/. Ejecute `yarn docs:catalog` tras cambiar el código. -->

# Módulo `data-subject`


## Responsabilidad

Código: [`src/modules/data-subject/`](https://github.com/) · 5 ficheros TypeScript.

Etiquetas de API: **Data Subject Rights**.

## Endpoints

| Método | Ruta | Operación | Resumen |
| --- | --- | --- | --- |
| `POST` | `/v1/data-subject-requests` | `dataSubjectSubmit` | Register a data subject request and resolve it against the decision history |
| `POST` | `/v1/data-subject-requests/history` | `dataSubjectHistory` | List the requests already handled for a data subject |

## Autorización

Roles exigidos por sus rutas: `AUDITOR`, `COMPLIANCE`, `OPERATIONS`. La decisión es del servidor (`RolesGuard`), nunca del frontend.

## Códigos de error propios

No lanza `DomainException` propias.

## Clases exportadas

- `CreateDataSubjectRequestDto`
- `DataSubjectController`
- `DataSubjectDecisionDto`
- `DataSubjectModule`
- `DataSubjectRequestHistoryDto`
- `DataSubjectRequestResultDto`
- `DataSubjectService`
