# Siembra del catálogo

Este módulo ya no CONTIENE los datos: los TRAE.

El catálogo —variables, códigos de motivo, librerías aprobadas, campos calculados, categorías
semánticas— y el artefacto de demostración se publican en una **rama** de PostgreSQL gestionado, y
aquí sólo se copia lo que esa rama publica (`common/seeding/seed-sync.ts`). Antes eran ~800 KB de
TypeScript bajo `data/` que `seed-runner.ts` recorría haciendo upserts en cada arranque.

La rama ES el perfil: la de desarrollo publica el artefacto de demostración con sus despliegues
activos, la de producción no. Por eso ya no existe `SEED_INCLUDE_MOCKUP`.

`seeding.service.ts` copia **sólo si la base está vacía** —la carga es un reemplazo, no un upsert,
así que reiniciar un proceso no puede borrar el trabajo de la sesión anterior— y después registra
**siempre** las credenciales de integración desde el entorno
(`common/seeding/seed-local-clients.ts`): una clave de API es un secreto de la instalación, no un
dato que pueda viajar en una rama.

Ver `docs/data/seeds.md`.
