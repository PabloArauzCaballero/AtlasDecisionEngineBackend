# Versionado

## Dos versiones que no significan lo mismo

| Versión | Variable | Cambia cuando | La ve el consumidor |
| --- | --- | --- | --- |
| **Contrato de API** | `API_VERSION` | El contrato rompe compatibilidad | Sí: fija su cliente a ella |
| **Build** | `BUILD_VERSION` | Cada release | Como metadato, en `/health/live` y en la descripción del contrato |

Separarlas es deliberado: un consumidor que se fije a la versión del build tendría que
reaccionar a cada despliegue aunque el contrato no haya cambiado.

## Dónde se publica el contrato

| Ruta | Qué sirve |
| --- | --- |
| `/docs/{API_VERSION}` | Swagger UI fijado a la versión del contrato |
| `/docs/{API_VERSION}/openapi.json` | Documento OpenAPI de esa versión |
| `/docs/{API_VERSION}/reference` | Referencia interactiva (Scalar) |
| `/docs`, `/docs/openapi.json` | Alias sin versión, conservados para herramientas existentes |

Todo se sirve solo con `SWAGGER_ENABLED=true`, valor que **el esquema prohíbe en producción**.
El contrato para integradores se publica como artefacto (`openapi/openapi.json`) y en el portal.

## Qué es un cambio incompatible

| Compatible (no sube la versión) | Incompatible (sube la versión) |
| --- | --- |
| Añadir un endpoint | Eliminar o renombrar un endpoint |
| Añadir un campo **opcional** a una petición | Añadir un campo obligatorio |
| Añadir un campo a una respuesta | Eliminar o renombrar un campo de una respuesta |
| Añadir un valor a una enumeración de **salida** | Añadir un valor a una enumeración de **entrada** que el cliente deba manejar |
| Añadir un código de error nuevo | Cambiar el código devuelto ante una situación existente |
| Relajar una validación | Estrechar una validación |

El criterio: si un cliente que funcionaba ayer deja de funcionar sin tocar su código, es
incompatible.

## Cómo se detecta

`redocly lint` en CI aplica el gobierno estructural, y el contrato se regenera de la
aplicación real en cada ejecución. Un cambio en un controlador que altere el contrato aparece
como diferencia en `openapi/openapi.json` dentro del mismo pull request — no como una sorpresa
en producción.

Para el cambio incompatible existe además la política de
[deprecación](deprecation-policy.md).

## `operationId`

Cada operación tiene un identificador estable derivado del controlador y el método
(`artifactList`, `runtimeDecide`…). Los generadores de clientes lo convierten en el nombre de
la función, así que **renombrar un método de controlador cambia el cliente generado**:
trátelo como parte del contrato.

La unicidad se verifica en CI; dos operaciones con el mismo identificador harían que un
cliente generado sobrescribiera un método con el otro.
