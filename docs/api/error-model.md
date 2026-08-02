# Modelo de error

## Un solo sobre para toda la API

Ningún controlador formatea errores: `DomainExceptionFilter` traduce **toda** excepción —de
dominio, HTTP o no controlada— a la misma forma.

```json
{
  "type": "https://atlas.local/errors/variable_missing_or_invalid",
  "title": "VARIABLE_MISSING_OR_INVALID",
  "status": 422,
  "requestId": "01J8ZQ2M5K9V3S7T1XW4YB6CDE",
  "error": {
    "code": "VARIABLE_MISSING_OR_INVALID",
    "message": "Required variable ingreso_mensual is missing",
    "details": { "variable": "ingreso_mensual" }
  }
}
```

| Campo | Para qué |
| --- | --- |
| `type` | Identificador estable del tipo de error, apto para enlazar documentación |
| `title` | Código en mayúsculas. **Es lo que un cliente debe comparar**, no el mensaje |
| `status` | El mismo que el código HTTP |
| `requestId` | Correlación con los registros del servidor; igual a la cabecera `x-request-id` |
| `error.code` | Duplicado de `title`, para clientes que solo leen el objeto anidado |
| `error.message` | Texto legible. Puede cambiar sin previo aviso |
| `error.details` | Contexto: su forma **depende del código** |

!!! warning "No programe contra `message`"
    El mensaje es para personas y puede reescribirse en cualquier release. La única parte
    estable es el **código**. `details` tampoco tiene una forma única: para un error de
    validación es una lista de campos; para uno de tenant, los tenants permitidos.

## Diferencia con RFC 7807 canónico

Se parece, pero **no** es idéntico: el detalle viaja en `error`, no en `detail`. Un consumidor
que espere `detail` no encontrará nada. Está descrito tal cual en el contrato OpenAPI, en
`components.schemas.ProblemDetails`.

## Errores garantizados en toda operación autenticada

Los produce el filtro global, no el controlador, así que el contrato los declara de forma
centralizada:

| Código | Cuándo |
| --- | --- |
| `401` | Credencial ausente, inválida o revocada |
| `403` | Rol insuficiente o tenant no permitido |
| `429` | Límite de tasa superado (ver `retry-after`) |
| `500` | Error no controlado |
| `400` | Solo donde hay algo que validar: cuerpo o parámetros |

## En producción, un `500` no cuenta nada

El mensaje interno de un error no controlado **solo** se devuelve fuera de producción. En
producción el cuerpo dice «An unexpected server error occurred» y el detalle real queda en el
registro del servidor, correlacionado por `requestId`. Un mensaje de driver filtrado revela
host, puerto, versión y a veces fragmentos de consulta.

## Observabilidad

Todo error incrementa `atlas_errors_total{code}`. Los `4xx` se registran a nivel `warn`
—son tráfico esperado: denegaciones, validaciones, reglas de negocio— y los `5xx` a `error`.
Mezclarlos entrenaría al operador para ignorar el logger.

El catálogo completo de códigos, generado del código, está en
[catálogo de errores](error-catalog.md).
