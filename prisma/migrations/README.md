# Cadena de migraciones

Cada subcarpeta timestamped es un cambio SQL inmutable y ordenado. A nivel de negocio preserva
evidencia de cómo evolucionaron contratos regulados; a nivel de sistema permite desplegar desde una
base vacía, verificar FKs/índices/checks/RLS y evitar deriva con `yarn migration:validate`.

Las migraciones nuevas siguen expand-contract, documentan rollback operacional y agregan RLS a
toda tabla con `tenant_id`. No use `prisma migrate reset` sobre datos compartidos.
