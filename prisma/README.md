# Persistencia y datos bootstrap

Esta carpeta define el modelo durable del motor. A nivel de negocio conserva versiones,
aprobaciones, decisiones y evidencia; a nivel de sistema contiene el schema Prisma, la cadena SQL,
seeders idempotentes y utilidades de datos de prueba.

`schema.prisma` describe el estado final; `migrations/` es la historia inmutable para alcanzarlo;
`seed.ts` delega en el mismo runner que la aplicación. Migraciones usan credencial elevada y la API
usa `atlas_app` para hacer efectiva RLS. Nunca se corrige deriva reescribiendo una migración aplicada.

`seed.ts` es la ÚNICA entrada de siembra automática: la que ejecuta el Job de despliegue y la que
invoca `prisma db seed`. Los guiones de mano y los datos de prueba viven aparte, en
[`dev-seeds/`](dev-seeds/README.md), y ninguna imagen los lleva. Estaban sueltos en esta carpeta,
al lado del fichero que corre en producción.
