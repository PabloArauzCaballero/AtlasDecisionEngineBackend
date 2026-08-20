---
title: "Gobernanza y precedencia"
tags:
  - reglas-de-diseno
  - gobernanza
---
<!-- GENERADO POR scripts/docs/generate-vault.mjs — NO EDITAR A MANO.
     Fuente: .claude/rules/00-governance.md. Ejecute `yarn docs:vault` tras cambiarla. -->

# Gobernanza y precedencia

!!! abstract "Ficha de la regla"
    **Fuente canónica:** `.claude/rules/00-governance.md` — esta página es su espejo generado.

    **Alcance:** Se aplica a todo el repositorio, sin restricción de ruta.

    **Cómo se aplica:** la herramienta de asistencia carga la regla en toda sesión sobre este repositorio; una persona la aplica en revisión de código. La regla
    no sustituye a las pruebas ni a los controles de CI.

- Precedencia: (1) requisitos aprobados y reglas de negocio → (2) contratos y
  migraciones vigentes → (3) código y pruebas existentes → (4) supuestos
  documentados. No inventes requisitos ausentes.
- Detente ante una contradicción crítica antes de modificar; repórtala.
- No declares que algo "funciona" sin evidencia ejecutada (gate real, salida real).
- No hagas cambios destructivos o irreversibles sin aprobación explícita:
  `git push`, `git reset --hard`, `prisma migrate reset`, borrar datos, tocar
  producción, iniciar OAuth o usar secretos.
- Conserva el stack real: NestJS + Prisma + PostgreSQL + Redis + Jest. Gestor de
  paquetes: **Yarn** (lockfile `yarn.lock`).
