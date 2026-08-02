# Eventos de dominio y outbox

Esta carpeta define sobres versionados, tipos de evento, bus en proceso y escritura al outbox. A
nivel de negocio permite notificar y proyectar cambios sin retrasar ni deshacer la operación
principal; a nivel de sistema garantiza publicación transaccional y entrega at-least-once.

Los consumidores deben ser idempotentes. Un evento es un hecho durable, no telemetría efímera ni
un comando oculto.
