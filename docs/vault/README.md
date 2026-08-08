---
title: Cómo funciona esta bóveda
tags:
  - moc
  - meta
---

# Cómo funciona esta bóveda

`docs/` cumple dos papeles a la vez:

1. Es el **origen del portal técnico** (MkDocs Material, `yarn docs:build`), que se construye en
   modo estricto: un enlace roto o una página fuera de la navegación rompe el build.
2. Es una **bóveda de Obsidian**, con su configuración en `docs/.obsidian/`. Abra la carpeta
   `docs` como bóveda y empiece por [inicio](inicio.md).

Que sean el mismo contenido y no dos copias es deliberado: dos copias divergen.

## La decisión que hace posible esa convivencia

Obsidian admite dos formas de enlazar. Los `[[wikilinks]]` son idiomáticos pero MkDocs no los
entiende, así que **esta bóveda usa enlaces Markdown relativos** —`[texto](../carpeta/nota.md)`—
que funcionan igual de bien en ambos: Obsidian los resuelve, los muestra en el grafo y los
actualiza al mover un archivo.

Eso está fijado en `docs/.obsidian/app.json` con `useMarkdownLinks: true` y
`newLinkFormat: "relative"`. Si alguien lo cambia, los enlaces nuevos dejarán de compilar en el
portal.

## Qué hay en `vault/`

Esta carpeta contiene la capa que es **solo de Obsidian** y está excluida del portal (donde
duplicaría su navegación lateral):

| Archivo | Papel |
| --- | --- |
| [inicio](inicio.md) | Nota raíz de la bóveda. |
| [moc-modelo](moc-modelo.md) · [moc-arquitectura](moc-arquitectura.md) · [moc-reglas-y-prompts](moc-reglas-y-prompts.md) · [moc-seguridad-y-operacion](moc-seguridad-y-operacion.md) · [moc-decisiones-y-evidencia](moc-decisiones-y-evidencia.md) | Mapas de contenido por tema. |
| `plantillas/` | Plantillas del plugin *Templates* (ADR, módulo, runbook, informe de verificación). |
| `adjuntos/` | Carpeta destino de imágenes pegadas, para que no se dispersen entre las carpetas del portal. |

Todo lo demás en `docs/` —arquitectura, datos, API, seguridad, operación, ADR, reglas de diseño,
prompts, skills— sí forma parte del portal y se recorre igual desde Obsidian.

## Reglas para no romper nada

- **Enlaces Markdown relativos**, nunca wikilinks.
- **No editar páginas generadas.** Llevan un aviso en la cabecera y su fuente al lado. Se
  regeneran con `yarn docs:catalog` (catálogos del código) o `yarn docs:vault` (espejo de
  `.claude/`), y `yarn docs:validate` falla si alguien las editó a mano.
- **Toda página nueva del portal va a la navegación** de `mkdocs.yml`. Una página fuera de la
  navegación es contenido que nadie encuentra, y `yarn docs:links` la reporta como huérfana.
- **Las notas de `vault/` no se enlazan desde páginas del portal**: están excluidas del build y
  el enlace quedaría roto en modo estricto.
- El frontmatter (`title`, `tags`) lo aprovechan ambas herramientas: Obsidian para el panel de
  etiquetas y el grafo, MkDocs Material como metadatos de página.

## Estado de las etiquetas

Las páginas nuevas de esta bóveda llevan etiquetas; el grueso de la documentación previa aún no,
y agregárselas en masa tocaría también páginas generadas. Mientras tanto, el grafo colorea por
carpeta —configurado en `docs/.obsidian/graph.json`— y la búsqueda por ruta (`path:security`)
sustituye a la búsqueda por etiqueta.

## Lo que no está aquí

El código, el esquema de Prisma y las migraciones no son parte de la bóveda: Obsidian solo ve
`docs/`. Cuando una página necesita señalar un archivo del repositorio, lo cita como texto
(`src/modules/graph/…`) y no como enlace, porque un enlace fuera de `docs/` rompe el build del
portal y tampoco se resuelve en Obsidian.
