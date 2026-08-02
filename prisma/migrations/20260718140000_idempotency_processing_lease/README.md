# Migración: lease de idempotencia

Añade expiración al estado `PROCESSING`. A nivel de negocio permite reintentar una decisión cuyo
worker murió sin duplicar una decisión completada; a nivel de sistema distingue lock vigente de
fila huérfana y habilita recuperación controlada.
