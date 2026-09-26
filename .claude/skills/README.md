# Procedimientos especializados

Esta carpeta contiene flujos repetibles de hardening, auditoría de seguridad y verificación. A
nivel de negocio hace explícita la evidencia exigida antes de declarar una entrega; a nivel de
sistema ordena inventario, revisión de invariantes y gates no destructivos.

Cada subcarpeta incluye un `SKILL.md` autosuficiente. Estos procedimientos no autorizan tocar
producción, publicar cambios ni resetear datos.

Esta carpeta es la fuente canónica; su espejo legible en el portal es `docs/skills/`, generado
con `yarn docs:vault`. Tras cambiar una skill, ejecútalo: `yarn docs:validate` falla si el
espejo quedó atrás.
