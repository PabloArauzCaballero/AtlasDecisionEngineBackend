# Reporte final de implementación — Rebanadas 2-5

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

## Estado de integración a `main` — REQUIERE ACCIÓN DEL USUARIO

**El merge automático a `main` no se realizó, y no debe forzarse**, por la
regla #6 del brief ("Si detectas cambios sin commitear que no son tuyos, NO los
sobrescribas… detente y repórtalo"):

- El `main` del backend tiene **181 archivos modificados sin commitear** que no
  son de este trabajo (incluyen los archivos compartidos `src/app.module.ts`,
  `prisma/schema.prisma`, `src/common/config/env.schema.ts`) — presumiblemente el
  trabajo en curso de la Rebanada 1.
- Un `git merge feature/rebanadas-2-a-5` sería rechazado por git precisamente
  porque sobrescribiría esos archivos sin commitear — lo cual es correcto.

### Pasos de merge sugeridos (a ejecutar cuando la Rebanada 1 esté commiteada)

1. En cada repo, **commitear o hacer stash de los cambios de la Rebanada 1** en
   `main` primero (esa sesión debe cerrar su trabajo).
2. `git merge feature/rebanadas-2-a-5` (o abrir PR de la rama a `main`).
3. **Reconciliar los archivos compartidos** — todos aditivos por diseño:
   - `prisma/schema.prisma`: fusionar el bloque `>>> BEGIN feature/rebanadas-2-a-5`
     con los modelos de R1 (`DecisionOutboxEvent`, `ProcessedEvent`,
     `Notification`, enum `OutboxStatus`). No hay solapamiento de nombres.
   - `src/common/config/env.schema.ts`: fusionar el bloque aditivo de config
     (`NESTED_TREE_*`, `CODE_IMPORT_*`, `LIVE_EXECUTION_*`) con las claves de R1
     (`OUTBOX_*`). No hay solapamiento.
   - `src/app.module.ts`: incluir en `imports[]` tanto los módulos de R1 como los
     de este trabajo (`NestedTreesModule`, `CodeImportModule`, `SecurityReviewModule`,
     `LiveExecutionModule`).
   - `src/auth/route-access.ts` (frontend): concatenar las reglas de ruta de ambas
     ramas.
4. **Migraciones Prisma:** tras el merge, correr `prisma migrate deploy` sobre una
   base con la cadena completa (las migraciones de R1 y la de este trabajo tienen
   timestamps distintos y no chocan en orden) y validar la cadena.
5. **Integración de ejecución en vivo con el bus de R1** (opcional, ver
   `live-execution.md`): publicar un evento `live_execution.step` al bus una vez
   fusionado; no es requisito para que la vista funcione.
6. Correr todos los gates de nuevo sobre `main` fusionado.

## Nota de infraestructura

La verificación final combinada de `yarn build` sobre el worktree backend se
interrumpió una vez por **disco lleno** (ENOSPC) en el equipo Windows, no por un
fallo de código (el build ya había pasado limpio durante el desarrollo de la
Rebanada 4, y typecheck sigue en verde). Se liberó espacio borrando cachés
regenerables (`dist/`, `.next/`). Conviene liberar más espacio en `C:` antes de
la corrida de gates post-merge.
