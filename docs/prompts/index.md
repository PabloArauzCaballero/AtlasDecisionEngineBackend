---
title: Prompts y contexto
tags:
  - prompts
  - entorno-asistido
---

# Prompts y contexto

Este backend se modifica con asistencia de modelos de lenguaje. Esa asistencia no es un
accidente de herramienta: define qué contexto recibe quien escribe el cambio, qué límites tiene
y qué evidencia debe producir. Documentarlo tiene el mismo propósito que documentar un runbook
—que el resultado no dependa de quién estuvo en el teclado— y el mismo límite: **el prompt no
es autoridad**. La precedencia sigue siendo la de [gobernanza](../design-rules/00-governance.md):
requisitos aprobados, contratos y migraciones vigentes, código y pruebas, y solo al final un
supuesto documentado.

## Las tres capas

| Capa | Dónde vive | Cuándo entra en contexto | Versionada |
| --- | --- | --- | --- |
| Instrucciones del repositorio | `CLAUDE.md` | Siempre | Sí |
| Reglas por tema y ruta | `.claude/rules/` → [reglas de diseño](../design-rules/index.md) | Al tocar las rutas que declara cada regla | Sí |
| Procedimientos bajo demanda | `.claude/skills/` → [skills](../skills/index.md) | Solo al invocarse por nombre | Sí |

A eso se suma el prompt de la tarea concreta, que **no** está versionado: lo escribe una persona
en cada sesión. Las páginas de esta sección existen para que esa parte —la única variable— sea
lo más previsible posible.

- [Capas de contexto](capas-de-contexto.md) — qué carga cada capa y por qué está separada.
- [Catálogo de prompts operativos](catalogo.md) — plantillas para las tareas recurrentes.
- [Límites e higiene](limites.md) — qué no se pide, y qué hacer cuando la respuesta no trae
  evidencia.

## Por qué se separa en capas y no en un solo archivo

Un archivo único con todo el conocimiento del repositorio se degrada de dos maneras: crece hasta
consumir el contexto que necesitaba la tarea, y mezcla lo que siempre aplica con lo que casi
nunca aplica. La separación resuelve ambas: `CLAUDE.md` guarda lo invariante y corto, las reglas
se activan por ruta —la regla de base de datos no ocupa espacio mientras se edita un
controlador—, y las skills solo se cargan cuando alguien las invoca.

Esta política está registrada en [documentación](../design-rules/90-documentation.md): los
procedimientos largos se convierten en skills y las reglas por ruta en `.claude/rules/`, en vez
de inflar el archivo raíz.
