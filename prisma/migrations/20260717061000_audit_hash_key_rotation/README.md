# Migración: rotación de clave de auditoría

Asocia cada evento con el identificador de la clave HMAC usada. A nivel de negocio permite rotar
secretos sin perder verificación histórica; a nivel de sistema añade `hash_key_id` para seleccionar
la clave activa o retirada durante la validación de cadena.
