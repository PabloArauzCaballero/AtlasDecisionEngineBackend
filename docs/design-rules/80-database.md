---
title: "Base de datos y migraciones (Prisma + PostgreSQL)"
tags:
  - reglas-de-diseno
  - datos
---
<!-- GENERADO POR scripts/docs/generate-vault.mjs — NO EDITAR A MANO.
     Fuente: .claude/rules/80-database.md. Ejecute `yarn docs:vault` tras cambiarla. -->

# Base de datos y migraciones (Prisma + PostgreSQL)

!!! abstract "Ficha de la regla"
    **Fuente canónica:** `.claude/rules/80-database.md` — esta página es su espejo generado.

    **Alcance:** Se aplica al editar `prisma/**` · `src/common/prisma/**`.

    **Cómo se aplica:** la herramienta de asistencia carga la regla automáticamente al tocar esas rutas; una persona la aplica en revisión de código. La regla
    no sustituye a las pruebas ni a los controles de CI.

- Convenciones del schema: `BigInt @id @default(autoincrement())`, columnas
  `@map` en snake_case, tablas `@@map("decision_...")`, timestamps
  `@db.Timestamptz(6)`, `tenantId` en modelos raíz tenant-scoped.
- Migraciones aditivas/expand-contract: nunca destructivas sin estrategia
  documentada de rollback y compatibilidad. Prohibido `prisma migrate reset` sin
  aprobación explícita del usuario (Prisma lo bloquea para agentes de IA).
- Toda tabla tenant-scoped nueva lleva su política RLS en el SQL de la migración
  (no solo en el schema).
- Transacciones: las escrituras de negocio y su auditoría (`AuditService.append`)
  deben ir en la MISMA transacción (`this.prisma.$transaction`), para que la
  acción y su evidencia sean atómicas.
- Valida la cadena completa con `yarn prisma:validate` y aplica con
  `yarn prisma:migrate:dev` (dev) / `prisma migrate deploy` (deploy).
- El runtime usa el rol `atlas_app` (NO superusuario) para que la RLS aplique; las
  migraciones corren con el rol elevado.
