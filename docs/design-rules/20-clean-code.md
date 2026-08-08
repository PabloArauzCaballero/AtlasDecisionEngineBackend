---
title: "Clean code"
tags:
  - reglas-de-diseno
  - clean-code
---
<!-- GENERADO POR scripts/docs/generate-vault.mjs — NO EDITAR A MANO.
     Fuente: .claude/rules/20-clean-code.md. Ejecute `yarn docs:vault` tras cambiarla. -->

# Clean code

!!! abstract "Ficha de la regla"
    **Fuente canónica:** `.claude/rules/20-clean-code.md` — esta página es su espejo generado.

    **Alcance:** Se aplica al editar `src/**/*.ts`.

    **Cómo se aplica:** la herramienta de asistencia carga la regla automáticamente al tocar esas rutas; una persona la aplica en revisión de código. La regla
    no sustituye a las pruebas ni a los controles de CI.

- Funciones y clases cohesivas; una responsabilidad por unidad.
- Sin código muerto ni duplicación semántica: reutiliza los servicios existentes
  (validador de grafo, runner de scripts, escritor de ejecución) en vez de
  reimplementar.
- Nombres que reflejen el dominio (artifact, version, node, edge, condition,
  action, reason). Sigue las convenciones del código circundante.
- Prefiere composición y argumentos explícitos sobre estado global.
- Escribe código que lea como el que lo rodea (densidad de comentarios, idioma,
  idioms).
