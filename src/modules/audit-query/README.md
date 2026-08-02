# Consulta de auditoría

Este módulo ofrece evidencia a Auditoría, Compliance y Operaciones sin exponer tablas crudas. A
nivel de negocio soporta investigaciones y verificación de integridad; a nivel de sistema entrega
ejecuciones, eventos paginados, cursor keyset, métricas y validación por lotes de la cadena HMAC.

Los filtros están acotados y tenant-scoped. La lectura nunca modifica la cadena ni carga el
histórico completo en memoria.
