# Campos calculados, librerías autorizadas y QA Lab

Manual de §5–§8 y §10 de la ampliación de contratos. Describe lo implementado, con las
fronteras de seguridad y las pruebas que las sostienen.

---

## 1. Qué es (y qué no es) un campo calculado

Un campo calculado es **una función pequeña, gobernada y reutilizable**: recibe entradas
tipadas, aplica un comportamiento acotado y devuelve un valor.

No es un artefacto, ni una variable intermedia, ni un flujo, ni un servicio.

| Frontera | Campo calculado | Artefacto |
| --- | --- | --- |
| Etapas de negocio | Una | Varias |
| Ramificación | Ninguna significativa | Es su razón de ser |
| Persistencia propia | No | Sí (ejecuciones, evidencia) |
| Integraciones / HTTP / BD | No | Sí |
| Resultado | Un único valor | Un contrato de salida completo |
| Código | ≤ 3 líneas ejecutables | Sin límite: es un grafo |
| Tiempo | Milisegundos (≤ 250 ms) | Presupuesto de la decisión |

El backend **rechaza** lo que ya no es un campo calculado:
`TOO_MANY_INPUTS` (más de 10 entradas), `TIMEOUT_TOO_HIGH` (más de 250 ms),
`CODE_TOO_LONG`, `LOOP_FORBIDDEN`, `NESTED_FUNCTION_FORBIDDEN`.

### La frontera con el nodo, la regla y el flujo (§8)

El artefacto es la frontera de más arriba, pero §8 pide separar el campo calculado de las
otras tres piezas con las que se confunde a diario. La pregunta que las distingue no es de
tamaño sino **de qué produce cada una**:

| | Produce | Decide el camino | Se reutiliza | Dónde vive |
| --- | --- | --- | --- | --- |
| **Campo calculado** | Un valor | No | Sí, entre artefactos | Catálogo propio, versionado |
| **Nodo** | Un efecto en la ejecución | A veces (`CONDITION`, `SWITCH`) | No | Dentro de un grafo |
| **Regla** | Un veredicto booleano | Sí, alimenta una arista | Sí, dentro del artefacto | `decision_condition` |
| **Flujo** | Un contrato de salida | Es su razón de ser | Sí, por referencia (§9) | El artefacto completo |

**Campo calculado ↔ nodo.** Un nodo es una posición en el grafo: tiene aristas, orden,
duración propia y aparece en la traza como paso. Un campo calculado no tiene posición —
lo invoca un nodo (§4.bis) y sin ese nodo no se ejecuta jamás. La consecuencia práctica:
si lo que se quiere escribir necesita saber *por dónde vino* la ejecución o *a dónde va*,
no es un campo calculado, porque el campo solo ve sus entradas mapeadas. Un campo tampoco
puede escribir en una intermedia de la que su nodo no sea productor
(`INTERMEDIATE_WRITE_UNAUTHORIZED`): quien tiene autoridad sobre el dato es el nodo.

**Campo calculado ↔ regla.** Una regla devuelve verdadero o falso y su valor está en
*condicionar una arista*; un campo devuelve un dato y no encamina nada. Un campo que
devuelve `BOOLEAN` sigue siendo un campo, no una regla: la diferencia es que su resultado
se guarda en una intermedia o en una salida, y es la regla quien luego lo lee para decidir.
Escribir la lógica como campo cuando es regla tiene un coste concreto: se pierde la
trazabilidad de rama (`branchTaken`, ramas descartadas) que el editor muestra por arista.

**Campo calculado ↔ flujo.** Un flujo publica un contrato de salida completo, persiste
evidencia y puede llamar a otros flujos con presupuesto, reintentos y política de fallo
(§9). Un campo no persiste nada, no tiene contrato de salida —tiene contrato de *retorno*,
que es un único valor— y no puede invocar a nadie. Cuando una «función» necesita varias
etapas de negocio o su propia evidencia auditable, la respuesta es un artefacto
referenciado, no un campo más largo; el guardián de código lo impide antes
(`CODE_TOO_LONG`, `LOOP_FORBIDDEN`) precisamente para que esa conversación ocurra en el
momento de diseñar y no en producción.

---

## 2. Contrato de retorno: obligatorio

No se puede guardar una versión sin declarar (`§5.3`):

