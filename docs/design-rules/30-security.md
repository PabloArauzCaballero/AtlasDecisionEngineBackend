---
title: "Seguridad"
tags:
  - reglas-de-diseno
  - seguridad
---
<!-- GENERADO POR scripts/docs/generate-vault.mjs — NO EDITAR A MANO.
     Fuente: .claude/rules/30-security.md. Ejecute `yarn docs:vault` tras cambiarla. -->

# Seguridad

!!! abstract "Ficha de la regla"
    **Fuente canónica:** `.claude/rules/30-security.md` — esta página es su espejo generado.

    **Alcance:** Se aplica al editar `src/**/*.ts` · `prisma/**`.

    **Cómo se aplica:** la herramienta de asistencia carga la regla automáticamente al tocar esas rutas; una persona la aplica en revisión de código. La regla
    no sustituye a las pruebas ni a los controles de CI.

- **RBAC real en backend**: la autorización se decide en el servidor con
  `@Roles(...)` + `RolesGuard`, nunca ocultando un botón en el frontend. Los
  endpoints nuevos declaran sus roles explícitamente.
- **RLS por tenant** en toda tabla tenant-scoped nueva: añade política espejo de
  la migración `20260719080000_tenant_rls_and_app_role` (mismo `app.tenant_id`
  GUC). El runtime conecta como el rol NO superusuario `atlas_app` para que la RLS
  aplique.
- **Ejecución de código importado** (nodos de script, Código→Flow): SIEMPRE
  aislada. `SCRIPT_RUNNER_MODE=SIDECAR` (gVisor, sin red) es obligatorio en
  producción; el runner IN_PROCESS está prohibido en producción por el env schema
  y por una guardia en `ScriptNodeRunnerService`.
- Sin secretos hardcodeados ni tokens en archivos versionados. El env schema
  rechaza valores de ejemplo en producción.
- Valida y sanitiza toda entrada externa; usa `safe-regex` anti-ReDoS para
  patrones dinámicos.
- La cadena de auditoría (`DecisionAuditEvent`) es append-only y encadenada por
  hash: nunca la modifiques ni la borres; el rol de app tiene REVOKE UPDATE/DELETE.
