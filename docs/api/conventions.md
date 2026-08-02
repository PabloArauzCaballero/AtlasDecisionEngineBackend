# Convenciones de la API

## Forma general

| Aspecto | Convención |
| --- | --- |
| Prefijo | `/v1/...` para negocio; `/health/*` y `/metrics` fuera del prefijo |
| Formato | JSON en petición y respuesta; `content-type: application/json` |
| Identificadores | Enteros grandes serializados como **cadena** (`BigInt.toJSON`), para no perder precisión en JavaScript |
| Fechas | ISO 8601 en UTC |
| Nombres | `camelCase` en el cuerpo; cabeceras en minúsculas con guiones |
| Cuerpo desconocido | Un campo no declarado es un **error** (`400`), no se ignora |

!!! note "Por qué un campo desconocido falla"
    Ignorarlo hace que un integrador crea que envió algo que nunca llegó, y el error aparece
    semanas después como un comportamiento inexplicable. Rechazarlo lo convierte en un fallo
    inmediato y localizable.

## Cabeceras

| Cabecera | Dirección | Para qué |
| --- | --- | --- |
| `x-api-key` | entrada | Credencial de integración técnica |
| `authorization: Bearer` | entrada | Token firmado |
| `x-tenant-id` | entrada | Tenant sobre el que se opera; se contrasta con los permitidos del cliente |
| `x-request-id` | entrada/salida | Correlación. Si no se envía, se genera; siempre vuelve en la respuesta |
| `if-match` | entrada | Control de concurrencia optimista donde aplica |
| `x-ratelimit-limit`, `-remaining`, `-reset` | salida | Estado de la ventana de tasa |
| `retry-after` | salida | Cuándo reintentar tras un `429` |
| `etag` | salida | Versión del recurso donde aplica |
| `cache-control: no-store` | salida | Siempre: ninguna respuesta de decisión debe quedar en una caché intermedia |

!!! danger "Cabeceras que NO existen"
    `x-principal-id` y `x-roles` no se aceptan ni figuran en la lista de CORS. La identidad y
    los roles se resuelven del registro de clientes o del token firmado. Aceptarlos convertiría
    cualquier integración en administrador con una cabecera.

## Códigos de estado

| Código | Cuándo |
| --- | --- |
| `200` | Operación satisfactoria |
| `201` | Recurso creado |
| `204` | Operación satisfactoria sin cuerpo |
| `400` | La petición no supera la validación del contrato |
| `401` | Credencial ausente, inválida o revocada |
| `403` | Autenticado pero sin el rol exigido, o tenant no permitido |
| `404` | El recurso no existe **en este tenant** |
| `409` | Conflicto de estado (versión no editable, cota de cadena superada…) |
| `422` | La entrada es sintácticamente válida pero incumple una regla de negocio |
| `429` | Límite de tasa superado |
| `503` | Dependencia no disponible o runner de scripts saturado (reintentable) |

## Multi-tenant

Toda operación de negocio ocurre dentro de un tenant. El identificador viaja en `x-tenant-id`
y se contrasta con los tenants permitidos del cliente; además, la conexión fija el GUC que
activa las políticas RLS. Un recurso de otro tenant responde `404`, no `403`: revelar que
existe ya sería una fuga.

Ver [autenticación](authentication.md), [autorización](authorization.md) y
[modelo de error](error-model.md).