| Campo | Significado |
| --- | --- |
| `dataType` | Qué devuelve |
| `nullable` | Si puede no devolver valor |
| `nullConditions` | En qué condiciones concretas no lo devuelve |
| `precision` | Decimales del resultado |
| `constraints` | Restricciones del valor devuelto |
| `divisionByZero` | `FAIL` / `RETURN_NULL` / `RETURN_DEFAULT` |
| `missingData` | Idem, ante una entrada ausente |
| `outOfRange` | Idem, si el resultado incumple sus restricciones |
| `errorCode` | Código emitido cuando la política es `FAIL` |

Coherencias que el validador exige:

- `RETURN_NULL` sobre un retorno no nulo → `NULL_POLICY_ON_NON_NULLABLE`
- `RETURN_DEFAULT` sin valor por defecto → `DEFAULT_POLICY_WITHOUT_DEFAULT`
- `nullable: true` sin `nullConditions` → `NULL_CONDITIONS_UNDOCUMENTED`
- `precision` sobre un tipo no decimal → `PRECISION_ON_NON_DECIMAL`

`missingData` cubre exactamente lo que su nombre dice: entrada obligatoria ausente,
argumento inválido, conversión imposible y división entre cero
(`MISSING_DATA_ERROR_CODES` en `calculated-field-runtime.ts`). Un fallo de
infraestructura o de configuración —sandbox caído, script agotando su tiempo,
librería sin implementación autorizada, salida no serializable— **se propaga**: con
`RETURN_DEFAULT`, taparlo devolvería el valor por defecto y la decisión seguiría
adelante como si el cálculo hubiera salido bien.

### Comentarios fuera del código

`commentsJson` guarda descripción general, explicación de entradas y de salida,
supuestos, limitaciones, ejemplo y motivo. **No consumen presupuesto de líneas**: por eso
el límite de tres líneas no empuja a escribir código sin documentar.

---

## 3. Tres modalidades de implementación

### 3.1 Constructor visual (recomendado)

`operation-catalog.ts` publica un catálogo **cerrado** de ~45 operaciones agrupadas en
matemáticas, estadística, fechas, texto, conversión, comparación, lógica, listas,
agregación y datos.

`operation-evaluator.ts` las ejecuta con un `switch`. No hay `eval`, ni sandbox, ni
proceso hijo: **el árbol es estructuralmente incapaz de ejecutar código arbitrario**. Esa
es la razón por la que es la modalidad recomendada.

Límites: profundidad 24, 200 nodos. Cada argumento se valida por tipo antes de operar
(`CALCULATED_FIELD_ARGUMENT_INVALID`), sin coerciones silenciosas.

### 3.2 y 3.3 JavaScript / Python

Máximo **tres líneas ejecutables**. No cuentan comentarios ni líneas en blanco, y el
guardián impide burlar el límite con puntos y coma (`CODE_TOO_MANY_STATEMENTS`).

El código se ejecuta en el mismo sandbox que los nodos de script
(`ScriptNodeRunnerService`): proceso separado, sin globals de Node, `Math.random`
bloqueado, `Date` inaccesible, y en producción **obligatoriamente** en el sidecar
`runner/` (contenedor sin red, sin capacidades, con gVisor).

El motor envuelve el código del autor para que devuelva `{ value }`; el autor sigue
escribiendo su expresión de tres líneas.

Prohibiciones que el análisis estático rechaza en tiempo de autoría:

`import`/`require` · `eval`/`exec` · bucles · dunder (`__proto__`, `__class__`) ·
`globals` · `process`/`os`/`sys`/`open`/`fetch` · reloj (`Date`, `datetime`) ·
aleatoriedad · `Function()` · asincronía · clases · `def` anidado · `format`/`format_map`

Un literal de cadena que contenga una palabra prohibida **no** dispara falso positivo: el
guardián elimina cadenas y comentarios antes de analizar.

---

## 4. Registro de librerías autorizadas

### La decisión de diseño que lo hace un control de seguridad

El código de cada librería (**prelude**) vive en `libraries/library-preludes.ts`, en el
repositorio, revisado y versionado. Una fila de `decision_approved_library` solo puede
**habilitar** un prelude que ya existe.

Si la base de datos pudiera aportar el código, aprobar una librería equivaldría a
inyectar código en el sandbox y el registro dejaría de ser un control: sería un vector.
`LibraryService.upsert()` rechaza con `LIBRARY_PRELUDE_NOT_IMPLEMENTED` cualquier paquete
sin implementación, y con `LIBRARY_FUNCTION_NOT_EXPOSED` cualquier función que el prelude
no exponga de verdad.

### Catálogo inicial

