# ADR-0011 — Ampliación de contratos: variables intermedias, campos calculados y QA generativo

- **Fecha**: 2026-07-30
- **Estado**: Aceptado
- **Ámbito**: `AtlasDecisionEngine` (backend) y `AtlasDecisionEngineFrontend`

Este ADR recoge las decisiones no obvias tomadas al implementar §1–§13 de la ampliación
de contratos. Cada una responde a una alternativa que se descartó por una razón concreta.

---

## D-1 · Las variables intermedias NO cuelgan del catálogo global

**Contexto.** §2.1 exige que una intermedia no aparezca en catálogos generales de
variables reutilizables, sea única dentro del grafo y no se comparta con otros artefactos.

**Alternativa descartada.** Reutilizar `decision_variable_definition` con
`usageType = 'INTERMEDIATE'`. Habría sido el cambio más pequeño: el lector, el escritor,
el compilador y el validador ya recorren esa tabla.

**Decisión.** Tabla propia `decision_intermediate_variable`, con unicidad
`(artifactVersionId, code)` en vez de `(tenantId, code)`.

**Por qué.** Con la alternativa, la intermedia aparecería en el catálogo *por
construcción*: cualquier listado de variables la mostraría y habría que filtrarla en cada
consulta. Un filtro olvidado sería una fuga silenciosa. La tabla propia hace que el
requisito se cumpla por estructura, no por disciplina.

**Consecuencia.** `DependencyDto` rechaza explícitamente `usageType: 'INTERMEDIATE'` con
un mensaje que apunta al mecanismo correcto, en vez de un error de enumeración genérico.

---

## D-2 · La disponibilidad se comprueba por DOMINANCIA, no por alcanzabilidad

**Contexto.** §2.3 obliga a impedir la lectura de una intermedia antes de su creación, y
dice que la disponibilidad debe calcularse en la validación estática.

**Alternativa descartada.** Comprobar que exista *algún* camino desde el productor hasta
el lector (alcanzabilidad simple).

**Decisión.** Calcular los dominadores del grafo por iteración de punto fijo y exigir que
el productor domine al lector.

**Por qué.** La alternativa acepta este grafo, que falla en producción una de cada dos
ejecuciones:

```
START ──> CALC (crea dti) ──┐
   └────> OTRA ─────────────┴──> USA (lee dti)
```

Existe un camino que pasa por CALC, pero no todos. Solo la dominancia responde a la
pregunta correcta: *¿está siempre creada cuando llego aquí?*

**Consecuencia.** Un nodo inalcanzable tiene conjunto de dominadores vacío, de modo que
sus lecturas nunca se dan por cubiertas accidentalmente.

---

## D-3 · El ámbito de intermedias vive en el estado de la ejecución, no en el servicio

**Contexto.** §2.1 exige que una intermedia no se reutilice entre ejecuciones y desaparezca
al terminar o fallar.

**Decisión.** `IntermediateScope` se instancia dentro de `execute()` y se referencia desde
`MutableExecutionState`.

**Por qué.** `ExecutionEngineService` es un singleton de Nest compartido por todas las
peticiones. Un campo de instancia habría hecho que una intermedia sobreviviera a su
ejecución y se filtrara entre solicitudes concurrentes — exactamente lo que el requisito
prohíbe. Al vivir en el estado, la garantía es estructural: no hay dónde persistir.

---

## D-4 · La vista legible de intermedias usa getters

**Decisión.** `readableView()` define cada código como un getter en vez de copiar valores.

**Por qué.** El contexto de expresión se construye muchas veces por nodo. Copiando valores,
marcar "consumida" habría marcado a todo nodo para el que se construyó un contexto,
aunque su expresión no leyera la variable. La lista de nodos consumidores de §3.1 habría
sido ruido. Con getters, solo el acceso real registra consumo.

---

## D-5 · El contrato de salida explícito coexiste con las dependencias OUTPUT

**Contexto.** §4 pide un contrato de salida con origen, mapeo, motivos de ausencia y
ejemplos. Ese metadato no cabe en la dependencia de variable actual.

**Alternativa descartada.** Mover tipo y obligatoriedad al nuevo modelo y dejar de usar
las dependencias `OUTPUT`.

**Decisión.** `decision_output_contract_field` es autoritativa para **gobierno y origen**;
la dependencia `OUTPUT`/`OUTPUT_PRIMARY` sigue siendo autoritativa para **tipo y
obligatoriedad**. La validación exige correspondencia 1:1.

**Por qué.** El motor ya resuelve, valida y compila desde las dependencias. Duplicar el
tipo en dos tablas habría creado la posibilidad de que discrepasen, y el motor tendría que
elegir cuál creer. Una sola fuente por dimensión evita el problema.

**Consecuencia.** El contrato explícito es opcional: sin él, el artefacto valida con una
advertencia. Nada de lo ya publicado se rompe.

---

## D-6 · El registro de librerías solo habilita preludes ya presentes en el repositorio

**Contexto.** §7 pide un registro de librerías aprobadas con paquete real, versión exacta
y funciones permitidas.

