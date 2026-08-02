# ADR-0022: OpenAPI generado como fuente de verdad del contrato

## Estado

Aceptado — 2026-07-31

## Contexto

El contrato existía solo en tiempo de ejecución, servido por Swagger cuando
`SWAGGER_ENABLED=true` — valor prohibido en producción. Consecuencias:

- No había artefacto versionado que un integrador pudiera consultar ni contra el que generar un cliente.
- Ninguna herramienta podía gobernar su calidad en CI.
- Nadie podía ver, en un pull request, que un cambio alteraba el contrato.

Un contrato que solo existe en un proceso vivo no es un contrato: es un efecto secundario.

## Fuerzas y restricciones

- El contrato debe describir la API **real**, no una reconstrucción escrita a mano.
- Lo servido y lo publicado no pueden divergir.
- La generación debe ser reproducible en CI.
- No se puede fabricar información que no exista: un esquema inventado es peor que su ausencia.

## Opciones consideradas

| Opción | Por qué no |
| --- | --- |
| Escribir `openapi.yaml` a mano | Envejece con el primer despliegue; describe intención, no realidad |
| Extraer el contrato de un servidor en marcha con `curl` | Exige el servidor arriba con Swagger activo; no reproducible en CI |
| Reconstruir las rutas por análisis estático | Aproximación: se pierden los DTO, los decoradores y la seguridad |

## Decisión

1. `buildOpenApiDocument()` en `common/openapi/`, **única** construcción del documento, usada por `main.ts` (lo sirve) y por `scripts/docs/generate-openapi.mjs` (lo escribe).
2. El generador arranca la aplicación compilada y recorre sus controladores reales.
3. El documento se enriquece de forma centralizada:
   - `operationId` estable y legible derivado de controlador y método;
   - etiquetas globales con descripción, derivadas de las usadas;
   - modelo de error `ProblemDetails` que refleja **exactamente** lo que emite el filtro global;
   - respuestas de error universales (401/403/429/500, y 400 donde hay algo que validar) inyectadas sin pisar las que el controlador ya declare.
4. Dos puertas: `check-openapi-quality.mjs` (reglas propias) y `redocly lint` (estructura).
5. La deuda de esquemas de respuesta se registra con **trinquete**: solo puede bajar.

## Consecuencias positivas

- Un endpoint nuevo aparece en el contrato, en el catálogo y en la referencia sin transcripción.
- Un cambio de contrato es visible como diferencia en el pull request.
- 108/108 operaciones con identificador, resumen, etiqueta y seguridad declarada.
- Redocly pasa con 0 errores (de 217 iniciales).
- El contrato se puede versionar, empaquetar y usar para generar clientes.

## Consecuencias negativas

- Generar exige `yarn build` y una base de datos alcanzable: el módulo raíz abre la conexión al inicializarse.
- Renombrar un método de controlador cambia el `operationId` y, con él, el cliente generado. Es ahora **parte del contrato**.
- El fichero generado entra en el control de versiones y produce diferencias en cada cambio de API — que es exactamente el punto.

## Riesgos

| Riesgo | Mitigación |
| --- | --- |
| El generador no corre en CI por falta de base de datos | CI ya levanta PostgreSQL para las e2e |
| Alguien edita `openapi/openapi.json` a mano | Se sobrescribe en la siguiente generación |
| Un `operationId` cambia sin querer | La unicidad se verifica; el cambio es visible en el diff |

## Evidencia

```
openapi/openapi.json: 96 rutas, 108 operaciones, 66 esquemas
operationId 108/108 · summary 108/108 · etiqueta 108/108 · seguridad 104/104 (+4 públicas)
Redocly: 0 errores, 120 avisos
```

## Plan de revisión

Revisar cuando la deuda de esquemas de respuesta llegue a cero: entonces la regla podrá pasar
de trinquete a fallo duro.