| Nombre | Categoría | JS | Python | Estado |
| --- | --- | --- | --- | --- |
| `math` | Matemáticas | `math.abs`, `math.sqrt`… | `math_abs`, `math_sqrt`… | APPROVED |
| `statistics` | Estadística | `statistics.mean`, `.median`, `.stdev` | `stats_mean`, `stats_median`… | APPROVED |
| `dates` | Fechas | `dates.daysBetween`, `.yearsBetween` | `dates_days_between`… | APPROVED |
| `finance` | Finanzas | `finance.dti`, `.ltv`, `.monthlyPayment` | `finance_dti`… | **RESTRICTED** |

`finance` nace restringida a los ambientes no productivos (DEV/STAGING/TEST): §7 exige aprobación explícita antes de que una
fórmula financiera influya en una decisión real.

En Python las funciones se exponen con nombre plano y prefijo (`math_abs`) en vez de como
atributos: el runner prohíbe `class` y el acceso a atributos dunder, así que un espacio de
nombres con puntos no sobreviviría a su análisis estático.

Ningún prelude introduce importaciones ni aleatoriedad — `calculated-fields.spec.ts` lo
comprueba recorriendo todos.

### Aislamiento por ambiente

`resolveForExecution` rechaza una librería no habilitada en el ambiente destino
(`LIBRARY_ENVIRONMENT_FORBIDDEN`), bloqueada (`LIBRARY_NOT_APPROVED`) o de otro lenguaje
(`LIBRARY_LANGUAGE_MISMATCH`). Las versiones son **exactas y fijadas**: PROD nunca
resuelve rangos.

---

## 4.bis Invocar un campo calculado desde un grafo

Sin esto, el catálogo existiría pero ningún algoritmo podría usarlo. Un nodo declara sus
invocaciones y el resultado se guarda donde diga el destino:

```jsonc
{
  "callKey": "debt_to_income",
  "calculatedFieldVersionId": "900",      // versión FIJADA
  "inputMapping": {
    "deuda_mensual":   { "source": "VARIABLE",     "path": "deuda_mensual" },
    "ingreso_mensual": { "source": "INTERMEDIATE", "path": "ingreso_neto" }
  },
  "targetKind": "INTERMEDIATE",           // o OUTPUT
  "targetCode": "dti"
}
```

Orígenes admitidos por entrada: `VARIABLE`, `INTERMEDIATE`, `LITERAL`, `EXPRESSION`.

### Qué comprueba el backend al guardar

| Código | Qué evita |
| --- | --- |
| `CALCULATED_FIELD_VERSION_NOT_FOUND` | Invocar algo que no existe en el tenant |
| `CALCULATED_FIELD_NOT_USABLE` | Invocar un borrador, que puede cambiar bajo los pies |
| `CALCULATED_FIELD_LIBRARY_BLOCKED` | Arrastrar una librería bloqueada |
| `CALCULATED_FIELD_VERSION_UNPINNED` | Una decisión que dejaría de ser reproducible |
| `CALCULATED_FIELD_INPUT_UNMAPPED` | Entrada obligatoria sin alimentar |
| `CALCULATED_FIELD_INPUT_UNKNOWN` | Mapeo que sobra tras cambiar el contrato |
| `CALCULATED_FIELD_INPUT_SOURCE_MISSING` | Alimentar desde algo que el grafo no declara |
| `CALCULATED_FIELD_INPUT_TYPE_MISMATCH` | Tipo incompatible en una entrada |
| `CALCULATED_FIELD_RETURN_TYPE_MISMATCH` | El retorno no cabe en el destino |
| `CALCULATED_FIELD_TARGET_MISSING` | Destino inexistente |
| `INTERMEDIATE_WRITE_UNAUTHORIZED` | Escribir una intermedia de la que el nodo no es productor |
| `CALCULATED_FIELD_CALL_DUPLICATE` | Dos llamadas con la misma clave en un nodo |

### La definición viaja congelada

El cliente manda **qué versión** invocar; el backend resuelve la definición ejecutable y
la **embebe en el artefacto compilado**. Dos consecuencias:

- Una decisión archivada se reproduce siempre, aunque el campo se deprecie después.
- Guardar un grafo no puede meter código en el sandbox: la definición no se acepta del
  cliente. Ver ADR D-15 y D-16.

Cambiar el campo calculado **no** afecta a los artefactos ya guardados; hay que volver a
guardar el grafo para adoptar la versión nueva.

