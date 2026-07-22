# Auditoría de la configuración actual de Claude Code

**Fecha:** 2026-07-21
**Fuente:** `CLAUDE_ORGANIZAR_SKILLS_BACKEND.md`, Fase 1.

## Inventario previo (antes de organizar)

| Archivo | Estado | Contenido |
|---|---|---|
| `CLAUDE.md` (raíz) | Existe (772 B) | Solo la sección **graphify** (uso del grafo de conocimiento) |
| `.claude/settings.json` | Existe (464 B) | Hooks `PreToolUse` que invocan `graphify hook-guard` en Bash/Read/Glob |
| `.claude/settings.local.json` | Ausente | — |
| `.claude/rules/` | Ausente | — |
| `.claude/skills/` | Ausente | — (las skills de graphify viven en `~/.claude/skills/`, no en el repo) |
| `.claude/agents/` | Ausente | — |
| `.claude/commands/` | Ausente | — |
| `.mcp.json` | Ausente | — |

## Conflictos y duplicaciones

- **Ninguna duplicación** detectada: la única configuración previa (graphify) es
  puntual y no se solapa con las reglas backend que se añaden.
- **Ninguna contradicción crítica** que obligue a detenerse.

## Riesgos identificados

- `.claude/settings.json` contiene hooks con una **ruta absoluta de Windows**
  (`C:\Python314\Scripts\graphify.EXE`). Es configuración de la máquina/usuario,
  no portable a otros colaboradores. **Recomendación:** conservarla tal cual (es
  del entorno del usuario), pero NO tratarla como configuración de proyecto
  compartida y NO replicarla. Se preserva sin modificar.
- Los scripts de `package.json` usan `npm run …` aunque el lockfile es Yarn —
  inconsistencia de tooling preexistente, fuera del alcance de esta organización
  (no se toca `package.json`).

## Contenido a CONSERVAR sin modificar

- La sección **graphify** de `CLAUDE.md` (regla del usuario, útil y activa).
- Los hooks de graphify en `.claude/settings.json`.

Estos NO se sobrescriben. La organización backend se añade de forma **aditiva**:
nuevas reglas en `.claude/rules/`, nuevas skills en `.claude/skills/`, y un
`README.md` que explica la estructura, sin tocar la configuración de graphify.

## Recomendaciones

1. Añadir `.claude/rules/` con reglas modulares por tema (Fase 6), con
   frontmatter `paths` donde apliquen a rutas concretas.
2. Añadir skills de auditoría (Fase 7) que codifiquen los procedimientos ya
   ejercidos en este trabajo (hardening, seguridad, verificación de producción).
3. NO reemplazar `CLAUDE.md` completo; si se desea un `CLAUDE.md` de proyecto con
   precedencia/comandos, añadirlo como sección **adicional** preservando graphify.
4. Diferir la instalación de plugins a una sesión interactiva con aprobación
   (ver `plugin-selection-matrix.md` e `installation-report.md`).

## Respaldo

Como la configuración previa es mínima (2 archivos) y **no se modifica ninguno**,
no se requiere respaldo destructivo. El estado previo queda registrado en la
tabla de inventario de arriba y en el historial de Git.
