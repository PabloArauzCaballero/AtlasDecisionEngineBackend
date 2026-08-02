# Criptografía y canonicalización

Esta carpeta existe para que checksums y cadenas de auditoría sean reproducibles entre procesos y
versiones. A nivel de negocio soporta integridad y no repudio operativo; a nivel de sistema define
JSON canónico, SHA-256 y HMAC con rotación identificada por `keyId`.

Los secretos provienen de configuración. Cambiar la canonicalización rompe verificación histórica
y requiere una migración/versionado explícito.
