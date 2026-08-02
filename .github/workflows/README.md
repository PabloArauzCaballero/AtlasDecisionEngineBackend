# Workflows de CI y seguridad

Los YAML de esta carpeta son controles ejecutables, no documentación aspiracional. Su propósito de
negocio es impedir que cambios sin evidencia entren al producto; su propósito de sistema es crear
PostgreSQL/Redis aislados, verificar la cadena de migraciones y aplicar análisis de código,
dependencias e imagen.

Mantenga acciones fijadas a versiones mayores revisadas, permisos de GitHub mínimos y secretos sólo
en el almacén de Actions. Un gate no debe marcarse opcional para ocultar una falla funcional.
