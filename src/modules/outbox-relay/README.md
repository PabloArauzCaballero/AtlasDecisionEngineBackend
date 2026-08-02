# Relay del outbox

Este módulo entrega hechos confirmados al bus en proceso. A nivel de negocio evita perder
notificaciones tras un commit; a nivel de sistema reclama filas con `SKIP LOCKED`, lease, reintento
exponencial, métricas y estado dead-letter tras agotar intentos.

La entrega es at-least-once: consumidores idempotentes son obligatorios. Varias réplicas pueden
operar sin procesar simultáneamente la misma fila vigente.
