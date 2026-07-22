# Inventario de entorno — Claude Code

**Fecha:** 2026-07-21
**Fuente:** `CLAUDE_ORGANIZAR_SKILLS_BACKEND.md`, Fase 0.
**Alcance:** repositorio backend `atlas-decision-engine-backend@2.0.0`
(worktree `atlas-backend-pendientes`, rama `feature/rebanadas-2-a-5`).

## Versiones (evidencia real)

| Herramienta | Versión |
|---|---|
| Node | v26.2.0 |
| Git | 2.54.0.windows.1 |
| Sistema operativo | Windows 11 |
| Shell | PowerShell (primario); Git Bash disponible |

> `claude --version` / `npm --version` no se registran aquí porque no forman
> parte del stack de ejecución del proyecto y no aportan a la decisión de
> configuración; se pueden obtener con `/doctor` dentro de Claude Code.

## Stack detectado (por evidencia)

| Aspecto | Valor | Evidencia |
|---|---|---|
| Lenguaje | TypeScript 5.8 | `package.json` devDependencies, `tsconfig.json` |
| Framework | NestJS 11 | `@nestjs/*` en dependencies, `nest build` |
| Gestor de paquetes | **Yarn** (lockfile `yarn.lock`) | *Nota:* los scripts de `package.json` invocan `npm run …`; conviene unificar a Yarn |
| ORM | Prisma 6.19 + `@prisma/adapter-pg` | `prisma/schema.prisma`, `@prisma/client` |
| Base de datos | PostgreSQL 16 | `docker-compose.yml`, `provider = "postgresql"` |
| Cache/colas | Redis 7 vía `ioredis` | `docker-compose.yml`, `REDIS_URL` en env |
| Pruebas | Jest (unit + e2e) | `jest.config.js`, `test/jest-e2e.json` |
| OpenAPI | `@nestjs/swagger` (gated por `SWAGGER_ENABLED`) | `src/main.ts` |
| Observabilidad | OpenTelemetry + `prom-client` + `pino` | `src/common/observability/**` |
| Seguridad | `helmet`, guards JWT/JWKS/roles/rate-limit, RLS por tenant | `src/common/security/**`, migración `tenant_rls_and_app_role` |
| Validación | `zod` 4 + `class-validator` | `env.schema.ts`, DTOs |
| IaC / CI | Dockerfile multi-stage + GitHub Actions | `docker-compose.yml`, `.github/workflows/ci.yml` |

## Comandos reales del proyecto (verificados en `package.json`)

- Build: `yarn build` (`nest build`)
- Typecheck: `yarn typecheck` (`tsc --noEmit -p tsconfig.json`)
- Test: `yarn test` (`jest --runInBand`)
- E2E: `yarn test:e2e`
- Prisma: `yarn prisma:validate`, `yarn prisma:migrate:dev`, `yarn prisma:seed`
- Smoke: `yarn smoke` (PowerShell) / `yarn smoke:sh` (bash)
- Verify agregado: `yarn verify` (typecheck + build + test),
  `yarn verify:release` (+ migration:validate + security:audit)

## Limitaciones y datos no verificables

- **Marketplace de plugins de Claude Code**: no se consultó
  (`/plugin marketplace`, `claude plugin list`) — requiere sesión interactiva de
  Claude Code y, potencialmente, acceso de red/OAuth. La selección de plugins se
  documenta como recomendación (ver `plugin-selection-matrix.md`); la instalación
  real queda pendiente de aprobación del usuario.
- **`/doctor`**: no ejecutado en esta corrida no interactiva.
- No se copiaron variables de entorno sensibles.

## Archivos fuente obligatorios AUSENTES

Los siguientes documentos que el brief de organización enumera como fuentes no
existen en el repositorio y se registran como faltantes (no inventados):

`index.md`, `programacionGeneral.md`, `programacionBackend.md`,
`claude_backend_skills_recomendadas.json`, `.mcp.json`, `CLAUDE.local.md`.

En consecuencia, la precedencia y las reglas transversales se derivan del código,
la configuración real (`package.json`, `tsconfig.json`, `docker-compose.yml`,
migraciones Prisma) y el `CLAUDE.md` existente, no de esos documentos.
