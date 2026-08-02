# Reporte final de implementación — Rebanadas 2-5

> **Documento histórico (2026-07-21).** Conserva la evidencia y el alcance de esa entrega; no
> describe necesariamente el backend vigente. Consulte `docs/README.md` y la verificación más
> reciente antes de tomar una decisión de release.

**Fecha:** 2026-07-21
**Ramas:** `feature/rebanadas-2-a-5` en `AtlasDecisionEngine` (backend) y
`AtlasDecisionEngineFrontend` (frontend).
**Worktrees usados:** `../atlas-backend-pendientes` y `../atlas-frontend-pendientes`
(directorios físicamente separados de los checkouts principales, para no colisionar
con la sesión de la Rebanada 1).

## Qué se implementó y verificó

| Rebanada | Fase(s) | Estado | Verificación |
|---|---|---|---|
| 3 — Árboles de decisión anidados | 7 | ✅ Completa | unit + 12 e2e contra Postgres real |
| 2 — Generador Código→Flow (JS/Python) | 5 | ✅ Completa | 14 unit + 6 e2e |
| 5 — Vista de equipo de seguridad | 10 | ✅ Completa | 5 e2e |
| 5 — Tutorial interactivo | 4 | ✅ Completa | 5 unit (frontend) |
| 4 — Ejecución en vivo (SSE) | 8 | ✅ Completa (autosuficiente; integración con bus R1 pendiente de merge) | 2 unit + 3 e2e |
| Transversal — QA FlowChart | 3 | ✅ Bug de carga reproducido y corregido | 2 unit (frontend) |
| Transversal — Docs + OpenAPI | 17 | ✅ 6 docs nuevos; 11 endpoints en OpenAPI | verificado sobre instancia viva |

Detalle de cada rebanada en su doc dedicado: `nested-decision-trees.md`,
`code-to-flow-specification.md`, `security-review.md`, `live-execution.md`,
`flowchart-user-guide.md`. Reporte de pruebas con salida real de gates:
`testing-report.md`.

## Decisiones de diseño clave (para el revisor)

1. **Cero colisiones con la Rebanada 1.** Todo el trabajo vive en worktrees
   separados y ramas propias. Los modelos nuevos (`DecisionArtifactReference`,
   `DecisionExecutionTreeLink`, `DecisionCodeImport`) se añadieron a
   `schema.prisma` en un **bloque aditivo delimitado al final**, sin relaciones
   Prisma hacia modelos existentes (la integridad referencial vive en el SQL de la
   migración), para minimizar la superficie de reconciliación en el merge.
2. **Migración con timestamp posterior:** `20260721200410_nested_trees_and_code_import`,
   creada después de las de la Rebanada 1, con RLS por tenant espejo de
   `20260719080000_tenant_rls_and_app_role`.
3. **Sin dependencias circulares de módulos.** Los resolvers de árboles anidados y
   el callback de ejecución en vivo se pasan como **argumentos de llamada** a
   `ExecutionEngineService.execute()`, nunca como dependencias de constructor, así
   que `GraphModule` no depende de ningún módulo nuevo y todos los llamadores
   existentes siguen funcionando sin cambios.
4. **Reuso, no reimplementación.** El generador Código→Flow reutiliza el
   `script-node-runner` con sandbox y el `GraphValidatorService` existentes; la
   vista de seguridad agrega datos existentes sin tablas nuevas; aprobar/rechazar
   reutiliza el endpoint de gobernanza con RBAC real ya existente.

## Bugs preexistentes encontrados y corregidos

- **`TestCaseExecutorService`** no filtraba las variables de salida
  (`OUTPUT_PRIMARY`) antes de resolver variables de entrada, por lo que cualquier
  artefacto con salidas configurables fallaba al correr en un test suite. Expuesto
  por el e2e de árboles anidados, corregido.
- **Editor de FlowChart** no cargaba el grafo al abrirlo por URL directa (Fase 3
  QA). Reproducido y corregido con prueba.
- **Analizador de sintaxis Código→Flow** rechazaba un `return` de nivel superior
  válido. Detectado por sus propias pruebas unitarias, corregido envolviendo la
  fuente en el mismo wrapper de función que usa el runtime real.

## Estado de integración a `main` — COMPLETADO Y VERIFICADO

El merge a `main` **se realizó y se verificó** en el repo backend, sin perder el
trabajo de la Rebanada 1. Secuencia ejecutada:

1. **Preservación de la Rebanada 1.** El `main` tenía ~180 archivos sin commitear
   de la sesión de la Rebanada 1 (event-driven, outbox, notifications, seeding,
   sus pruebas y la regeneración de `graphify-out`). Se commiteó íntegro a la rama
   **`wip/rebanada-1`** (commits `3771eb9` + `c82bcec`), 100 % recuperable — nunca
   se descartó nada ajeno.
