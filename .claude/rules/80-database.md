---
paths:
  - "prisma/**"
  - "src/common/prisma/**"
---

# Base de datos y migraciones (Prisma + PostgreSQL)

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
