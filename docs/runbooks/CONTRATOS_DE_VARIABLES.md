# Runbook — Contratos de variables, intermedias y contrato de salida

Cubre §1–§4. Todo lo de aquí es **reversible**: ninguna acción borra evidencia ni reescribe
una versión publicada, porque una versión de variable es inmutable por diseño y "arreglarla"
en caliente rompería la reproducibilidad de todas las decisiones que ya la usaron.

Manual de referencia: [`../variable-contracts.md`](../variable-contracts.md).
Diagramas: `../plantuml/23_taxonomia_variables_y_contratos.puml` y `24_ciclo_vida_variable_intermedia.puml`.

---

## Incidente: sube `VARIABLE_MISSING_OR_INVALID` en runtime

Síntoma: las decisiones responden 422 y la tasa de `NO_DECISION` crece tras publicar una
versión de variable o un artefacto.

1. Segmentar por artefacto, versión y **código de variable** (el error lleva `variable` en
   `details`). Un solo código concentrando los fallos es un contrato demasiado estrecho;
   muchos códigos a la vez apunta al proveedor de variables, no al contrato.
2. Comprobar si el valor llega y se rechaza, o no llega: `decision_execution_variable`
   guarda `source_code` (`REQUEST_PAYLOAD`, `PROVIDER`, `DEFAULT`, `UNRESOLVED`) por
   ejecución. `UNRESOLVED` es un problema de origen; `REQUEST_PAYLOAD` rechazado es un
   problema de restricciones.
3. Si es de restricciones, **no** editar la versión: crear una versión nueva con el
   contrato correcto y desplegarla. El motor reevalúa siempre en servidor
   (`constraint-engine.ts`), así que relajarlo en el frontend no cambia nada.
4. Mitigación inmediata mientras se publica la versión: revertir el despliegue del
   artefacto a la versión anterior (rollback normal, ver `OPERATIONS.md`).

No hacer: subir el `fallbackPolicy` a `DEFAULT` para "destapar" el flujo. Un valor por
defecto inventado convierte una avería de datos en una decisión de crédito silenciosa.

## Incidente: no se puede publicar por `VARIABLE_CONTRACT_INCOMPATIBLE`

Es el guardián de compatibilidad, no un fallo. La versión nueva estrecha algo que la
anterior permitía (rango, longitud, enumeración, nulabilidad).

1. Leer `details` del error: dice qué restricción se estrechó.
2. Decidir entre las dos únicas salidas legítimas:
   - **Ampliar** el contrato en vez de estrecharlo (el error `WIDENING` informa de que se
     amplió, y eso sí se admite), o
   - publicar como **variable nueva** y migrar a los artefactos consumidores uno a uno.
3. Nunca forzar el despliegue saltándose la comprobación: hay artefactos compilados que ya
   fijaron el contrato antiguo y ejecutarían con una premisa falsa.

## Incidente: una intermedia aparece `INVALID` o aborta la ejecución

1. Localizar el paso: la traza trae `variableState.intermediatesAfter` con `state`,
   `producerNodeKey` y **`createdAtStepIndex`** — el paso en el que el valor apareció.
   Con eso se salta directamente al nodo culpable en vez de leer la traza entera.
2. Códigos y qué significan:

| Código | Causa real |
| --- | --- |
| `INTERMEDIATE_NOT_DECLARED` | El nodo escribe una intermedia que el grafo no declara |
| `INTERMEDIATE_WRITE_UNAUTHORIZED` | Escribe un nodo que no es el productor declarado |
| `INTERMEDIATE_ALREADY_WRITTEN` | Segunda escritura con política `SINGLE_WRITE` |
| `INTERMEDIATE_VALUE_INVALID` | El valor incumple las restricciones de la intermedia |
| `INTERMEDIATE_NULL_NOT_ALLOWED` | Nulo en una intermedia no nulable |
| `INTERMEDIATE_ACCUMULATE_UNSUPPORTED` | `ACCUMULATE` sobre un tipo que no se acumula |

3. Todos son **de diseño del grafo**, no de datos: se corrigen en un borrador nuevo y se
   vuelven a validar. La validación estática por dominancia
   (`graph-intermediate.validator.ts`) los detecta antes de compilar; si uno llegó a
   runtime, revisar por qué el grafo se compiló sin él.

## Incidente: la respuesta no trae un campo esperado

La salida **no se infiere del último nodo**: si el campo no está en el contrato de salida
(`decision_output_contract_field`), no se publica aunque un nodo lo haya calculado.

1. Comprobar que el campo existe en el contrato de salida de esa versión.
2. Si existe y falta el valor, mirar `absenceReasons` del campo: el motivo declarado por el
   que puede no venir es parte del contrato, no un hueco.
3. Si el campo es sensible, comprobar `tracePolicy`: `REDACTED`/`EXCLUDED` lo sanean antes
   de salir del motor. Eso es correcto y no se "arregla" desactivándolo.

## Verificación tras cualquier cambio

```bash
yarn typecheck && yarn test && yarn test:e2e
```

Y en un ambiente no productivo, una simulación con `compareWithProduction: true` sobre el
artefacto tocado: da el bloque `productionComparison` y alimenta
`atlas_dev_prod_result_diff_total`.
