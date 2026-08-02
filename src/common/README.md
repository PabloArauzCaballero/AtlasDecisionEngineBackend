# Capacidades transversales

Esta carpeta existe para concentrar invariantes reutilizadas por varios dominios. A nivel de
negocio evita que seguridad, auditoría o exactitud cambien según el módulo; a nivel de sistema
provee bloques globales de configuración, persistencia, errores, identidad, observabilidad y
utilidades deterministas.

Una capacidad pertenece aquí sólo cuando no expresa una regla exclusiva de artefactos, runtime,
gobierno u otro dominio. Las dependencias deben apuntar desde los módulos hacia `common`, nunca al
revés.