### Dependencias inversas

`decision_artifact_calculated_field_use` responde a «qué artefactos usan este campo»
(§5.2). El detalle del campo lo devuelve en `usedBy`, y retirar una versión en uso se
rechaza con `CALCULATED_FIELD_VERSION_IN_USE` en vez de con un error de clave foránea.

### En la traza

Cada invocación aparece en `result.calculatedFieldCalls` con nodo, clave de llamada,
código, versión, destino, resultado y duración — el eslabón «campo calculado» que pide
§12.

---

## 5. Ciclo de gobierno de una versión

```
DRAFT → IN_REVIEW → APPROVED → PUBLISHED → DEPRECATED → RETIRED
```

Publicar **ejecuta los casos de prueba declarados** y falla con
`CALCULATED_FIELD_TESTS_FAILED` si alguno no pasa: una versión publicada es inmutable, así
que es la última oportunidad de detectarlo.

Cada versión guarda `contentHash` (entradas + retorno + implementación + librerías con su
versión), autor, revisor y aprobador.

---

## 6. QA Lab: generación masiva reproducible

### Generación guiada por contrato

El generador **lee el contrato** y produce por sí solo:

- valores válidos que respetan todas las restricciones,
- valores de frontera (mín/máx exactos, longitudes límite, extremos de enumeración),
- valores inválidos (justo fuera de rango, texto vacío, texto excesivamente largo, listas
  vacías o con exceso de elementos, enumeración inválida, tipo incorrecto).

Si mañana alguien añade `maxLength`, los casos "justo por encima del máximo" aparecen
solos. Esa es la diferencia entre un banco de pruebas que envejece y uno que sigue al
contrato.

### Distribución de valores (§10.4)

El reparto por defecto dentro de cada rango es uniforme, y eso **infrarrepresenta las colas**:
si el 3 % de la cartera real cobra el mínimo, un lote uniforme apenas roza ese tramo y la
política que lo trata mal se publica sin haberse probado. `distributions` sesga dónde caen los
valores de una variable:

```jsonc
{
  "caseCount": 500,
  "environmentCode": "TEST",
  "distributions": [
    { "variableCode": "ingreso_mensual", "shape": "LOW_TAIL" },
    { "variableCode": "producto", "valueWeights": { "BNPL": 8, "CONSUMO": 1 } }
  ]
}
```

| Forma | Efecto |
| --- | --- |
| `UNIFORM` | Reparto plano (por defecto) |
| `LOW_TAIL` / `HIGH_TAIL` | Acumula en la cola baja / alta del rango |
| `CENTERED` | Acumula cerca del centro (triangular) |
| `EXTREMES` | Vacía el centro: castiga los dos umbrales en una sola corrida |

`valueWeights` sesga enumeraciones y booleanos; un peso ausente vale 1, así que declarar uno
solo ya lo sesga frente al resto, y un peso `0` excluye ese valor.

Tres garantías que hacen que esto siga siendo QA y no un generador cualquiera:

1. **No relaja el contrato.** Sesgar cambia dónde caen los valores, nunca produce uno que las
   restricciones prohíban.
2. **Una variable ajena al contrato se rechaza** (`QA_DISTRIBUTION_VARIABLE_UNKNOWN`) en vez de
   ignorarse: una corrida verde con un sesgo que nunca ocurrió es peor que un error.
3. **La reproducibilidad se conserva.** `UNIFORM` consume exactamente un valor del flujo
   pseudoaleatorio, igual que antes de existir esta opción, así que una corrida archivada sin
   distribuciones se reproduce idéntica. Las distribuciones viajan en la configuración
   archivada junto a la semilla.

### Reproducibilidad

No se usa `Math.random` ni Faker en el generador de producción:

- `Math.random` no es controlable por el proceso, así que una corrida no se podría repetir.
- Faker es una **dependencia de desarrollo** y su algoritmo puede cambiar entre versiones
  menores, lo que rompería la reproducibilidad de una corrida archivada.

El generador usa Mulberry32 congelado en el repositorio (`GENERATOR_VERSION`). Cada
corrida archiva semilla, configuración, versión del generador, versiones de las
herramientas y una **copia congelada del contrato**.

Faker y fast-check sí se usan —como exige §10— en las pruebas del repositorio:
`qa-lab-generator.spec.ts` (datos sintéticos masivos y propiedades del generador) y
`engine-intermediate-properties.spec.ts` (propiedades sobre el motor real).

### Propiedades verificadas

