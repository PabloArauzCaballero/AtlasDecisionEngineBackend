# Reglas de trabajo asistido

Estos documentos delimitan arquitectura, seguridad, rendimiento, pruebas y documentación para
herramientas de asistencia. A nivel de negocio preservan criterios de gobierno durante cambios; a
nivel de sistema aplican instrucciones por ruta sin inflar el archivo raíz.

Las reglas complementan, pero no sustituyen, tests, migraciones ni controles CI. Una modificación
debe mantener precedencia y justificar cualquier relajación.

Esta carpeta es la **fuente canónica**: la herramienta de asistencia carga cada regla desde aquí
según la ruta del archivo que se edita. Su espejo legible para personas se publica en el portal
(`docs/design-rules/`) y se regenera con `yarn docs:vault`. Tras cambiar una regla, ejecútalo:
`yarn docs:validate` falla si el espejo quedó atrás.
