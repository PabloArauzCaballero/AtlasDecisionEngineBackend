# Auditoría común

`AuditService` escribe eventos encadenados dentro de la misma transacción que la acción de negocio.
Esto existe para demostrar quién cambió qué y cuándo; técnicamente calcula el payload canónico, el
HMAC, la secuencia por tenant y publica el evento durable sin permitir actualizaciones o borrados.

`audit.module.ts` exporta el servicio. Los módulos llamadores deben pasar su cliente transaccional;
una auditoría escrita después del commit no ofrece atomicidad y no es aceptable.
