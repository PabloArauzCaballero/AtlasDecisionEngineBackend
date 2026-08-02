# Acceso a PostgreSQL

`PrismaService` es la única entrada de persistencia para el runtime NestJS. A nivel de negocio
refuerza separación entre tenants y disponibilidad; a nivel de sistema administra pool, timeouts,
ciclo de vida y el `app.tenant_id` transaccional que activa RLS.

Producción falla si la conexión es superusuario. Consultas raw deben enlazar parámetros y mantener
el filtro de tenant aun cuando RLS actúe como defensa adicional.
