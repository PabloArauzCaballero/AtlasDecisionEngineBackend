---
name: security-audit
description: Revisión de seguridad enfocada del backend Atlas — RBAC real en backend, RLS por tenant en tablas nuevas, aislamiento de ejecución de código importado, cadena de auditoría append-only, y ausencia de secretos. Úsala al añadir endpoints, tablas o ejecución de código, o antes de un release.
---

# Auditoría de seguridad — Atlas Decision Engine (backend)

## Propósito
Verificar que un cambio no rompe las invariantes de seguridad del dominio
(crédito/riesgo/fraude).

## Cuándo usarla
- Al añadir/modificar un endpoint, una tabla tenant-scoped, o cualquier ejecución
  de código/expresión.
- Antes de un release.

## Cuándo NO usarla
- Cambios puramente de presentación sin superficie de datos ni autorización.

## Fuentes obligatorias
`src/common/security/**`, `.claude/rules/30-security.md`, la migración
`20260719080000_tenant_rls_and_app_role`, `env.schema.ts`.

## Condiciones para detenerse
- Encuentras un secreto versionado o una ruta a producción → detente y reporta,
  no lo "arregles" silenciosamente exponiéndolo.

## Flujo por fases
1. **RBAC**: cada endpoint nuevo declara `@Roles(...)` y la autorización se decide
   en el guard, no en el frontend. Verifica que un rol sin acceso reciba 403 (con
   un e2e si es posible).
2. **RLS**: toda tabla tenant-scoped nueva tiene política RLS en el SQL de la
   migración (no solo en el schema), espejo del patrón existente. El runtime
   conecta como `atlas_app` (no superusuario).
3. **Aislamiento de código**: cualquier ejecución de código importado/script pasa
   por `ScriptNodeRunnerService`; en producción exige SIDECAR (gVisor). El
   análisis estático de `code-import` es defensa en profundidad, no reemplaza el
   sandbox.
4. **Auditoría**: las acciones de negocio registran `AuditService.append` en la
   MISMA transacción; la cadena es append-only (REVOKE UPDATE/DELETE para el rol
   de app).
5. **Secretos**: sin valores hardcodeados; el env schema rechaza ejemplos en
   producción.
6. **Entrada**: validación de DTOs; `safe-regex` para patrones dinámicos.

## Comandos permitidos
Lectura, `grep`, correr los e2e de seguridad (`test/e2e/security*.e2e-spec.ts`).

## Comandos prohibidos
Exponer/mover secretos; tocar producción.

## Evidencia requerida
Para cada punto: el archivo/línea que lo satisface, o un e2e que lo demuestra.

## Entregable
Lista de hallazgos (severidad + ubicación + recomendación). Sin hallazgos
inventados; sin declarar "seguro" sin verificar cada punto.

## Lista de verificación final
- [ ] RBAC backend en cada endpoint nuevo.
- [ ] RLS en cada tabla tenant-scoped nueva.
- [ ] Ejecución de código aislada.
- [ ] Auditoría transaccional e inmutable.
- [ ] Sin secretos versionados.

## Limitaciones
No sustituye un SAST ni un pentest; es una revisión de invariantes de dominio.

## Trazabilidad
`.claude/rules/30-security.md`; `docs/security-review.md`; `SECURITY.md`.
