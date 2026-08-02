# ADR-0023: Documentación generada del código

## Estado

Aceptado — 2026-07-31

## Contexto

La documentación técnica se degrada por un mecanismo previsible: alguien copia una tabla de
endpoints, de entidades o de variables de entorno, y esa copia queda obsoleta con el siguiente
despliegue. Nadie se entera hasta que un integrador se bloquea o un operador sigue un
procedimiento que ya no aplica.

El repositorio tenía 24 módulos, 108 endpoints, 68 entidades, 163 códigos de error y 105
variables de entorno. Mantener todo eso a mano no es una cuestión de disciplina: es
aritméticamente inviable.

## Fuerzas y restricciones

- La documentación debe reflejar el sistema real, no la intención.
- La desactualización debe detectarse **automáticamente**.
- No todo se puede generar: el «por qué» de una decisión no está en el código.
- El portal debe compilar en modo estricto: un enlace roto es un error.

## Opciones consideradas

| Opción | Por qué no |
| --- | --- |
| Todo a mano | Inviable a esta escala; envejece en silencio |
| Todo generado | El razonamiento y las restricciones de negocio no están en el código |
| Comentarios en el código como única documentación | No sirve a operaciones, cumplimiento ni integradores |

## Decisión

**Separar por naturaleza del contenido.**

### Se genera (nadie lo edita a mano)

| Página | Fuente |
| --- | --- |
| Catálogo de endpoints y páginas por módulo | `openapi/openapi.json` + `src/modules/` |
| Catálogo de entidades | `prisma/schema.prisma` |
| Catálogo de eventos | `common/events/event-types.ts` + productores y consumidores reales |
| Catálogo de códigos de error | Las `DomainException` que el código lanza |
| Variables de entorno | `common/config/env.schema.ts` |
| Auditoría del grafo y dependencias entre módulos | `graphify-out/graph.json` contrastado con el disco |

Todas llevan un aviso de generación para que nadie pierda su trabajo en la siguiente ejecución.

### Se escribe a mano (no está en el código)

Contexto de negocio, decisiones y su razón, modelo de amenazas, runbooks, objetivos de servicio,
guías de integración y ADR.

### Se valida automáticamente

`yarn docs:validate` = contrato + catálogos + cobertura + enlaces. El portal compila con
`--strict`.

## Consecuencias positivas

- Un endpoint, una entidad, un evento o una variable nuevos aparecen sin intervención.
- Un catálogo desactualizado es imposible: se regenera desde la fuente.
- La documentación escrita a mano queda liberada para lo que **solo** una persona puede aportar: el porqué.
- Las métricas del informe final se calculan, no se cuentan a mano.

## Consecuencias negativas

- La documentación depende de que las herramientas de generación funcionen.
- Las páginas generadas son más secas: describen, no explican.
- El repositorio contiene ficheros generados, con sus diferencias en cada cambio.
- MkDocs se ejecuta en contenedor, así que el portal exige Docker para compilarse localmente.

## Riesgos

| Riesgo | Mitigación |
| --- | --- |
| Alguien edita una página generada | El aviso de la cabecera y la regeneración en CI |
| El generador se rompe en silencio | Forma parte de `docs:validate`, que falla en CI |
| La documentación manual envejece igual | Comprobación de cobertura: un módulo sin página falla |

## Evidencia

```
Catálogos generados: 24 módulos, 108 endpoints, 68 entidades, 6 eventos,
163 códigos de error, 105 variables de entorno.
Auditoría Graphify: 2724 nodos, 6056 relaciones, 0 ciclos entre módulos,
0 ficheros ausentes en disco.
```

## Plan de revisión

Revisar si el coste de mantener los generadores supera al de las páginas que producen — señal
de que se está generando algo que debería escribirse, o al revés.
