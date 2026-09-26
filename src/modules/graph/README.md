# Núcleo del grafo de decisión

Este módulo es el corazón determinista de ATLAS. A nivel de negocio produce decisiones
reproducibles, explicables y con salidas contractuales; a nivel de sistema valida estructura y
expresiones, compila snapshots canónicos y ejecuta nodos/aristas con límites de pasos.

`expression-evaluator` interpreta el AST sin `eval`; `script-node-runner` delega código a un
sandbox; `execution-engine` acumula salida/traza; `validators/` falla cerrado ante grafos ambiguos
o incompletos.

Un nodo `WORKER` llama a un servicio de los workers absorbidos durante la decisión y proyecta
su respuesta a variables intermedias. Quien ejecuta la llamada llega como **argumento de
`execute()`** (`WorkerServiceInvoker`), igual que el resolutor de árboles anidados: así este
módulo no depende de `WorkersModule` y no hay ciclo. `worker-call.ts` interpreta la
configuración una sola vez para el validador y para el motor, de modo que ninguno acepte una
forma que el otro no entienda.
