# Auditoría de seguridad y calidad — 2026-07-12

Auditoría dirigida sobre las áreas de mayor riesgo: CLI de Prisma/migraciones, autenticación,
autorización, rate limiting, cadena de auditoría, idempotencia runtime, criptografía y DTOs de
escritura del grafo. Cada hallazgo indica severidad, evidencia y el fix aplicado.

## P0 — `prisma migrate deploy` / `prisma db seed` fallan siempre (motor wasm)

**Archivo:** `prisma.config.ts`.

`experimental: { adapter: true }` + `engine: 'js'` + el callback `adapter` hacían que el CLI de
Prisma (no el cliente en runtime, que usa su propio `PrismaPg` en `PrismaService`) enrutara
`migrate deploy` a través del schema-engine WASM basado en driver adapters. Ese motor falla de
forma determinística contra PostgreSQL 16 con:

```
Error: Column type 'name' could not be deserialized from the database.
  at sql_schema_connector::sql_migration_persistence::initialize
  at schema_engine_wasm::wasm::engine::ApplyMigrations
```

Se reprodujo en limpio (contenedor Postgres recién creado, con y sin `_prisma_migrations` previo,
en Prisma 6.12.0 y 6.19.3): el fallo ocurre en la inicialización de la tabla de bookkeeping antes
de aplicar ninguna migración, es decir, en **toda** invocación de `migrate deploy`. Como el
contenedor `migrator` de `Dockerfile`/`docker-compose.yml` y el Job de Kubernetes ejecutan
exactamente ese comando, esto rompe el despliegue de esquema en cualquier entorno — el release
candidate no podía aprovisionar una base de datos nueva.

**Fix aplicado:** se quitó el enrutamiento experimental por driver adapter del *CLI* (el cliente
en runtime no se toca — sigue usando `@prisma/adapter-pg` directamente en `PrismaService`).
`prisma.config.ts` vuelve al schema-engine clásico, que conecta directo con `DATABASE_URL` y no
tiene el bug. Como Prisma deja de auto-cargar `.env` en cuanto detecta un `prisma.config.ts`, se
añadió una carga explícita con `process.loadEnvFile('.env')` (API nativa de Node, sin dependencia
nueva) para no perder la ergonomía de desarrollo local.

**Verificación:** `yarn prisma:migrate`, `yarn prisma:validate` y `yarn prisma:seed`
corridos contra Postgres 16 real (docker compose) — los tres en verde.

## P1 — Sin rate limiting en intentos de autenticación fallidos

**Archivos:** `src/common/security/security.module.ts`, `src/common/security/authentication.guard.ts`.

Los `APP_GUARD` se registran en orden `AuthenticationGuard → RolesGuard → RateLimitGuard`. Nest
corta la cadena de guards en el primero que lanza o devuelve `false`. Como resultado, **ninguna
credencial inválida llega nunca a `RateLimitGuard`**: un API key o bearer token incorrecto siempre
lanza 401 desde `AuthenticationGuard` antes de que el rate limiter se ejecute. Esto deja sin
límite los intentos de fuerza bruta / credential stuffing contra `x-api-key` y `Authorization`,
aunque `HashService.equals` use comparación en tiempo constante para el valor correcto.

**Fix aplicado:** `AuthenticationGuard` ahora consume una ventana fija por IP de origen
(`CacheService.consumeFixedWindow`, ya usada por `RateLimitGuard`, atómica vía Lua en Redis) antes
de validar credenciales, con un límite configurable (`AUTH_FAILURE_RATE_LIMIT`, default 20/60s) y
lanza `429 AUTH_RATE_LIMIT_EXCEEDED` cuando se excede — igual que hace `RateLimitGuard` para rutas
autenticadas.

## P1 — DTOs del grafo sin cota superior de tamaño

**Archivo:** `src/modules/artifacts/artifact.dto.ts` (`ReplaceGraphDto` y arrays anidados).

`nodes`, `edges`, `conditions`, `actions` y `dependencies` solo tenían `@IsArray()` (más
`@ArrayMinSize(1)` en `nodes`), sin `@ArrayMaxSize`. El límite global `BODY_LIMIT_BYTES` (1 MB por
defecto) no acota bien la cantidad de elementos: un payload compacto puede codificar miles de
nodos/aristas dentro de 1 MB. `GraphValidatorService` recorre esas estructuras con
`Array.prototype.filter` dentro de bucles (`reachableFrom`, `findCycle`, `countTerminalPaths`) y
`findCycle` usa recursión no acotada por profundidad — un grafo autenticado pero adversarial
(muchos nodos encadenados) puede causar uso excesivo de CPU o un stack overflow durante
`validate`/`replaceDraftGraph`.

**Fix aplicado:** se añadieron `@ArrayMaxSize` a los arrays de `ReplaceGraphDto` (500 nodos, 2000
aristas, 500 condiciones/acciones, 200 dependencias) como defensa en profundidad — valores muy por
encima de cualquier grafo de decisión real, pero que acotan el costo computacional máximo.

