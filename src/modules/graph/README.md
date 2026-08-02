# Núcleo del grafo de decisión

Este módulo es el corazón determinista de ATLAS. A nivel de negocio produce decisiones
reproducibles, explicables y con salidas contractuales; a nivel de sistema valida estructura y
expresiones, compila snapshots canónicos y ejecuta nodos/aristas con límites de pasos.

`expression-evaluator` interpreta el AST sin `eval`; `script-node-runner` delega código a un
sandbox; `execution-engine` acumula salida/traza; `validators/` falla cerrado ante grafos ambiguos
o incompletos.
