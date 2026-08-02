# Importación Código → Flow

Este módulo transforma reglas JavaScript/Python existentes en un activo revisable. A nivel de
negocio reduce migración manual sin fingir que todo código es inferible; a nivel de sistema extrae
contrato, valida sintaxis/seguridad, deriva ramas soportadas y degrada al runner aislado cuando la
traducción no puede preservar semántica.

`branch-reader` y `expression-parser` aceptan un subconjunto deliberado; `branch-extractor` produce
IR; `graph-generator` construye el grafo; `code-import.service` persiste preview y confirma contra
el escritor/lifecycle de artefactos.
