# Sesión del portal

Este módulo adapta login, refresh y logout del proveedor de identidad al navegador. A nivel de
negocio permite acceso corporativo sin exponer refresh tokens a JavaScript; a nivel de sistema
valida origen, limita intentos y maneja cookie `HttpOnly`, `SameSite` y `Secure` en producción.

Las rutas son públicas sólo respecto al guard global; siguen protegidas por origen, validación,
rate limiting y el proveedor real. El módulo no asigna roles localmente.

**Vida absoluta (MOT-08).** La cookie de refresco lleva, firmado con HMAC y atado al token, el
instante en que se inició sesión (`v1.<inicioMs>.<mac>.<token>`). Refrescar conserva ese instante;
pasadas `IDENTITY_SESSION_ABSOLUTE_MAX_HOURS` (12 h por defecto) el refresco responde
`401 SESSION_EXPIRED`, revoca la sesión en el proveedor y borra la cookie. Una cookie que no prueba
su inicio (formato anterior o alterada) también obliga a entrar de nuevo. La clave es
`IDENTITY_SESSION_SIGNING_SECRET` o, si falta, una derivada de `AUDIT_HASH_SECRET`.
