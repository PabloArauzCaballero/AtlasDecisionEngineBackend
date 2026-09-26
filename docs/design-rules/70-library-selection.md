---
title: "Selección de librerías"
tags:
  - reglas-de-diseno
  - dependencias
---
<!-- GENERADO POR scripts/docs/generate-vault.mjs — NO EDITAR A MANO.
     Fuente: .claude/rules/70-library-selection.md. Ejecute `yarn docs:vault` tras cambiarla. -->

# Selección de librerías

!!! abstract "Ficha de la regla"
    **Fuente canónica:** `.claude/rules/70-library-selection.md` — esta página es su espejo generado.

    **Alcance:** Se aplica a todo el repositorio, sin restricción de ruta.

    **Cómo se aplica:** la herramienta de asistencia carga la regla en toda sesión sobre este repositorio; una persona la aplica en revisión de código. La regla
    no sustituye a las pruebas ni a los controles de CI.

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
