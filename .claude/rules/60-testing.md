---
paths:
  - "src/**/*.ts"
  - "test/**/*.ts"
---

# Pruebas

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
