# Guía de uso — Claude Code en Atlas Decision Engine (backend)

**Fecha:** 2026-07-21

## Cómo trabaja Claude Code aquí

1. **Graphify primero** para preguntas sobre el código: `graphify query "..."`,
   `graphify path "A" "B"`, `graphify explain "concepto"` (regla conservada del
   `CLAUDE.md` raíz). Tras modificar código, `graphify update .`.
2. **Reglas automáticas** (`.claude/rules/`): se aplican según el tema y la ruta
   del archivo que se edita (frontmatter `paths`). No hay que invocarlas.
3. **Skills bajo demanda** (`.claude/skills/`): invócalas por nombre cuando la
   tarea lo amerite:
   - `production-verification` — antes de declarar que algo funciona o de un release.
   - `security-audit` — al añadir endpoints/tablas/ejecución de código.
   - `backend-hardening` — revisión integral pre-producción.

## Comandos reales del proyecto (verificados)

```
yarn typecheck            # tsc --noEmit
yarn build                # nest build
yarn test                 # jest unit + integración
yarn test:e2e             # e2e contra Postgres/Redis reales
yarn prisma:validate
yarn prisma:migrate:dev
yarn prisma:seed
yarn smoke                # PowerShell  (yarn smoke:sh para bash)
yarn verify               # typecheck + build + test
```

Gestor de paquetes: **Yarn**. (Los scripts internos aún invocan `npm run`; no
mezcles gestores al añadir dependencias.)

## Reglas críticas que Claude respeta siempre

- No declarar `PASS` sin salida real de un gate.
- No acciones destructivas sin aprobación (`git push`, `prisma migrate reset`,
  tocar producción, secretos, OAuth).
- RBAC real en backend, RLS por tenant en tablas nuevas, ejecución de código
  aislada.
- Cambios aditivos y compatibles; conservar el stack.

## Dónde está cada cosa

- Reglas: `.claude/rules/` · Skills: `.claude/skills/` · README: `.claude/README.md`
- Docs de organización: `docs/claude/`
- Docs de features (Rebanadas 2-5): `docs/nested-decision-trees.md`,
  `docs/code-to-flow-specification.md`, `docs/security-review.md`,
  `docs/live-execution.md`, `docs/flowchart-user-guide.md`,
  `docs/testing-report.md`, `docs/final-implementation-report.md`.

## Pendiente

- Instalación de plugins: ver `docs/claude/installation-report.md` (requiere
  aprobación del usuario).
- Un `validation-report.md` con la corrida de gates post-instalación de plugins
  se generará cuando esos plugins se instalen.