2. **Fusión de este trabajo.** `main` limpio → `git merge --ff-only
   feature/rebanadas-2-a-5` (fast-forward). Mis 6 rebanadas + docs + `.claude/`
   quedaron en `main`.
3. **Reconciliación de la Rebanada 1.** `git merge wip/rebanada-1` → merge
   `513cbb2`. 5 conflictos, todos resueltos:
   - `prisma/schema.prisma`, `env.schema.ts`, `app.module.ts` — **aditivos**, se
     conservaron ambos lados (sin solapamiento de nombres).
   - `execution-engine.service.ts` y `graph-structure.validator.ts` — la Rebanada 1
     solo había reformateado (prettier) el código; mi versión (con `onStep` de
     ejecución en vivo y el modo `REFERENCE`) es superset y se conservó.
   - **Ajuste de tipos** (`a60fd31`): la Rebanada 1 endureció `@Roles(...)` para
     aceptar `PlatformRole` en vez de `string`; se adoptó ese tipo en la vista de
     seguridad.

### Verificación del `main` fusionado (evidencia real)

| Gate | Resultado |
|---|---|
| `yarn prisma:validate` (73 modelos/enums combinados) | ✅ `valid 🚀` |
| `prisma migrate deploy` (cadena completa de **19 migraciones**) | ✅ aplicada |
| `yarn typecheck` | ✅ sin errores |
| `yarn build` | ✅ `nest build` OK |
| `yarn test` (unit + integración, **ambas rebanadas**) | ✅ **359 pasan / 55 suites** (2 skip) |
| `yarn test:e2e` | ✅ **52 pasan / 10 suites** |

Ambos flujos de trabajo conviven en `main`: los 4 módulos de este trabajo
(`nested-trees`, `code-import`, `security-review`, `live-execution`) y los 3 de la
Rebanada 1 (`notifications`, `outbox-relay`, `seeding`), con sus pruebas en verde
juntas.

### Frontend — también fusionado y verificado

El repo frontend siguió el mismo patrón seguro: se preservó su WIP de la
Rebanada 1 (notifications UI, GlobalSearchBox, RouteProgress, su propio tutorial,
etc.) en `wip/rebanada-1`, se hizo fast-forward de mi rama y se reconciliaron 8
conflictos (merge `a5825df`):

- **Solape de tutoriales**: ambas sesiones construyeron un tutorial. Se adoptó el
  de la Rebanada 1 en el chrome (`NextTopbar` con `TutorialLauncher` +
  `NotificationCenter`, más completo); mi `TutorialProvider` queda montado como
  sistema latente no destructivo (mis 5 pruebas siguen en verde).
- **Aditivos** (`ArtifactDetailPage`, `ApprovalRequestDetailPage`, `SimulatorPage`,
  `global.css`, `operations-governance.css`): se conservaron ambos lados; mis
  enlaces (dependency-graph, security-review) + las mejoras de R1.
- **Límite de 299 líneas**: el merge empujó `useGraphEditor.ts` a 310; el
  auto-load del editor (Fase 3 QA) se movió a `GraphEditorPage` y los estilos de
  árboles anidados a `parts/nested-trees.css`.

Gates del frontend fusionado (evidencia real):

| Gate | Resultado |
|---|---|
| `yarn verify:source` | ✅ 246 archivos, 26 rutas |
| `yarn typecheck` | ✅ sin errores |
| `yarn lint` | ✅ `--max-warnings=0` |
| `yarn test` (mías + Rebanada 1) | ✅ **76 pasan / 19 suites** |
| `yarn build` | ✅ 26 rutas |

### Pendiente menor (no bloqueante)

- **Solape de tutoriales (frontend)**: quedan dos implementaciones de tutorial en
  el árbol (la de R1, activa; la mía, latente). Es una decisión de producto
  —cuál conservar— que dejé sin forzar; ambas compilan y prueban. Limpiar la no
  elegida es un paso posterior trivial.
- **Integración de ejecución en vivo con el bus de eventos** (opcional, ver
  `live-execution.md`): publicar `live_execution.step` al bus de R1 ahora que
  coexisten; no es requisito para que la vista funcione.
- **`smoke`**: no se re-corrió contra la base compartida para no alterar su
  estado de seed; el suite `test:e2e` (52 pruebas, ya verde sobre este `main`)
  cubre el mismo camino HTTP/auth/RBAC con más profundidad, y el smoke dio 5/5 en
  la corrida aislada durante el desarrollo.
- **`git push`**: no ejecutado (no autorizado explícitamente); ambos `main`
  locales están adelantados de `origin`. Empujar cuando se desee publicar.

## Nota de infraestructura

Durante la corrida final el disco `C:` se llenó por completo (ENOSPC), lo que
dejó a Docker sin responder. Se liberó espacio borrando cachés regenerables
(`dist/`, `.next/`, cachés de yarn/npm). Tras liberar, todos los gates de arriba
corrieron en verde. La rama `wip/rebanada-1` se conserva como respaldo del estado
de la Rebanada 1 previo al merge.
