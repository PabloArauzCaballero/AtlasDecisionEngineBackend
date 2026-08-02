# Verificación integral — cierre de pendientes

**Fecha:** 2026-07-30
**Alcance:** `AtlasDecisionEngine` + `AtlasDecisionEngineFrontend`, todas las
rebanadas. Continúa y cierra lo que la revisión del 2026-07-24 dejó abierto o no
llegó a evidenciar realmente, y re-verifica todo tras los cambios acumulados de
otras sesiones (el backend creció a 76 suites de test).

## Resultado: todos los gates en verde con salida real

### Backend

| Gate | Resultado | Evidencia |
|---|---|---|
| `prisma validate` / migraciones | ✅ PASS | `Database schema is up to date!` |
| `typecheck` | ✅ PASS | `tsc --noEmit` sin errores |
| `build` | ✅ PASS | `nest build` sin errores |
| `test` (unit + integración) | ✅ PASS | `Test Suites: 76 passed; Tests: 2 skipped, 599 passed, 601 total` |
| `test:e2e` | ✅ PASS | `Test Suites: 11 passed; Tests: 58 passed, 58 total` |
| `smoke` | ✅ PASS | `5/5 passed` contra instancia viva en `:3010` |
| OpenAPI | ✅ PASS | 95 paths; endpoints de las 5 rebanadas presentes |

### Frontend

| Gate | Resultado | Evidencia |
|---|---|---|
| `format:check` | ✅ PASS | sin diferencias |
| `lint` | ✅ PASS | `eslint . --max-warnings=0` limpio |
| `verify:source` | ✅ PASS | `Source verification passed for 469 files and 26 routes.` |
| `typecheck` | ✅ PASS | `tsc --noEmit` sin errores |
| `test` (Vitest) | ✅ PASS | `Test Files 59 passed; Tests 436 passed` |
| `build` | ✅ PASS | `✓ Compiled successfully` |
| `test:e2e` (Playwright) | ✅ PASS | `17 passed, 6 skipped` en Chromium |

Los 6 Playwright omitidos son `real-backend.spec.ts`, que se auto-salta salvo que
se defina `PW_MANAGEMENT_KEY` con el motor levantado.

## Hallazgos corregidos en esta sesión

1. **Build del frontend roto (regresión).** `InteractiveTutorialOverlay.tsx`
   tenía un comentario JSX `{/* … */}` como primer elemento tras `return (`, sin
   padre — Turbopack fallaba con `Expected ',', got 'ident'`. Bloqueaba `build` y
   dejaba el dev server sirviendo 500 en todas las rutas. Convertido a comentario
   JS antes del `return`. (El error de `TutorialOverlay.tsx` era cascada del mismo
   fallo de parseo.)

2. **`verify:source` en rojo.** `ObjectiveCreateDialog.tsx` superaba el límite de
   299 líneas (302). Extraída la sección de políticas a
   `ObjectivePolicyFields.tsx`; el diálogo quedó en 221 líneas.

3. **E2E `nested-decision-trees` intermitente.** El helper de variables recibía un
   500 esporádico (`Connection terminated due to connection timeout`) cuando el
   pool de pg no entregaba conexión dentro de `DATABASE_CONNECTION_TIMEOUT_MS`
   bajo carga — el mismo call pasaba en las otras 3 suites de la corrida. Es
   contención de infraestructura, no un defecto: se añadió un reintento acotado
   ante 5xx transitorios en `test/e2e/support/seeded-variables.ts` (nunca ante
   4xx / not-found).

## Pendientes de la revisión anterior, ahora cerrados

- **Smoke real 5/5** (antes había quedado en 4/5 por datos residuales; el arreglo
  del escenario "artifact catalog" —filtrar por código— ya estaba aplicado).
- **OpenAPI verificado de verdad** contra la instancia viva (95 paths).
- **Playwright E2E ejecutado** (antes documentado como no corrido). Se sirvió un
  build de producción en un puerto libre y se apuntó Playwright ahí, porque el dev
  server del equipo en `:5173` estaba caído por el error de parseo del punto 1.

## Cierre de `real-backend.spec.ts` contra el motor real

Se levantó el motor real (`node dist/main.js`, `AUTH_MODE=IDENTITY_HYBRID`,
`WORKER_ROLE=API` para que el orquestador de jobs no compita por conexiones) y un
build de producción del portal apuntando su proxy `DECISION_ENGINE_URL` a ese
motor, y se corrió la pasada opt-in con `PW_MANAGEMENT_KEY`.

- **No se usó `docker compose up` para el `api`**: ese servicio depende del sidecar
  `script-runner` con runtime gVisor (`runsc`), que este host Windows no tiene, y
  los cinco escenarios solo navegan vistas y leen datos (no ejecutan scripts). Se
  corrió el mismo binario compilado que ejecutaría el contenedor.

Resultado: **4 de 5 escenarios en verde** contra el motor real (las vistas
renderizan datos reales sin errores de cliente; el panel de inicio resuelve
métricas; el banco de acciones; importar código). Screenshots de evidencia en
`docs/visual-evidence/`.

**Hallazgo (5º) corregido — selección de versión:** el escenario "el editor lee
las variables reales" tomaba la primera versión del selector (`[0]`) y abría su
grafo. En el catálogo sembrado esa primera versión es un demo de contratos **sin
nodos**, así que el editor no tenía nada que pintar y el test agotaba el timeout —
misma fragilidad "primera de la lista" que ya se corrigió para las variables.
Ahora recorre el selector y elige la primera versión con grafo
(`e2e/real-backend.spec.ts`).

**Hallazgo (5º) abierto — reportado, no parcheado.** Con el arreglo anterior el
test abre una versión real con grafo (BNPL: 32 nodos, 87 acciones, 20 condiciones
— confirmado por API y por un arnés de diagnóstico Playwright independiente). Dos
observaciones tras diagnosticarlo a fondo:

1. **El dato es correcto.** `normalizeLoadedGraph` y `history.reset` preservan
   `actions` intactas (`useGraphEditor.ts` / `graph-layout.ts`), así que
   `editor.actions` recibe las 87. El fallo no es de datos ni de carga.
2. **Lo que falla es UI del editor bajo dos presiones concurrentes:** (a) el
   propio `.graph-node` tarda >60 s en renderizar cuando la máquina está saturada
   (builds en paralelo), volviendo el escenario flaky ya en su primer paso; y
   (b) el camino toggle→render de `.action-card` en `ActionCatalogPanel`. Ese
   componente y el resto del editor los está editando **otra sesión en paralelo**
   (durante esta verificación el `dist` del backend llegó a romperse por cambios
   de esa sesión en `code-import`, y hubo notificaciones de cambios en archivos
   del editor/tutorial/objetivos).

Decisión: **no se parchea a ciegas un componente en pleno cambio de otra sesión**
con un repro que además es flaky bajo carga. Se deja localizado para su autor. Es
un escenario **opt-in** (`real-backend.spec.ts` se salta por defecto en CI y en
`yarn verify`), no un gate bloqueante. La mejora de selección de versión sí queda
aplicada porque es correcta con independencia de esto y no toca ningún gate (el
directorio `e2e/` está excluido de `tsc`, `verify:source` y `eslint`).
