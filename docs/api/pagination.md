# Paginación

Dos esquemas, con criterios distintos de uso.

## Por desplazamiento (por defecto)

```http
GET /v1/artifacts?page=1&pageSize=50
```

```json
{
  "items": [],
  "page": 1,
  "pageSize": 50,
  "total": 1280,
  "totalPages": 26,
  "hasNextPage": true
}
```

`pageSize` está acotado por `MAX_PAGE_SIZE` (100 por defecto). Da acceso aleatorio a cualquier
página y un total exacto, a cambio de que el motor cuente y descarte filas: el coste crece con
el número de página.

## Por cursor (keyset)

Para feeds que crecen sin cota, como la auditoría:

```http
GET /v1/audit/events/cursor?pageSize=50
GET /v1/audit/events/cursor?pageSize=50&cursor=<opaco>
```

```json
{ "items": [], "nextCursor": "MTIzNDU2" }
```

- El cursor es **opaco** (base64url). Un valor malformado o negativo responde `400`.
- Recorre por `id` descendente con `where id < cursor`: coste constante por página.
- **No** hay acceso aleatorio ni total: es el intercambio deliberado.

!!! note "Por qué un endpoint aparte y no un parámetro más"
    `GET /v1/audit/events/cursor` es un **hermano aditivo** de `GET /v1/audit/events`, no una
    variante del mismo. Un solo endpoint que devolviera dos formas según el parámetro obligaría
    a todo cliente a manejar ambas, y rompería el contrato por desplazamiento que ya existía.

## Cuál usar

| Situación | Esquema |
| --- | --- |
| Catálogos acotados (artefactos, variables, códigos de razón) | Desplazamiento |
| Interfaz que muestra «página 7 de 26» | Desplazamiento |
| Exportación o recorrido completo de un feed | Cursor |
| Auditoría y ejecuciones | Cursor |

## Rendimiento

Recorrer una tabla de auditoría con `findMany` completo agota la memoria y es un DoS barato.
Por eso la verificación de la cadena también recorre por lotes (`AUDIT_VERIFY_BATCH_SIZE`) en
vez de cargar el historial regulatorio completo.

La consulta por cursor está respaldada por el índice `(tenant_id, id)` de
`decision_audit_event`. Antes de crearlo, `EXPLAIN` mostraba un recorrido inverso de la clave
primaria descartando filas de otros tenants.
