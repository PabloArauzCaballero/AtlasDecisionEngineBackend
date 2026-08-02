# Cache y límites distribuidos

Esta carpeta sostiene cache tenant-scoped y contadores de ventana fija. A nivel de negocio protege
latencia y disponibilidad; a nivel de sistema encapsula Redis, prefijos, expiración, reconexión y el
fallback permitido únicamente fuera de producción.

Toda clave con datos de decisión incluye tenant. `CacheService` también respalda rate limiting de
autenticación e integración; no se deben crear clientes Redis paralelos en módulos de dominio.
