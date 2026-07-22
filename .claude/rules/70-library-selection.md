# Selección de librerías

- No cambies versiones mayores de dependencias del núcleo (NestJS 11, Prisma 6,
  TypeScript 5.8) sin autorización explícita.
- No introduzcas una librería nueva si el stack ya cubre la necesidad:
  - Validación → `class-validator` + `zod` (ya presentes).
  - HTTP/DI/rutas → NestJS.
  - ORM/migraciones → Prisma + `@prisma/adapter-pg`.
  - Cache/colas → `ioredis`.
  - Observabilidad → OpenTelemetry + `prom-client` + `pino`.
- Gestor de paquetes: **Yarn**. No mezcles `npm install` / `pnpm` para añadir deps.
- Cualquier dependencia nueva debe justificarse (responsabilidad clara, sin
  solapamiento, mantenida, revisable) y registrarse en el PR.
