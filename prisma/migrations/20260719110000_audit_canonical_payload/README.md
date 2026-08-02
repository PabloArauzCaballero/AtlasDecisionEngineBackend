# Migración: payload canónico de auditoría

Conserva la representación exacta usada al encadenar eventos. A nivel de negocio hace verificable
la evidencia con el paso del tiempo; a nivel de sistema evita que cambios de serialización Prisma o
JSON alteren hashes históricos.
