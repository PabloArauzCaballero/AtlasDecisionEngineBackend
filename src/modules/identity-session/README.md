# Sesión del portal

Este módulo adapta login, refresh y logout del proveedor de identidad al navegador. A nivel de
negocio permite acceso corporativo sin exponer refresh tokens a JavaScript; a nivel de sistema
valida origen, limita intentos y maneja cookie `HttpOnly`, `SameSite` y `Secure` en producción.

Las rutas son públicas sólo respecto al guard global; siguen protegidas por origen, validación,
rate limiting y el proveedor real. El módulo no asigna roles localmente.
