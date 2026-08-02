# Runbook — Campos calculados, librerías y runner de scripts

Cubre §5–§8. Manual de referencia: [`../calculated-fields.md`](../calculated-fields.md).

La regla que gobierna todo este runbook: **el aislamiento no se negocia**. En producción el
runner es el sidecar (`SCRIPT_RUNNER_MODE=SIDECAR`, gVisor, sin red); el env schema y una
guardia en `ScriptNodeRunnerService` rechazan `IN_PROCESS` en producción. Ninguna mitigación
de las de abajo pasa por relajar eso.

---

## Incidente: `SCRIPT_RUNNER_UNAVAILABLE` o `SCRIPT_RUNNER_BUSY`

`UNAVAILABLE` es que no se alcanza el socket; `BUSY` es admisión: el sidecar rechaza con 503
reintentable en vez de encolar sin cota.

1. Comprobar el contenedor `script-runner` y el volumen del socket
   (`SCRIPT_RUNNER_SOCKET_PATH`, por defecto `/var/run/atlas-runner/runner.sock`).
2. Si es `BUSY` sostenido, el cuello es de capacidad, no de configuración: `RUNNER_MAX_CONCURRENCY`
   y `RUNNER_MAX_QUEUE` están deliberadamente por debajo de `pids_limit` y de la cuota de CPU
   del contenedor. Subirlos sin subir también los límites del contenedor cambia un 503 honesto
   por thrashing.
3. Mientras tanto, `SCRIPT_NODES_ENABLED=false` desactiva los nodos de script: las decisiones
   que no los usan siguen operando. Es una degradación acotada y reversible.

**No** poner `SCRIPT_RUNNER_MODE=IN_PROCESS` para "salir del paso": el runner en proceso
comparte el sistema de archivos y la red del contenedor de la API y no es una frontera de
seguridad del sistema operativo.

## Incidente: `MemoryError` o scripts que mueren por la cota de memoria

El límite por proceso es `SCRIPT_NODE_MAX_MEMORY_MB` (32 MiB), aplicado con
`--max-old-space-size` en JS y `RLIMIT_AS` en Python.

1. Un `MemoryError` mata **solo ese script**: eso es el comportamiento correcto. Sin la cota,
   el kernel mata el contenedor entero y se lleva por delante las ejecuciones de otros tenants.
2. Si un campo legítimo no cabe en 32 MiB, casi siempre no es un campo calculado: está
   materializando una colección. Revisar la frontera §8 antes de subir la cota.
3. En Windows (solo desarrollo) `RLIMIT_AS` no existe y el wrapper lo ignora sin fallar.

## Incidente: la cadena aborta con `NESTED_TREE_MEMORY_EXCEEDED`

La cadena retiene la salida de cada salto; el tope acumulado es `NESTED_TREE_MAX_RETAINED_BYTES`
(1 MiB). El tope por resultado individual (`NESTED_TREE_RESULT_TOO_LARGE`) es otro error a
propósito: dice qué salto concreto hay que arreglar.

1. Si sale `RESULT_TOO_LARGE`, hay un salto que devuelve demasiado: acotar su contrato de salida.
2. Si sale `MEMORY_EXCEEDED`, ningún salto es desmesurado pero la cadena entera lo es: reducir
   el abanico de artefactos o lo que cada uno publica.

## Incidente: no se puede publicar una versión de campo calculado

| Código | Qué hacer |
| --- | --- |
| `CALCULATED_FIELD_TESTS_FAILED` | Los casos declarados no pasan. Es la última oportunidad de detectarlo: una versión publicada es inmutable |
| `CODE_TOO_LONG`, `LOOP_FORBIDDEN`, `NESTED_FUNCTION_FORBIDDEN` | Lo escrito ya no es un campo calculado. La salida es un artefacto referenciado, no un campo más largo |
| `TOO_MANY_INPUTS`, `TIMEOUT_TOO_HIGH` | Igual que arriba: se cruzó la frontera §8 |
| `CALCULATED_FIELD_LIBRARY_BLOCKED` | La librería está bloqueada. Desbloquearla exige revisar su prelude, que **es** el control de §7 |
| `CALCULATED_FIELD_VERSION_IN_USE` | Se intenta retirar una versión que algún artefacto usa. `usedBy` dice cuáles |

## Incidente: un campo devuelve su valor por defecto más de lo esperado

La política `missingData` solo puede absorber los errores de `MISSING_DATA_ERROR_CODES`. Un
sandbox caído o un timeout **no** se convierten en "devuelve el valor por defecto", justamente
para que una avería no se disfrace de decisión.

1. Contrastar con `atlas_errors_total{code}`: si crecen los códigos de runner, es avería.
2. Si son de entrada, el mapeo o el contrato del campo está mal, no la política.

## Habilitar una librería nueva

No es una operación de runtime. Una fila del registro solo puede **habilitar** un prelude que
ya exista en `library-preludes.ts`; nunca aportar código. Añadir uno pasa por escribirlo,
revisarlo y publicarlo con el resto del código. Aprobar una librería sin prelude revisado
vaciaría de sentido el control de §7.

## Verificación

```bash
yarn jest test/script-node-runner.spec.ts test/sidecar-sandbox-escape.spec.ts test/chain-budget.spec.ts
```
