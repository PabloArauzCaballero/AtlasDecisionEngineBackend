---
title: "Documentación"
tags:
  - reglas-de-diseno
  - documentacion
---
<!-- GENERADO POR scripts/docs/generate-vault.mjs — NO EDITAR A MANO.
     Fuente: .claude/rules/90-documentation.md. Ejecute `yarn docs:vault` tras cambiarla. -->

# Documentación

!!! abstract "Ficha de la regla"
    **Fuente canónica:** `.claude/rules/90-documentation.md` — esta página es su espejo generado.

    **Alcance:** Se aplica a todo el repositorio, sin restricción de ruta.

    **Cómo se aplica:** la herramienta de asistencia carga la regla en toda sesión sobre este repositorio; una persona la aplica en revisión de código. La regla
    no sustituye a las pruebas ni a los controles de CI.

- Toda feature nueva o endpoint nuevo/modificado actualiza:
  - el doc de dominio en `docs/` (p. ej. `docs/nested-decision-trees.md`),
  - la anotación OpenAPI (`@ApiTags`, decoradores de `@nestjs/swagger`) del
    controller — Swagger genera el spec en `/docs/openapi.json` cuando
    `SWAGGER_ENABLED=true`.
- Los comentarios de código explican una restricción o un "por qué" no evidente,
  no reescriben lo que el código ya dice.
- No copies documentos extensos dentro de `CLAUDE.md`; convierte procedimientos
  largos en skills (`.claude/skills/`) y reglas por ruta en `.claude/rules/`.
- Mantén trazabilidad: un doc de feature enlaza a los archivos/servicios reales.
- `docs/` es a la vez el origen del portal MkDocs y una bóveda de Obsidian: usa
  enlaces Markdown relativos (nunca wikilinks) y añade toda página nueva a la
  navegación de `mkdocs.yml`, o `yarn docs:links` la marcará como huérfana.
- Tras editar `.claude/rules/**` o `.claude/skills/**`, ejecuta `yarn docs:vault`:
  su espejo legible vive en `docs/design-rules/` y `docs/skills/`, y
  `yarn docs:validate` falla si se separa de la fuente.
