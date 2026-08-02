<!-- GENERADO POR scripts/docs/generate-doc-report.mjs — NO EDITAR A MANO. -->

# Métricas de calidad documental

Calculadas el 2026-08-01T03:54:51.858Z.

| Métrica | Valor | Objetivo |
| --- | ---: | ---: |
| Endpoints documentados en el catálogo | 100 % | 100 % |
| Operaciones con `operationId` | 100 % | 100 % |
| Operaciones con resumen | 100 % | 100 % |
| Operaciones con etiqueta | 100 % | 100 % |
| Operaciones autenticadas con seguridad declarada | 100 % | 100 % |
| Operaciones con esquema de respuesta | 100 % | 100 % (fallo duro) |
| Módulos con página | 100 % | 100 % |
| Variables de entorno documentadas | 100 % | 100 % |

## Inventario

| Elemento | Cantidad |
| --- | ---: |
| Páginas del portal | 165 |
| Rutas del contrato | 97 |
| Operaciones | 109 |
| Esquemas | 221 |
| Módulos | 24 |
| Entidades | 68 |
| Eventos | 6 |
| Códigos de error | 163 |
| Variables de entorno | 118 |
| Runbooks | 4 |

## Esquemas de respuesta

Sin deuda: **toda** operación describe el cuerpo de su respuesta. La regla es un fallo duro — un endpoint nuevo que no lo haga rompe CI.

