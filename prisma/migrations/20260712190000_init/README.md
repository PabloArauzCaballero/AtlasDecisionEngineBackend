# Migración: línea base

Crea el modelo inicial del motor —catálogos, artefactos, grafos, pruebas, gobierno, despliegue,
runtime y auditoría—. Existe para que el producto tenga una base reproducible; técnicamente fija
tablas, enums, claves, relaciones e índices sobre los que se aplican todas las expansiones.

`migration.sql` es histórico e inmutable; correcciones se añaden en migraciones posteriores.
