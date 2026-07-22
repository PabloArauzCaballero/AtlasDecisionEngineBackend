# Trazabilidad de skills y reglas — Claude Code

**Fecha:** 2026-07-21
**Fuente:** `CLAUDE_ORGANIZAR_SKILLS_BACKEND.md`, Fase 6-7.

## Reglas (`.claude/rules/`)

| Regla | Tema | Deriva de (evidencia) |
|---|---|---|
| `00-governance.md` | Precedencia, evidencia, destructivo | Brief §3, `CLAUDE.md` |
| `10-backend-architecture.md` | NestJS, sin ciclos de módulos | `src/modules/**`, `src/app.module.ts` |
| `20-clean-code.md` | Cohesión, sin duplicación | Convenciones del repo |
| `30-security.md` | RBAC, RLS, sandbox, auditoría | `src/common/security/**`, migración RLS, `SECURITY.md` |
| `40-observability.md` | Logs/métricas/OTel | `src/common/observability/**` |
| `50-performance.md` | Paginación/keyset, tx | `common/http/pagination`, `runtime.service.ts` |
| `60-testing.md` | Jest unit+e2e reales | `jest.config.js`, `test/e2e/**` |
| `70-library-selection.md` | Yarn, sin majors | `package.json`, `yarn.lock` |
| `80-database.md` | Prisma/Postgres, migraciones | `prisma/**`, `src/common/prisma/**` |
| `90-documentation.md` | Docs + OpenAPI | `docs/**`, `src/main.ts` (Swagger) |

## Skills (`.claude/skills/`)

| Skill | Procedimiento que codifica | Ejercido en este trabajo |
|---|---|---|
| `production-verification` | Correr y evidenciar todos los gates contra infra aislada | Toda la verificación de Rebanadas 2-5 (ver `testing-report.md`) |
| `security-audit` | Revisión de RBAC/RLS/sandbox/auditoría/secretos | Vista de seguridad (Fase 10), RLS de tablas nuevas, sandbox de Código→Flow |
| `backend-hardening` | Auditoría por fases del backend | Marco de la revisión integral pre-release |

## Skills consideradas y NO creadas (y por qué)

- `backend-production`, `observability-audit`, `performance-audit`,
  `library-selection`, `clean-code-review`: sus contenidos ya están cubiertos por
  las **reglas** correspondientes (`10/40/50/70/20`), que se cargan por ruta sin
  el costo de una skill completa. Crear una skill por cada una duplicaría
  contexto sin valor incremental (principio §3.2/§3.4 del brief: instalación
  mínima, control de contexto). Se pueden promover a skill si un procedimiento
  crece lo suficiente para justificarlo.

## Agentes

No se creó ningún agente en `.claude/agents/`: para el alcance actual, las skills
son suficientes (§8 del brief: "No crees un agente si una skill es suficiente").
