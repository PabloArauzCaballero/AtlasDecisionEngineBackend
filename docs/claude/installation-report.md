# Reporte de instalación — Claude Code

**Fecha:** 2026-07-21
**Fuente:** `CLAUDE_ORGANIZAR_SKILLS_BACKEND.md`, Fase 3.

## Lo que SÍ se aplicó (no destructivo, sin aprobación externa)

- Estructura `.claude/rules/` con 10 reglas modulares tuneadas al stack real.
- Estructura `.claude/skills/` con 3 skills (`production-verification`,
  `security-audit`, `backend-hardening`).
- `.claude/README.md` que documenta la estructura.
- Deliverables de `docs/claude/`: inventory, configuration-audit,
  plugin-selection-matrix, skills-traceability, este reporte, usage-guide.
- **Se conservó sin modificar** la configuración de graphify (`CLAUDE.md` raíz y
  los hooks de `.claude/settings.json`).

## Lo que NO se instaló (requiere aprobación humana — punto de parada)

Ningún plugin se instaló. La instalación requiere el marketplace de Claude Code
y, para varios candidatos, autenticación OAuth/tokens — puntos de parada
explícitos del brief (§3.5, §7) y de las reglas de este trabajo.

Para instalar el conjunto mínimo recomendado (ver `plugin-selection-matrix.md`),
el usuario, en una sesión interactiva de Claude Code, ejecutaría:

```
# 1. Verificar el marketplace y el LSP de TS
/plugin marketplace update claude-plugins-official
typescript-language-server --version   # o instalar si falta y la política lo permite

# 2. Instalar el conjunto mínimo, con scope explícito
claude plugin install typescript-lsp@claude-plugins-official --scope user
claude plugin install security-guidance@claude-plugins-official --scope project
claude plugin install semgrep@claude-plugins-official --scope project
# + la integración de observabilidad que corresponda a la plataforma real

/reload-plugins
```

Las integraciones con OAuth/token (`github`, `postman`, `sentry`/`datadog`,
`42crunch`) requieren que el usuario complete la autenticación; no deben
compartirse por proyecto sin aprobación (§7 "Regla de scope").

## Descartados (no aplican al stack)

`playwright` (backend sin UI), `neon` (Postgres local/Docker, no Neon),
`terraform`/`aws-dev-toolkit` (no hay IaC Terraform ni AWS), y un segundo SAST
(`aikido`) si se elige `semgrep`. Detalle en `plugin-selection-matrix.md`.

## Estado

Configuración de reglas/skills/docs: **aplicada y commiteada** en la rama
`feature/rebanadas-2-a-5`. Instalación de plugins: **pendiente de aprobación** del
usuario.