**Alternativa descartada.** Guardar en la base de datos el código o el nombre del paquete
npm/pip a importar.

**Decisión.** El código de cada librería vive en `library-preludes.ts`. Una fila solo
puede habilitar un prelude existente; el servicio rechaza lo demás.

**Por qué.** Si una fila pudiera aportar código, aprobar una librería sería equivalente a
inyectar código en el sandbox: quien tuviera permiso de escritura sobre esa tabla tendría
ejecución arbitraria. El registro dejaría de ser un control de seguridad para convertirse
en un vector. Con esta decisión, aprobar una librería es una operación de configuración;
añadir una capacidad nueva es un cambio de código revisado.

**Consecuencia.** Añadir una librería requiere un despliegue. Es el coste aceptado a
cambio de que el conjunto de código ejecutable sea siempre el revisado.

---

## D-7 · Python ejecuta con un único diccionario como globals y locals

**Contexto.** Los preludes definen funciones auxiliares que se llaman entre sí.

**Decisión.** Cambiar `exec(code, {'__builtins__': safe}, scope)` por
`scope['__builtins__'] = safe; exec(code, scope)`.

**Por qué.** Con globals y locals separados, una función definida por el script queda en
locals y su cuerpo no la ve al ejecutarse (busca en globals), así que cualquier helper que
llame a otro helper falla con `NameError`. Los builtins restringidos siguen siendo los
mismos, de modo que el cambio no relaja la seguridad: corrige un fallo latente que también
afectaba a los scripts de nodo.

---

## D-8 · Las funciones de librería en Python usan prefijo plano

**Decisión.** `math_abs` en Python frente a `math.abs` en JavaScript.

**Por qué.** El runner de Python prohíbe `class` y el acceso a atributos dunder. Un
espacio de nombres con puntos exigiría una clase o un objeto, y no sobreviviría al análisis
estático del propio sandbox. Se prefiere una asimetría visible y documentada antes que
relajar el sandbox.

---

## D-9 · El generador de QA no usa Faker en producción

**Contexto.** §10 pide Faker y fast-check, y también reproducibilidad exacta de cada
corrida archivada.

**Decisión.** El generador en línea usa un Mulberry32 congelado en el repositorio. Faker y
fast-check son dependencias de **desarrollo** y alimentan las pruebas.

**Por qué.** Faker es una dependencia de desarrollo cuyo algoritmo puede cambiar entre
versiones menores. Una corrida archivada con semilla dejaría de reproducirse tras un
`yarn upgrade`, que es justo la garantía que §10.5 exige. `Math.random` es todavía peor:
no es controlable por el proceso.

**Consecuencia.** La corrida registra igualmente las versiones de Faker y fast-check
instaladas, porque forman parte del conjunto de herramientas declarado.

---

## D-10 · El límite de tres líneas cuenta sentencias, no saltos de línea

**Decisión.** Además de contar líneas ejecutables (sin comentarios ni vacías), se cuentan
las sentencias separadas por `;`.

**Por qué.** `const a=1; const b=2; const c=3; const d=4; return d;` es una línea y cinco
sentencias. Sin esta comprobación, el límite de §6.2 sería decorativo y la frontera entre
campo calculado y artefacto dejaría de existir.

---

## D-11 · `referenceRoot` conserva el código completo para `intermediate.*`

**Decisión.** Para `intermediate.dti`, el extractor de referencias devuelve
`intermediate.dti`, no `intermediate`.

**Por qué.** El comportamiento anterior devolvía el primer segmento, con lo que el
validador solo veía la palabra "intermediate" y no podía comprobar *qué* variable se
estaba leyendo. Lo detectó `contract-demo-seed.spec.ts` al validar el grafo del demo.

---

## D-12 · `PERCENTAGE` valida el rango en la comprobación de forma

**Decisión.** Un `PERCENTAGE` fuera de `[0, 100]` falla la comprobación de tipo, no solo
una restricción opcional.

**Por qué.** El error real que esto atrapa es de escalado: `0.42` en vez de `42`. Un valor
así pasa cualquier validación de "es un número" y produce decisiones silenciosamente
erróneas. Convertirlo en un error de tipo lo hace imposible de ignorar.

---

## D-13 · El frontend valida, pero nunca decide

**Decisión.** `src/contracts/constraints.ts` reproduce las reglas del motor para dar
feedback inmediato, y cada componente lo dice en su texto de ayuda.

**Por qué.** Sin feedback local, configurar una restricción exige guardar y esperar el
rechazo del servidor. Con él, el riesgo es que las dos implementaciones se separen. Se
acota así: el backend reevalúa siempre; una discrepancia produce un aviso engañoso, nunca
una validación omitida. `contracts.test.ts` fija la equivalencia de tipos y reglas.

---

## D-14 · El panel de estado enmascara de nuevo en el cliente

**Decisión.** `NodeVariableStatePanel` sustituye por `•••` el valor de cualquier variable
cuya clase sea `PII`, `SENSITIVE_PII` o `SECRET`, aunque el backend haya enviado el valor.

