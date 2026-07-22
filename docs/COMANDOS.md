# Comandos de desarrollo (yarn)

El proyecto usa **yarn 1.x**. Toda operación repetible vive como script en `package.json`,
así que es rastreable (`git blame`, diffs) y se ejecuta igual en local y en CI. Ejecuta
cualquiera con `yarn <comando>`.

> El lockfile es `yarn.lock`. No uses `npm` — no hay `package-lock.json` y `npm ci` fallará.

## Instalación

| Comando | Qué hace |
|---|---|
| `yarn install --frozen-lockfile` | Instala exactamente lo que fija `yarn.lock` (lo que usa CI). |
| `yarn install` | Instalación normal de desarrollo. |

## Calidad y verificación

| Comando | Qué hace | ¿Necesita DB? |
|---|---|---|
| `yarn check` | Chequeo local rápido: `format:check` + `typecheck`. Ideal antes de commit. | No |
| `yarn typecheck` | `tsc --noEmit`, sin emitir artefactos. | No |
| `yarn format` | Aplica Prettier sobre `src`, `test`, `prisma`. | No |
| `yarn format:check` | Falla si algo no está formateado (lo que valida CI). | No |
| `yarn build` | Compila con `nest build`. | No |
| `yarn security:audit` | `yarn audit` de dependencias de producción, umbral **high**. | No |
| `yarn verify` | Puerta local: `typecheck` → `build` → `test`. | Sí (`test`) |
| `yarn verify:release` | Puerta de release: verify + `migration:validate` + `security:audit`. | Sí |
| `yarn production:config:check` | Valida el esquema de env productivo contra `process.env` (requiere `build` previo). | No |

## Pruebas

| Comando | Qué hace | ¿Necesita DB? |
|---|---|---|
| `yarn test:unit` | Solo suites sin base de datos (excluye `*.integration.spec.ts`). Bucle rápido. | No |
| `yarn test:integration` | Solo las suites `*.integration.spec.ts` (contra Postgres real). | Sí |
| `yarn test` | Todas las suites. | Sí |
| `yarn test:cov` | Todas las suites con reporte de cobertura. | Sí |
| `yarn test:e2e` | Suite end-to-end (`test/jest-e2e.json`). | Sí |
| `yarn test:watch` | Jest en modo watch. | Depende |

Convención: una suite que toca la base de datos se nombra `*.integration.spec.ts`. Así
`test:unit` corre sin Postgres/Redis y `test:integration` los aísla.

## Base de datos (Prisma)

| Comando | Qué hace |
|---|---|
| `yarn prisma:generate` | Genera el cliente Prisma. |
| `yarn prisma:validate` | Valida el `schema.prisma`. |
| `yarn prisma:migrate` | `migrate deploy` (aplica migraciones; producción/CI). |
| `yarn prisma:migrate:dev` | `migrate dev` (crea/aplica en desarrollo). |
| `yarn prisma:seed` | Ejecuta el seed idempotente. |
| `yarn migration:validate` | Chequeo de deriva de migraciones (`scripts/validate-migrations.py`). |
| `yarn db:reset` | **Destructivo:** resetea la base y reaplica todo. |

## Aplicación

| Comando | Qué hace |
|---|---|
| `yarn start:dev` | Nest en modo watch. |
| `yarn start:debug` | Igual, con debugger. |
| `yarn start` | Ejecuta `dist/main.js` (requiere `build` previo). |
| `yarn smoke` / `yarn smoke:sh` | Prueba de humo contra una API en marcha (PowerShell / bash). |

## Otros

| Comando | Qué hace |
|---|---|
| `yarn graph:update` | Refresca el grafo de conocimiento (`graphify update .`). Correr tras cambios de código. |

## Equivalencias npm → yarn (referencia)

| Antes (npm) | Ahora (yarn) |
|---|---|
| `npm ci` | `yarn install --frozen-lockfile` |
| `npm install <pkg>` | `yarn add <pkg>` |
| `npm install -D <pkg>` | `yarn add -D <pkg>` |
| `npm run <script>` | `yarn <script>` |
| `npm audit --omit=dev --audit-level=high` | `yarn audit --level high --groups dependencies` |
