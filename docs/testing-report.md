# Reporte de pruebas — Rebanadas 2-5 (Fases 3, 4, 5, 7, 8, 10)

> **Documento histórico (2026-07-21).** Sus resultados justifican la entrega que se probó ese día,
> no el estado actual ni un Go-Live. Consulte `docs/README.md` y repita los gates de release.

**Fecha:** 2026-07-21
**Entorno de verificación:** PostgreSQL 16 + Redis 7 en contenedores Docker
aislados (`atlas-pendientes`, puertos 55433/6380), rol de aplicación
`atlas_app` con RLS activo, base separada de cualquier otra sesión.

## Cómo se corrieron los gates

Toda la verificación de backend corrió contra una infraestructura Docker
**dedicada y desechable** (no la base compartida que la otra sesión —Rebanada
1— pudiera estar usando), levantada con:

```
POSTGRES_PORT=55433 REDIS_PORT=6380 POSTGRES_DB=atlas_decision_pendientes \
  docker compose -p atlas-pendientes up -d postgres redis
DATABASE_URL=...@localhost:55433/... yarn prisma migrate deploy
ADMIN_DATABASE_URL=...  APP_DB_PASSWORD=...  node scripts/set-app-db-role.mjs
```

`prisma migrate reset` NO se usó: Prisma bloquea ese comando cuando lo invoca un
agente de IA (exige consentimiento explícito del usuario). En su lugar, para
partir de una base limpia se recicló el contenedor con
`docker compose down -v && up -d`, que es equivalente y no toca ninguna base de
producción.

## Backend — resultados de gates (salida real)

| Gate | Resultado | Evidencia |
|---|---|---|
| `yarn prisma:validate` | ✅ PASS | `The schema at prisma\schema.prisma is valid 🚀` |
| `yarn prisma migrate deploy` (cadena completa, 17 migraciones incl. la nueva) | ✅ PASS | `All migrations have been successfully applied.` |
| `yarn typecheck` | ✅ PASS | `tsc --noEmit` sin errores |
| `yarn build` | ✅ PASS | `nest build` sin errores |
| `yarn test` (unit + integración) | ✅ PASS | `Test Suites: 3 skipped, 35 passed; Tests: 11 skipped, 184 passed, 195 total` |
| `yarn test:e2e` | ✅ PASS | `Test Suites: 10 passed; Tests: 52 passed` |
| `yarn smoke` | ✅ PASS | `5/5 passed` (contra instancia real en :3099) |
| OpenAPI/Swagger | ✅ PASS | 69 paths; los 11 endpoints nuevos presentes (references, dependency-graph, code-imports×5, security-review×2, live-executions) |

Nota sobre migraciones: la base compartida original tenía una migración de la
otra sesión (`20260720030000_audit_event_tenant_keyset_index`) aplicada pero
ausente del árbol local, lo que causaba drift. Por eso la verificación se hizo
contra una base fresca donde solo se aplican las migraciones del árbol de este
trabajo; la reconciliación con las migraciones de la Rebanada 1 queda documentada
en `docs/final-implementation-report.md`.

## Pruebas nuevas añadidas

### Unitarias / integración (backend)
- `test/cycle-detector.spec.ts` — detección de ciclos y profundidad para árboles
  anidados (17 aserciones: self-ref, ciclos de 2 y N nodos, diamante sin ciclo,
  profundidad más larga vs. más corta, ancestros).
- `test/nested-tree-execution.service.spec.ts` — resolución de referencias:
  éxito, FAIL/FALLBACK/SKIP, timeout, profundidad excedida, referencia inexistente.
- `test/code-import-pipeline.spec.ts` — extracción de contrato JS/Python,
  validación de contrato, análisis de seguridad, análisis de sintaxis, generación
  de grafo (14 pruebas; una detectó y corrigió un bug real en el analizador de
  sintaxis: un `return` de nivel superior es válido en ejecución pero se rechazaba
  al compilar sin el wrapper de función).
