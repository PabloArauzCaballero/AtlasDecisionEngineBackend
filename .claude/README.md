# Configuración de Claude Code — Atlas Decision Engine (backend)

Esta carpeta organiza cómo Claude Code trabaja en este repositorio, siguiendo
`CLAUDE_ORGANIZAR_SKILLS_BACKEND.md`. Todo aquí es **aditivo**: no reemplaza la
configuración de graphify existente (`CLAUDE.md` raíz y los hooks de
`settings.json`), que se conserva sin cambios.

## Estructura

```
.claude/
  README.md            ← este archivo
  settings.json        ← hooks de graphify del usuario (NO modificar)
  rules/               ← reglas modulares por tema (cargadas por Claude Code)
  skills/              ← procedimientos especializados, cargados bajo demanda
```

## Reglas (`rules/`)

Una regla por tema, con frontmatter `paths` cuando solo aplica a ciertas rutas:

| Archivo | Tema |
|---|---|
| `00-governance.md` | Precedencia, evidencia, acciones destructivas |
| `10-backend-architecture.md` | NestJS: controllers finos, DTOs validados, sin ciclos de módulos |
| `20-clean-code.md` | Cohesión, sin duplicación, nombres de dominio |
| `30-security.md` | RBAC real, RLS por tenant, ejecución aislada de scripts, auditoría append-only |
| `40-observability.md` | Logs estructurados, métricas Prometheus, OTel |
| `50-performance.md` | Paginación/keyset, no I/O dentro de tx, cache con tenant |
| `60-testing.md` | Jest unit + e2e reales, evidencia obligatoria |
| `70-library-selection.md` | Yarn, sin cambios de major sin aprobación, sin deps redundantes |
| `80-database.md` | Prisma/Postgres, migraciones aditivas, RLS en el SQL |
| `90-documentation.md` | Docs de dominio + OpenAPI por cada endpoint |

## Skills (`skills/`)

Procedimientos que Claude carga solo cuando la tarea los invoca:

| Skill | Cuándo |
|---|---|
| `backend-hardening` | Auditoría por fases del backend antes de un release |
| `security-audit` | Revisión de seguridad enfocada (RBAC, RLS, sandbox, secretos) |
| `production-verification` | Correr y evidenciar todos los gates antes de declarar "listo" |

Detalle de trazabilidad en `docs/claude/skills-traceability.md`.

## Espejo en la documentación

`rules/` y `skills/` son la fuente canónica —Claude Code las carga desde aquí, por ruta y por
nombre—, pero su contenido es documentación de diseño de pleno derecho y una carpeta oculta no
es donde alguien la busca. Por eso se publican en el portal y en la bóveda de Obsidian:

| Fuente canónica | Espejo publicado |
|---|---|
| `.claude/rules/` | `docs/design-rules/` |
| `.claude/skills/<skill>/SKILL.md` | `docs/skills/` |

El espejo se **genera**, no se copia a mano: `yarn docs:vault`. Y `yarn docs:validate` falla si
se separa de la fuente, de modo que editar la copia rompa el gate en vez de publicar una página
obsoleta. Las capas de contexto y los prompts operativos están documentados en
`docs/prompts/`.

## Plugins

La selección de plugins está en `docs/claude/plugin-selection-matrix.md`. La
instalación real (marketplace + posible OAuth) queda **pendiente de aprobación**
del usuario en sesión interactiva — ver `docs/claude/installation-report.md`.

## Guía de uso

`docs/claude/usage-guide.md`.
