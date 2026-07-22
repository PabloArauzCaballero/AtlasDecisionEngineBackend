# Documentación

- Toda feature nueva o endpoint nuevo/modificado actualiza:
  - el doc de dominio en `docs/` (p. ej. `docs/nested-decision-trees.md`),
  - la anotación OpenAPI (`@ApiTags`, decoradores de `@nestjs/swagger`) del
    controller — Swagger genera el spec en `/docs/openapi.json` cuando
    `SWAGGER_ENABLED=true`.
- Los comentarios de código explican una restricción o un "por qué" no evidente,
  no reescriben lo que el código ya dice.
- No copies documentos extensos dentro de `CLAUDE.md`; convierte procedimientos
  largos en skills (`.claude/skills/`) y reglas por ruta en `.claude/rules/`.
- Mantén trazabilidad: un doc de feature enlaza a los archivos/servicios reales.
