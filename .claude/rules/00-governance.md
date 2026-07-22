# Gobernanza y precedencia

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
