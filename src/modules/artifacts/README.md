# Artefactos de decisión

Este módulo administra el activo gobernado: artefacto, versiones, grafo y estados de autoría. A
nivel de negocio permite saber qué política existe, quién la creó y qué versión es inmutable; a
nivel de sistema separa lectura/escritura del grafo, locking optimista, validación, compilación y
transiciones.

`artifact.controller.ts` expone la API; los DTO limitan tamaño y forma; `artifact-graph-reader` y
`artifact-graph-writer` persisten snapshots; `artifact-lifecycle` coordina validación/compilación;
`version-state` impide transiciones ilegales.
