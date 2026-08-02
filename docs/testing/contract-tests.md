# Pruebas de contrato

Lo que impide que el contrato publicado se convierta en ficción.

```bash
yarn docs:openapi:generate   # contrato desde la aplicación REAL
yarn docs:openapi:check      # reglas propias de este producto
yarn docs:openapi:lint       # gobierno estructural (Redocly)
```

## El contrato se genera, no se escribe

`scripts/docs/generate-openapi.mjs` arranca la aplicación compilada y recorre sus controladores.
Un endpoint nuevo aparece sin que nadie lo transcriba; uno borrado desaparece. Es la única
forma de que el contrato no envejezca.

Además, el documento lo construye el **mismo** `buildOpenApiDocument` que sirve `main.ts`: el
contrato publicado y el servido no pueden divergir.

## Reglas propias (`check-openapi-quality.mjs`)

| Regla | Por qué no la cubre un linter genérico |
| --- | --- |
| `operationId` único | Un duplicado hace que un cliente generado sobrescriba un método con el otro |
| Toda operación con `summary` y etiqueta | Descubribilidad |
| Toda operación autenticada declara `401` y `403` | Redocly no distingue las sondas públicas |
| Las sondas públicas **no** heredan seguridad | Un contrato que exige credencial en `/health` confunde al operador |
| Sin patrones con forma de secreto | El contrato acaba en el portal y en clientes generados |
| Trinquete de esquemas de respuesta | La deuda no puede crecer |

## Estado medido

```
Rutas: 97  Operaciones: 109  Esquemas: 221
operationId: 109/109
summary: 109/109
etiqueta: 109/109
seguridad: 105/105 (+4 públicas)
respuesta con esquema: 109/109 (sin deuda: la regla es fallo duro)
```

Redocly: **0 errores**, 4 avisos — todos del mismo caso: las sondas de salud no pueden devolver
ningún `4xx`, así que la regla exigiría documentar un error imposible.

## De trinquete a fallo duro

La deuda de esquemas de respuesta empezó en 70 operaciones y llegó a **cero**. Mientras existió,
vivió en `docs/reports/openapi-response-schema-debt.json` con un límite que solo podía bajar.
Ahora que es cero, la regla **es un fallo duro**: un endpoint nuevo que no describa su cuerpo
rompe CI.

Lo que no cambió en ningún momento: **no se fabrica un esquema aproximado**. Un contrato que
miente sobre la forma es peor que uno que reconoce no describirla. Donde la forma real era
incómoda se documentó como es — el agregado crudo de Prisma en `/v1/audit/metrics`, el array
desnudo de los casos de suite, el retorno sin tipo fijo de un campo calculado.

## Conformidad: que la respuesta real cumpla lo declarado

Declarar un esquema no garantiza cumplirlo. `test/e2e/contract-conformance.e2e-spec.ts` valida
cuerpos **reales** contra `openapi/openapi.json` con Ajv:

| Qué comprueba | Por qué ese caso |
| --- | --- |
| Sondas públicas | Las consume el orquestador; su forma no puede cambiar en silencio |
| Envoltorio de paginación | Además de la forma, que `hasNextPage` sea coherente con `page` y `totalPages` — o el integrador pagina de forma infinita |
| DTO propios (contador, verificación de cadena) | Son los que un auditor consulta |
| El sobre de error | Lo produce el filtro global: si se desviara, ningún endpoint concreto lo delataría |

Ya encontró un defecto real: un endpoint cuyo esquema faltaba en el contrato publicado.

```
Tests: 5 passed, 5 total
```

## Descripción de parámetros

Los 117 parámetros sin descripción se resolvieron **por nombre** en `COMMON_PARAMETER_DESCRIPTIONS`
(`openapi-document.ts`), no endpoint a endpoint: `versionId` aparece en 23 operaciones y
documentarlo 23 veces habría sido una copia que el siguiente endpoint volvería a olvidar.

El mapa nunca pisa una descripción existente —un endpoint con un matiz propio gana— y un nombre
que no esté en él sigue produciendo un aviso de Redocly, que es la presión que mantiene la lista
viva.