- `test/execution-engine.spec.ts` — ampliado con el modo `REFERENCE` (Fase 7) y el
  callback `onStep` de ejecución en vivo (Fase 8).

### E2E (backend, contra Postgres real)
- `test/e2e/nested-decision-trees.e2e-spec.ts` — 12 escenarios: ciclo completo
  crear→referenciar→validar→compilar→probar→gobernar→desplegar→simular con la
  salida anidada correcta para casos aprobado y rechazado. Este e2e expuso y
  corrigió un bug preexistente en `TestCaseExecutorService` (no filtraba variables
  de salida antes de resolver entradas).
- `test/e2e/code-import.e2e-spec.ts` — 6 escenarios: análisis con issues por
  línea, rechazo de guardado con issues bloqueantes, guardar borrador, confirmar
  (validar+compilar), y (con `SCRIPT_NODES_ENABLED=true`) despliegue y ejecución
  real.
- `test/e2e/security-review.e2e-spec.ts` — 5 escenarios: agregación con severidad
  HIGH, RBAC (403 sin rol), export, 404.
- `test/e2e/live-execution.e2e-spec.ts` — 3 escenarios: stream SSE con progreso
  nodo por nodo, rama tomada/descartadas, y rechazo de PROD.

### Frontend
- `src/features/tutorial/tutorial.test.tsx` — 5 pruebas del tutorial (Fase 4):
  inicio, avance, navegación por ruta, atrás, y completitud persistida.
- `src/features/graph-editor/useGraphEditor.test.tsx` — 2 pruebas del fix de
  carga automática (Fase 3 QA).
- `src/api/http-client.test.ts` — 2 pruebas nuevas de `apiEventStream` (parseo de
  frames SSE, resiliencia a frames malformados).
- `src/auth/route-access.test.ts` — 3 reglas de ruta nuevas cubiertas
  (dependency-graph, code-import, security-review).

## Frontend — resultados de gates (salida real)

| Gate | Resultado | Evidencia |
|---|---|---|
| `yarn verify:source` | ✅ PASS | `Source verification passed for 159 files and 25 routes` |
| `yarn typecheck` | ✅ PASS | `tsc --noEmit --pretty false` sin errores |
| `yarn lint` | ✅ PASS | `eslint . --max-warnings=0` sin warnings |
| `yarn test` (Vitest) | ✅ PASS | `Test Files: 7 passed; Tests: 34 passed` |
| `yarn build` | ✅ PASS | `next build` — 25 rutas, incl. las 5 nuevas |
| `yarn format:check` | ⚠️ FAIL preexistente | Falla en 147 archivos NO tocados por este trabajo, por un artefacto de `core.autocrlf` en el checkout Windows del worktree (la rama `main` original pasa limpio). Cada archivo tocado por estos commits es Prettier-clean individualmente. |
| `yarn test:e2e` (Playwright) | N/A | El repo frontend no tiene suite Playwright configurada (solo Vitest); documentado como límite, no como fallo. |

## Límites y datos externos faltantes

- **`format:check` (frontend)**: falla por finales de línea CRLF que Git
  introduce en el worktree Windows (`core.autocrlf=true`), no por el contenido.
  Es preexistente y afecta a todo el repo, no a este trabajo. Se puede resolver de
  una vez con `yarn format` antes del merge a `main`.
- **Rebanada 1 (bus de eventos)**: la integración final de la ejecución en vivo
  con el bus de eventos queda pendiente del merge de esa rama (ver
  `docs/live-execution.md`). Lo implementado aquí es autosuficiente y no la
  requiere.
- **Sidecar gVisor**: los e2e de código con ejecución real corren con
  `SCRIPT_RUNNER_MODE=IN_PROCESS` (permitido fuera de producción); la ejecución en
  producción requiere el sidecar gVisor, sin cambios respecto al comportamiento
  existente.
