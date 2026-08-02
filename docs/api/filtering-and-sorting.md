# Filtrado y ordenamiento

## Principio

Solo se admiten los filtros que cada endpoint **declara** en su DTO. No hay un lenguaje de
consulta genérico ni un parámetro que acepte SQL, expresiones o rutas arbitrarias.

!!! danger "Por qué no hay filtrado genérico"
    Un filtro arbitrario sobre un modelo multi-tenant es una superficie de fuga: basta un
    campo relacionado mal acotado para leer datos de otro tenant. Además convierte cualquier
    consulta en imprevisible para el planificador y en un DoS barato. Los filtros declarados se
    validan, se indexan y se prueban.

## Filtros disponibles

Se generan del contrato; consúltelos por endpoint en el
[catálogo de endpoints](endpoint-catalog.md) o en la referencia interactiva. Patrones comunes:

| Parámetro | Semántica |
| --- | --- |
| `search` | Coincidencia parcial sobre el código o el nombre del recurso |
| `status` | Igualdad sobre un estado del catálogo |
| `usage` | `INPUT` / `OUTPUT` en el catálogo de variables |
| `artifactVersionId` | Restringe a una versión concreta |
| `page`, `pageSize` | Paginación por desplazamiento |
| `cursor` | Paginación por cursor donde existe |

Un parámetro no declarado produce `400`, igual que un campo desconocido en el cuerpo.

## Ordenamiento

El orden lo fija cada endpoint y es **estable**, no configurable por el llamante. Los listados
de catálogo ordenan por código; los feeds temporales, por identificador descendente, que es el
mismo criterio que usa la paginación por cursor.

Permitir ordenar por un campo cualquiera obligaría a indexar todas las combinaciones o aceptar
recorridos completos de tabla en producción.

## Búsqueda sobre bases de larga vida

Al integrar o al escribir una prueba, **no asuma que su recurso está en la primera página**:
una base de desarrollo acumula artefactos de corridas anteriores. Filtre por código:

```http
GET /v1/artifacts?search=BNPL_CREDIT_DECISION&pageSize=100
```

Es exactamente el cambio que hizo estable la prueba de humo del repositorio.
