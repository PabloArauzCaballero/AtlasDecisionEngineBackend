# Matriz de selección de plugins — Claude Code

**Fecha:** 2026-07-21
**Fuente:** `CLAUDE_ORGANIZAR_SKILLS_BACKEND.md`, Fase 2-3.

## Límite importante (por qué esto es recomendación, no instalación)

El catálogo `claude_backend_skills_recomendadas.json` **no existe** en el
repositorio, y la instalación real de plugins requiere:
- consultar el marketplace (`/plugin marketplace`, `claude plugin list --available`),
- potencialmente autenticación OAuth / tokens para MCP externos.

Ambas cosas son **puntos de parada explícitos** tanto del brief de organización
(§3.5, §7 "Debes detenerte antes de: iniciar OAuth… instalar un servicio con
privilegios elevados") como de las reglas de este trabajo. Por eso esta matriz es
un **análisis de idoneidad por stack real**; la instalación queda pendiente de
aprobación del usuario en una sesión interactiva de Claude Code.

## Matriz (candidatos del brief evaluados contra el stack real)

Leyenda de decisión: **Instalar** (recomendado, aporta valor claro) ·
**Evaluar** (útil pero requiere confirmar disponibilidad/valor) ·
**Descartar** (no aplica al stack).

| Plugin | Categoría | Aplica al stack | Scope sugerido | Requisitos / riesgos | Decisión | Justificación |
|---|---|---|---|---|---|---|
| `typescript-lsp` | Navegación/tipos | Sí (TS 5.8) | user | Binario `typescript-language-server` global; verificar antes | **Instalar** | Todo el backend es TS; navegación/tipos precisa reduce errores |
| `security-guidance` | Seguridad | Sí | project | Ninguno externo | **Instalar** | El repo es crédito/riesgo/fraude; guía de seguridad aplica directamente |
| `context7` | Docs de librerías | Sí | user | Red para fetch de docs | **Evaluar** | Útil para NestJS/Prisma/zod; confirmar disponibilidad |
| `postman` | Pruebas de API | Sí (OpenAPI) | project | Cuenta/colección Postman | **Evaluar** | Hay OpenAPI real; requiere cuenta → aprobación |
| `playwright` | E2E navegador | **No (backend)** | — | Navegadores | **Descartar** | El backend no tiene UI; e2e es Jest+supertest, no navegador |
| `github` | PRs/issues | Sí | user | Token GitHub (OAuth) | **Evaluar** | Hay CI en GitHub Actions; requiere OAuth → aprobación |
| `code-simplifier` | Clean code | Sí | user | Ninguno | **Evaluar** | Solapa parcialmente con `/simplify` nativo; evaluar valor incremental |
| `semgrep` | SAST | Sí | project | Binario/servicio semgrep | **Evaluar** | Un único SAST principal; confirmar antes de instalar `aikido` en paralelo |
| `aikido` | SAST | Sí | — | Cuenta | **Descartar** (si se elige semgrep) | No instalar dos SAST sin estrategia de dedup |
| `sentry` / `datadog` / `grafana-*` | Observabilidad | Parcial | project | Cuenta + token de la plataforma real | **Evaluar (una sola)** | El repo usa OTel + Prometheus + pino; elegir la integración que corresponda a la plataforma real desplegada, no varias |
| `neon` | Postgres serverless | **No** | — | Cuenta Neon | **Descartar** | Postgres es local/Docker + `@prisma/adapter-pg`, no Neon |
| `redis-development` | Redis | Sí (ioredis) | local | Redis local | **Evaluar** | Redis sí está en el stack; valor si se depura cache/colas |
| `terraform` / `aws-dev-toolkit` | IaC cloud | **No detectado** | — | Cuentas cloud | **Descartar** | No hay IaC Terraform ni AWS en el repo (Docker + k8s manifests) |
| `42crunch-api-security-testing` | Seguridad API | Sí (OpenAPI) | project | Cuenta | **Evaluar** | Complementa security-guidance sobre el contrato OpenAPI; requiere cuenta |
| `pr-review-toolkit` | Revisión | Sí | user | Token GitHub | **Evaluar** | Solapa con `/code-review` nativo; evaluar valor incremental |

## Recomendación mínima priorizada

Para este stack (NestJS + Prisma + Postgres + Redis + Jest + OpenAPI, sin UI web
ni cloud IaC), el conjunto **mínimo y sin solapamiento** sería:

1. `typescript-lsp` (scope user) — tras verificar `typescript-language-server --version`.
2. `security-guidance` (scope project).
3. **Un** SAST: `semgrep` (scope project).
4. **Una** integración de observabilidad, la que corresponda a la plataforma real
   desplegada (no varias).

Todo lo demás: **Evaluar** en sesión interactiva o **Descartar** según se detalla.

## Acciones que requieren aprobación humana (no ejecutadas)

- Cualquier `claude plugin install …` (marketplace).
- Cualquier integración con OAuth/token (github, postman, sentry/datadog, 42crunch).
- Instalación global de `typescript-language-server` (si la política del equipo
  prohíbe globales, documentar alternativa local en `package.json` devDeps).
