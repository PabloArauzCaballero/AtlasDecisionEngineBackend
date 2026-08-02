# Migración: outbox y notificaciones

Introduce eventos pendientes, deduplicación de consumidores y bandeja. A nivel de negocio entrega
tareas de aprobación/cambios de forma durable; a nivel de sistema implementa lease, reintentos,
dead-letter, processed-event y RLS para las tablas tenant-scoped.
