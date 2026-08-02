# Verificación integral — todas las rebanadas

> **Documento histórico (2026-07-24).** Conserva evidencia reproducible de esa revisión. Para
> decisiones actuales use el reporte fechado más reciente y vuelva a ejecutar los gates.

**Fecha:** 2026-07-24
**Alcance:** `AtlasDecisionEngine` (backend) + `AtlasDecisionEngineFrontend`,
con las cinco rebanadas del plan de mejora ya implementadas.

## Entorno

Base de datos de desarrollo local (PostgreSQL en `localhost:55432`, rol de
aplicación `atlas_app` con RLS activo). **Desviación del procedimiento de
`production-verification`:** ese skill pide infraestructura Docker aislada y
desechable; aquí se usó la base local de desarrollo del propio equipo porque el
disco solo tenía ~1,4 GB libres al iniciar y levantar contenedores nuevos era
inviable. No es una base compartida con otra sesión. La consecuencia observable
está documentada abajo (contaminación de datos por las corridas E2E).

## Backend — gates (salida real)

| Gate | Resultado | Evidencia |
|---|---|---|
| `prisma validate` | ✅ PASS | `The schema at prisma\schema.prisma is valid 🚀` |
| `prisma migrate status` / `deploy` | ✅ PASS | `Database schema is up to date!` tras aplicar `20260724100000_tutorial_progress_rls` |
| `typecheck` | ✅ PASS | `tsc --noEmit` sin errores (re-verificado después del reformateo) |
| `build` | ✅ PASS | `nest build` sin errores |
| `format:check` | ✅ PASS | `All matched files use Prettier code style!` (estaba en rojo, ver hallazgo 4) |
| `test` (unit + integración) | ✅ PASS | `Test Suites: 58 passed; Tests: 2 skipped, 381 passed, 383 total` |
| `test:e2e` | ✅ PASS | `Test Suites: 11 passed; Tests: 57 passed, 57 total` |
| `smoke` | ✅ PASS | `5/5 passed` contra instancia viva en `:3010` |
| OpenAPI | ✅ PASS | 78 paths; endpoints de las 5 rebanadas presentes |

Cobertura OpenAPI por rebanada: notificaciones (4 rutas), code-imports (5),
referencias anidadas + grafo de dependencias (3), live-executions (1),
security-review (2), tutorial-progress (2).

## Frontend — gates (salida real)

| Gate | Resultado | Evidencia |
|---|---|---|
| `format:check` | ✅ PASS | sin diferencias |
| `lint` | ✅ PASS | `eslint . --max-warnings=0` limpio |
| `verify:source` | ✅ PASS | `Source verification passed for 225 files and 26 routes.` |
| `typecheck` | ✅ PASS | `tsc --noEmit` sin errores |
| `test` (Vitest) | ✅ PASS | `Test Files 28 passed; Tests 125 passed` |
| `build` | ✅ PASS | `✓ Compiled successfully in 38.4s` |

## Hallazgos corregidos en esta verificación

1. **`user_tutorial_progress` sin RLS.** La tabla es tenant-scoped pero su
   migración no aplicó la política de aislamiento que llevan todas las demás
   (`rowsecurity = false` confirmado en `pg_tables`). Era la única tabla
   tenant-scoped desprotegida, y el aislamiento vale lo que su tabla más débil.
   Corregido con `20260724100000_tutorial_progress_rls`, verificado en la base
   (`rowsecurity = true`, 1 política).

2. **Tres suites E2E rotas (20 tests) por el listado de variables aplanado.**
   `GET /v1/variables` se aplanó para la tabla del catálogo del frontend y dejó
   de anidar `versions[]`; los specs seguían leyendo `versions[0].id` y morían
   con `Cannot read properties of undefined`. Además, al crecer el catálogo
   sembrado a ~285 variables, la coincidencia exacta se salía de la primera
   página de búsqueda. Ambas causas se resuelven en un helper compartido,
   `test/e2e/support/seeded-variables.ts`, que pagina hasta el código exacto y
   resuelve el id de versión por el endpoint de detalle.

3. **Smoke frágil ante datos residuales.** El escenario "artifact catalog"
   asumía que el artefacto semilla estaba en la primera página. Las corridas
   E2E dejan artefactos `E2E_*` en el tenant 1 (63 de 65 al momento de medir),
   que lo desplazaban. Ahora filtra por código: comprueba que el catálogo
   *sirve* el artefacto, no que esté en la página 1.

4. **`format:check` en rojo (gate de CI).** 26 archivos incumplían Prettier. CI
   lo ejecuta (`.github/workflows/ci.yml`), así que estaba bloqueando el
   pipeline. Reformateados; `typecheck` y `test` re-ejecutados después para
   confirmar que el cambio fue solo de estilo.

## Cobertura de pruebas añadida

- `test/e2e/notifications.e2e-spec.ts` — faltaba el E2E de la Rebanada 1,
  mientras las demás sí lo tenían. Ejercita la cadena completa sin tocar el
  outbox a mano: `submit-for-review` → evento en la misma transacción → relay →
  projector → bandeja; verifica el direccionamiento por rol, que otro rol no ve
  la notificación, el marcado idempotente y `read-all`.

## Documentación

- `docs/tutorials.md` — nuevo; era la única feature sin doc de dominio.

## Límites conocidos

- **E2E del frontend (Playwright) no ejecutados.** Requieren levantar portal +
  proveedor de identidad; no se orquestó en esta sesión. Todo lo demás del
  `yarn verify` del frontend sí corrió.
- La base de desarrollo acumula artefactos `E2E_*` de cada corrida. No afecta
  correctitud (los specs usan códigos únicos por corrida), pero conviene
  reciclarla periódicamente.