**Por qué.** Defensa en profundidad: el backend ya aplica `tracePolicy`, pero un contrato
mal configurado (sensible + traza `FULL`, que solo genera advertencia) no debe traducirse
en un dato personal pintado en pantalla.

---

## D-15 · La definición del campo calculado viaja EMBEBIDA en el artefacto compilado

**Contexto.** §5.1 exige que un campo calculado pueda usarse desde más de un artefacto.
Hacía falta decidir cómo lo obtiene el motor en ejecución.

**Alternativa descartada.** Consultar la versión del campo en la base de datos en cada
decisión, o inyectar el módulo de campos calculados en el motor de grafo.

**Decisión.** Al guardar el grafo, el backend resuelve la versión y **congela la
definición ejecutable dentro del nodo compilado**. El motor la ejecuta sin tocar la base.

**Por qué.** Tres razones, en orden de peso:

1. **Reproducibilidad.** El artefacto compilado ya contiene variables, condiciones y
   acciones congeladas. Si el cálculo se leyera en vivo, una decisión archivada dejaría de
   poder reproducirse en cuanto el campo se deprecara o se republicara.
2. **Sin ciclo de módulos.** `CalculatedFieldsModule` depende de `GraphModule` por el
   sandbox. Inyectarlo al revés habría cerrado el ciclo. La parte pura vive en
   `calculated-field-runtime.ts`, que no importa nada de `graph/`.
3. **Coste por decisión.** Una consulta por invocación en la ruta caliente de una decisión
   online no se justifica para un dato inmutable.

**Consecuencia.** Cambiar un campo calculado NO afecta a los artefactos ya guardados:
hay que volver a guardar el grafo para adoptar la versión nueva. Es el comportamiento
correcto —el mismo que ya rige para las referencias entre artefactos— pero conviene
tenerlo presente.

---

## D-16 · El cliente nunca aporta la definición ejecutable

**Decisión.** `PUT /graph` acepta `calculatedFieldVersionId` y el mapeo; el backend
resuelve el resto (`CalculatedFieldBindingService`).

**Por qué.** Si el `config` del nodo pudiera traer `definition.sourceCode`, guardar un
grafo sería una vía para ejecutar código arbitrario en el sandbox saltándose por completo
el registro de campos calculados, su límite de tres líneas y su ciclo de aprobación. El
adaptador del frontend lo refleja: recorta `definition` y `contractInputs` antes de
enviar, y una prueba lo fija.

**Consecuencia.** Solo se pueden invocar versiones `APPROVED` o `PUBLISHED`, y una
librería `BLOCKED` bloquea el guardado.

---

## D-17 · La versión 1 de una variable pertenece al seeder

**Contexto.** El catálogo declaraba `fraud_score` como anulable y la fila de la base decía
lo contrario, así que toda decisión declinada en KYC moría con `REQUIRED_OUTPUT_MISSING`.

**Decisión.** `ensureVariable` refresca la versión 1 con el catálogo del repositorio, en
vez de salir antes si la fila ya existe.

**Por qué.** La versión 1 la crea y la posee el seeder: la API siempre crea versiones
NUEVAS y nunca edita la 1. Sin este refresco, cualquier corrección del catálogo se quedaba
sin llegar a una base ya sembrada, para siempre. El desfase no era teórico: costó una
ejecución rota que solo apareció en la prueba e2e.

---

## D-18 · El presupuesto de cadena acompaña a la ejecución raíz

**Contexto.** §9.3 pide limitar profundidad, cantidad de artefactos, tiempo total, tiempo
por artefacto y tamaño de resultados. Solo estaban los dos primeros.

**Decisión.** Un `ChainBudget` creado una vez por ejecución raíz y compartido por todos
los saltos. Cada salto consume una invocación, y su timeout se recorta a lo que le queda a
la cadena.

**Por qué.** Acotar solo cada salto deja pasar lo que de verdad tumba un motor: una cadena
de profundidad 3 puede abrir cincuenta artefactos en abanico o sumar un minuto entre
saltos que individualmente parecen rápidos.

---

## D-19 · Un nodo que falla también deja traza

**Decisión.** El motor empuja un paso de traza con `status: 'ERROR'` y el código del fallo
antes de propagar la excepción.

**Por qué.** El comportamiento anterior dejaba fuera de la traza justo el nodo que rompió
la decisión: quedaba un hueco donde más falta hace la evidencia. Ahora ese paso incluye
además el estado de las variables en el momento del fallo, que es lo que permite
entenderlo sin reproducirlo.

---

## D-20 · Las salidas implícitas del motor cuentan como salidas del hijo

**Decisión.** `outcome`, `score`, `riskBand` y `limit` se aceptan siempre al mapear la
salida de un artefacto referenciado.

**Por qué.** El motor las añade al sobre de salida en toda ejecución, declare o no el
artefacto una variable con ese nombre. El caso más común —un hijo que solo fija `outcome`
con una acción terminal— quedaba rechazado con `REFERENCE_OUTPUT_UNKNOWN`. Lo detectó la
prueba e2e de árboles anidados.
