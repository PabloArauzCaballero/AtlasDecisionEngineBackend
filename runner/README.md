# Runner aislado de scripts

Esta carpeta implementa el proceso mínimo que ejecuta scripts de nodos `RESULT`. A nivel de negocio
permite fórmulas configurables sin convertir código no confiable en acceso al backend; a nivel de
sistema define el protocolo por socket Unix que usa el sidecar sin red, capacidades ni filesystem
escribible.

`server.mjs` valida el mensaje, limita tiempo y salida, ejecuta JavaScript/Python en un subproceso y
devuelve una respuesta acotada. En producción debe correr bajo gVisor; el análisis estático de
importación es defensa adicional, no sustituto del aislamiento del host.