## P0 — El checksum del grafo nunca coincide entre `validate` y `compile`

**Archivo:** `src/modules/graph/graph-validator.service.ts` (`canonicalSnapshot`).

Descubierto por la suite Supertest e2e nueva (`test/e2e/artifact-lifecycle.e2e-spec.ts`), que es
la primera prueba de este repositorio en ejercitar el flujo real `PUT graph → validate → compile`
sobre una base de datos real; los specs unitarios prueban `GraphValidatorService` de forma aislada
y el seed escribe artefactos ya compilados directamente por Prisma, así que ninguno de los dos
pasaba antes por este camino.

`ArtifactGraphReaderService.loadSnapshot` incluye `version.status` y `version.checksum` —el estado
y checksum **actualmente almacenados** en la fila— dentro del snapshot que
`GraphValidatorService` hashea para producir el *siguiente* checksum. Como `validate()` cambia
ambos campos como efecto secundario (`DRAFT → VALIDATED`, guarda el checksum calculado), la
segunda vez que se carga el snapshot —dentro de `compile()`— esos dos campos ya cambiaron,
así que el checksum recalculado nunca coincide con el guardado. Resultado: **cualquier versión,
al pasar por el flujo HTTP real `validate` → `compile`, fallaba siempre con
`409 CHECKSUM_MISMATCH`**, bloqueando por completo la publicación de artefactos nuevos.

**Fix aplicado:** `canonicalSnapshot()` neutraliza `status` y `checksum` antes de hashear —son
metadatos de flujo de trabajo derivados del grafo, no parte de su estructura— dejando el checksum
como función pura del contenido real (dependencias, condiciones, acciones, nodos, aristas).
Verificado en verde con el flujo completo `create → graph → validate → compile → test-suite → run
→ submit-for-review → approve ×2 → deploy`, corrido dos veces consecutivas sin fallos.

## P2 — Lógica de plantillas `{{path}}` duplicada

**Archivos:** `src/modules/graph/execution-engine.service.ts` (`renderTemplate`) y
`src/modules/graph/graph-validator.service.ts` (`validateTemplateReferences`).

Ambos archivos reimplementan el mismo patrón de referencia `{{ variables.codigo }}` con una regex
casi idéntica (`/\{\{\s*([\w.]+)\s*\}\}/g`) y la misma lógica para pelar el prefijo `variables.`/
`decision.`. Es la causa directa de que `execution-engine.service.ts` superara las 300 líneas.

**Fix aplicado:** se extrajo un módulo compartido `src/modules/graph/template-reference.ts` con el
patrón y las funciones `renderTemplate` y `extractTemplateVariableCodes`, reutilizado por ambos
servicios. Sin cambio de comportamiento (specs existentes en verde).

## P2 — God classes (>300 líneas, responsabilidades mezcladas)

Ver detalle de la separación en cada módulo; comportamiento preservado y cubierto por los specs
existentes más los nuevos e2e de la Fase 3.

| Archivo original | Líneas | Split |
|---|---|---|
| `modules/artifacts/artifact-graph.service.ts` | 391 | `artifact-graph-writer.service.ts` (transacción de reemplazo) + `artifact-graph-reader.service.ts` (snapshot/mapeo) |
| `modules/graph/graph-validator.service.ts` | 382 | Orquestador delgado + `validators/graph-structure.validator.ts`, `validators/graph-expression.validator.ts`, `validators/graph-determinism.validator.ts` |
| `modules/testing/testing.service.ts` | 364 | `test-suite.service.ts` (CRUD suites/casos) + `test-execution.service.ts` (correr suite, assertions, cobertura) |
| `modules/graph/execution-engine.service.ts` | 319 | Se resolvió extrayendo `template-reference.ts` (ver P2 anterior); no requirió split adicional — el resto es un único intérprete cohesivo |

`artifact.service.ts` (298) y `deployment.service.ts` (294) se revisaron: cada uno agrupa
únicamente el ciclo de vida de una sola entidad (artefacto/versión y deployment respectivamente)
sin mezclar responsabilidades — no se dividen solo por estar cerca del límite de 300 líneas.

## Hallazgos revisados sin acción (falsos positivos / severidad no justificada)

- `RateLimitGuard` (`if (!principal) return true`): código defensivo inalcanzable en la práctica —
  `AuthenticationGuard` siempre define `request.principal` o lanza antes de llegar aquí para rutas
  no públicas.
- `JwtVerifierService`: no filtra JWKS por `use: 'sig'` (solo por `kty: 'RSA'`); es una desviación
  menor de buenas prácticas, no explotable, porque son las claves publicadas por el propio IdP
  configurado.
- `CacheService`: el fallback en memoria (`memory`/`counters` Map) no expira proactivamente claves
  no accedidas; irrelevante porque `REQUIRE_REDIS_IN_PRODUCTION` bloquea ese fallback en producción.
- Falta de `package-lock.json` en el repositorio: causó una resolución de dependencias no
  determinista durante esta auditoría (ver P0). Se generó y se deja versionado.
