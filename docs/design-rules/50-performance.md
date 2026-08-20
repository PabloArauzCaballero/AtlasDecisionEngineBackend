---
title: "Rendimiento"
tags:
  - reglas-de-diseno
  - rendimiento
---
<!-- GENERADO POR scripts/docs/generate-vault.mjs — NO EDITAR A MANO.
     Fuente: .claude/rules/50-performance.md. Ejecute `yarn docs:vault` tras cambiarla. -->

# Rendimiento

!!! abstract "Ficha de la regla"
    **Fuente canónica:** `.claude/rules/50-performance.md` — esta página es su espejo generado.

    **Alcance:** Se aplica al editar `src/**/*.ts`.

    **Cómo se aplica:** la herramienta de asistencia carga la regla automáticamente al tocar esas rutas; una persona la aplica en revisión de código. La regla
    no sustituye a las pruebas ni a los controles de CI.

- Paginación: usa `paginationArgs`/`pageResult` de `common/http/pagination`. Para
  feeds que crecen sin cota (auditoría), recorre por cursor/keyset en lotes, no
  `findMany` sobre toda la tabla (evita OOM y DoS barato).
- No abras transacciones de base de datos alrededor de I/O de red (resolución de
  variables externas, ejecución de scripts): resuelve primero, persiste después.
- Cachea lecturas caras tenant-scoped con `CacheService` (Redis), siempre con el
  tenant en la clave.
- Acota la ejecución: `MAX_EXECUTION_STEPS`, timeouts de script y de árboles
  anidados (`NESTED_TREE_*`), tamaños máximos de fuente importada.
