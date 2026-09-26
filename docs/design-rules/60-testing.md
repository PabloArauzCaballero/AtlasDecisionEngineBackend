---
title: "Pruebas"
tags:
  - reglas-de-diseno
  - pruebas
---
<!-- GENERADO POR scripts/docs/generate-vault.mjs — NO EDITAR A MANO.
     Fuente: .claude/rules/60-testing.md. Ejecute `yarn docs:vault` tras cambiarla. -->

# Pruebas

!!! abstract "Ficha de la regla"
    **Fuente canónica:** `.claude/rules/60-testing.md` — esta página es su espejo generado.

    **Alcance:** Se aplica al editar `src/**/*.ts` · `test/**/*.ts`.

    **Cómo se aplica:** la herramienta de asistencia carga la regla automáticamente al tocar esas rutas; una persona la aplica en revisión de código. La regla
    no sustituye a las pruebas ni a los controles de CI.

- Unit/integración: Jest, archivos `*.spec.ts` (`jest.config.js`). Corre con
  `yarn test`.
- E2E: `test/e2e/*.e2e-spec.ts` contra Postgres/Redis reales
  (`test/jest-e2e.json`); corre con `yarn test:e2e`. Usa
  `createTestApp()` y los clientes de `test/e2e/support/`.
- Toda feature nueva añade pruebas: al menos unit del núcleo de lógica y, si toca
  el camino de decisión/persistencia, un e2e que lo ejercite de punta a punta.
- No declares una prueba `PASS` sin la salida real del runner.
- Para gates que dependen de infraestructura externa no disponible: implementa la
  prueba/validador igualmente, documenta el dato externo exacto que falta, y no
  bloquees el resto.
- Los artefactos con salidas configurables deben filtrar variables `OUTPUT*`
  antes de resolver entradas (ver el fix en `TestCaseExecutorService`).