| Propiedad | Qué afirma |
| --- | --- |
| `INPUT_CONTRACT_ENFORCED` | Una entrada inválida se rechaza; una válida no |
| `OUTPUT_CONTRACT_RESPECTED` | Toda salida obligatoria se produce |
| `OUTPUT_TYPES_MATCH_CONTRACT` | Los tipos devueltos coinciden con lo declarado |
| `NO_INTERMEDIATE_LEAK` | Ninguna intermedia aparece en la salida pública |
| `NO_SENSITIVE_LEAK` | Ningún valor sensible se devuelve tal cual |
| `DETERMINISM` | La misma entrada y versión dan el mismo resultado |

### Contraejemplos mínimos

Cuando una propiedad falla, se guarda el caso **reducido** por delta-debugging: se quitan
campos y se simplifican valores mientras el fallo siga reproduciéndose. Un contraejemplo
de veinte campos no lo depura nadie.

Cada contraejemplo guarda semilla y `replayPath`, y
`POST /v1/qa-lab/counterexamples/{id}/replay` lo vuelve a ejecutar contra la versión que
lo produjo, informando si sigue reproduciéndose.

### PROD excluido

`QA_RUN_PROD_FORBIDDEN`. Una corrida generativa mete miles de ejecuciones sintéticas:
contra producción contaminaría datos y métricas reales.

### Valores de prueba para el simulador

`POST /v1/simulations/{artifactCode}/sample-inputs` reutiliza este mismo generador pero
**no ejecuta ni persiste nada**: devuelve las entradas para que el analista las revise en
el simulador. Son dos necesidades distintas —«pruébame mil casos» y «rellename este
formulario»— y unificarlas obligaría a archivar una corrida de QA cada vez que alguien
quiere un ejemplo.

El contrato se resuelve por el **despliegue** del ambiente pedido, no por el catálogo de
variables: generar contra otro contrato produciría entradas que el simulador rechaza acto
seguido, y el botón sería peor que no tenerlo. `test/e2e/sample-inputs.e2e-spec.ts` fija
esa propiedad pasando lo generado por el simulador real.

| Campo | Efecto |
| --- | --- |
| `environmentCode` | Ambiente seguro; PROD se rechaza con `SIMULATION_PROD_FORBIDDEN` |
| `kind` | `VALID` (por omisión), `BOUNDARY` (al borde del contrato) o `INVALID` |
| `count` | 1–50 casos |
| `seed` | Repetir la semilla devuelta reproduce exactamente los mismos valores |

Un artefacto sin variables de entrada responde `ARTIFACT_HAS_NO_INPUTS` en vez de una
lista de casos vacíos.

Para rellenar un **caso de suite** existe el mismo lote pero por versión:
`POST /v1/qa-lab/versions/{versionId}/sample-inputs`. Aquí no hay ambiente a propósito: la
suite prueba una versión, no un despliegue, y ofrecer el ambiente daría a elegir entre dos
contratos que pueden no coincidir — el caso quedaría guardado contra el equivocado y
fallaría por contrato el día que alguien lo ejecutara. Los dos caminos comparten
`qa-lab/sample-inputs.ts`, de modo que «los valores del simulador» y «los de la suite» no
puedan divergir en la forma.

El **resultado esperado** no se genera. Deducirlo ejecutando el algoritmo convertiría la
prueba en una tautología: el caso pasaría siempre, incluso con el algoritmo mal. Comparar
contra la ejecución real es lo que hacen las corridas del QA Lab, que es otra cosa.

### Ensayar antes de crear

`try` y `sample-inputs` piden un `versionId`, así que sólo saben probar lo ya guardado:
para ver qué calcula una fórmula había que crear el campo, crear su versión y descubrir
ENTONCES que la política de error no era la que se quería. Los cuatro caminos `preview/*`
reciben el borrador entero en el cuerpo y **no persisten nada** —ni campo, ni versión, ni
caso de prueba—.

No son una simulación: comparten el validador de contrato, el resolutor de librerías, el
ejecutor aislado y el generador del QA Lab con el camino que guarda. Un ensayo que se
pareciera al motor en vez de SER el motor daría luz verde a versiones que después el
guardado rechaza. Por eso `preview/try` responde 400 con la MISMA lista de incumplimientos
que devolvería `POST /{fieldId}/versions`.

Dos detalles que no son casuales:

