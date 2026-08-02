# Errores de dominio

`DomainException` y su filtro convierten fallos conocidos en respuestas RFC 7807 estables. A nivel
de negocio entregan códigos accionables sin revelar infraestructura; a nivel de sistema unifican
status HTTP, detalles seguros, métricas, logs y auditoría de denegaciones.

Los módulos deben lanzar códigos de dominio. Errores desconocidos se registran internamente y se
redactan en producción.
