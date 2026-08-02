# Siembra de catálogos y demo

Este módulo crea datos bootstrap idempotentes. A nivel de negocio ofrece un escenario demostrable
y clientes técnicos iniciales; a nivel de sistema orquesta catálogos, artefacto BNPL, snapshots,
ambientes y credenciales hasheadas.

En producción sólo se aplican semillas estructurales autorizadas; el mockup se limita a desarrollo.
`data/` contiene definiciones puras y `seed-runner.ts` permite reutilizarlas desde Prisma y NestJS.