- **Los tres que ejecutan piden los roles de CREAR una versión**, no los de probar una.
  Ejecutar una versión guardada corre código que un autor escribió y el gobierno revisó;
  ensayar corre el código que venga en el cuerpo. Dárselo a quien sólo puede probar sería
  regalarle un intérprete.
- **El ensayo se etiqueta en las métricas como `__preview__`**, no con el código que el
  autor esté tecleando: ese código es una etiqueta de Prometheus, y dejar entrar texto
  libre abriría su cardinalidad a quien pulse el botón.

`outcomes` responde la pregunta que las tres clases de entrada no contestan: **qué
desenlaces del contrato de retorno se alcanzan de verdad**. Genera casos válidos, de
frontera e inválidos, los ejecuta y agrupa por desenlace (`VALID`, `NULL_BY_POLICY`,
`DEFAULTED`, `ERROR:<código>`). Informa además de los declarados que ningún caso alcanzó y
de los que el contrato **no puede producir nunca** —`RETURN_DEFAULT` sin valor por defecto
sobre un retorno nulable pasa la validación y en ejecución propaga el error—. Una cobertura
que sólo enseñara lo cubierto se leería como «probado todo».

---

## 7. API

| Operación | Endpoint |
| --- | --- |
| Valores de prueba para el simulador | `POST /v1/simulations/{artifactCode}/sample-inputs` |
| Valores de prueba de una versión (casos de suite) | `POST /v1/qa-lab/versions/{versionId}/sample-inputs` |
| Catálogo de operaciones visuales | `GET /v1/calculated-fields/operations` |
| Listar / crear campo | `GET` / `POST /v1/calculated-fields` |
| Detalle con versiones | `GET /v1/calculated-fields/{fieldId}` |
| Crear versión | `POST /v1/calculated-fields/{fieldId}/versions` |
| Promover versión | `POST /v1/calculated-fields/versions/{id}/promote` |
| Probar con ejemplo | `POST /v1/calculated-fields/versions/{id}/try` |
| Valores de ejemplo de una versión | `POST /v1/calculated-fields/versions/{id}/sample-inputs` |
| Ejecutar casos declarados | `POST /v1/calculated-fields/versions/{id}/test` |
| Desenlaces que alcanza una versión | `POST /v1/calculated-fields/versions/{id}/outcomes` |
| **Ensayar un borrador** (no persiste nada) | `POST /v1/calculated-fields/preview/try` |
| Valores de ejemplo de un borrador | `POST /v1/calculated-fields/preview/sample-inputs` |
| Casos declarados de un borrador | `POST /v1/calculated-fields/preview/test` |
| Desenlaces que alcanza un borrador | `POST /v1/calculated-fields/preview/outcomes` |
| Catálogo de librerías | `GET /v1/libraries` |
| Preludes implementados | `GET /v1/libraries/preludes` |
| Aprobar librería | `POST /v1/libraries` |
| Propiedades de QA | `GET /v1/qa-lab/properties` |
| Lanzar corrida | `POST /v1/qa-lab/versions/{versionId}/runs` |
| Historial / detalle | `GET /v1/qa-lab/runs[/{runId}]` |
| Reproducir contraejemplo | `POST /v1/qa-lab/counterexamples/{id}/replay` |

---

## 8. Observabilidad (§12)

Métricas Prometheus añadidas:

```
atlas_contract_violations_total{scope,constraint}
atlas_intermediate_variable_events_total{event}        # CREATED | CONSUMED | UNUSED
atlas_missing_required_output_total{artifact_code}
atlas_calculated_field_executions_total{field_code,outcome}
atlas_calculated_field_duration_ms{field_code}
atlas_chained_artifact_depth
atlas_blocked_reference_cycles_total{reason}
atlas_qa_generated_cases_total{outcome}
atlas_qa_counterexamples_total{property}
```

---

## 9. Pruebas

| Archivo | Qué fija |
| --- | --- |
| `test/calculated-fields.spec.ts` | Catálogo, límite de 3 líneas, contrato de retorno, preludes, ejecución |
| `test/qa-lab-generator.spec.ts` | Reproducibilidad, generación por contrato, reducción, Faker |
| `test/graph-calculated-fields.spec.ts` | Enlace grafo→campo: validación, ejecución y traza |
| `test/reference-contract.spec.ts` | Compatibilidad de contratos al encadenar |
| `test/chain-budget.spec.ts` | Límites de cadena: artefactos, tiempo total y tamaño |
| `test/engine-intermediate-properties.spec.ts` | Propiedades del motor con fast-check |
