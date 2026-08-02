# Pendientes de la ampliación de contratos — y reparto entre agentes

**Última actualización:** 2026-07-31. Toda la lista P-1…P-9 está cerrada; lo último fueron
los valores de prueba (simulador y casos de suite) y la revisión de suites inestables.
Con P-1, P-2, P-5 y P-9 ya cerrados antes, **no queda ningún pendiente de la lista**.
**Estado del árbol, con salida real:** backend `format:check` + `typecheck` + `build`
limpios, **81 suites / 648 pruebas / 2 saltadas** y **12 suites e2e / 62 pruebas**;
frontend `format:check`, `lint`, `verify:source` (482 ficheros), `typecheck`,
**494 pruebas** y `next build` correctos.

Este documento existe porque hay **dos agentes trabajando sobre el mismo árbol**. Sirve
para dos cosas: dejar la lista real de lo que falta frente al pliego, y fijar quién toca
qué para que no colisionemos.

---

## 0. Reparto de trabajo (leer antes de tocar nada)

Los cambios recientes muestran dos líneas de trabajo distintas y compatibles:

| Agente | Ámbito | Evidencia de su trabajo |
| --- | --- | --- |
| **A — Seguridad, robustez y accesibilidad** | Escapes de sandbox, consultas sin cota, auditoría de fallos, foco de diálogos, contraste, tutoriales | `test/sidecar-sandbox-escape.spec.ts`, `test/dependency-graph-bounded.spec.ts`, `test/runtime-failed-audit.spec.ts`, `MISSING_DATA_ERROR_CODES`; en frontend `hooks/useDialogFocus.ts`, `theme/theme-contrast.test.ts`, `features/tutorial/*`, `features/objectives/*` |
| **B — Pliego de contratos** | §1–§13: variables, intermedias, contrato de salida, campos calculados, librerías, encadenamiento, QA Lab | `common/contracts/`, `modules/calculated-fields/`, `modules/libraries/`, `modules/qa-lab/`, `graph/intermediate-scope.ts`, validadores nuevos |

### Ficheros de frontera (los tocan los dos)

Cambiar estos exige releer el fichero entero antes de editar, porque el otro agente
probablemente lo ha modificado desde la última vez:

- `src/modules/graph/execution-engine.service.ts`
- `src/modules/graph/script-node-runner.service.ts` y `runner/server.mjs`
- `src/modules/calculated-fields/calculated-field-runtime.ts`
- `src/modules/nested-trees/nested-tree.service.ts`
- `src/modules/variables/variable-resolution.service.ts`
- `prisma/schema.prisma` (una migración por agente, nunca editar la del otro)

### ✅ Bloqueante cerrado (era del agente A)

`e2e/contrast.spec.ts` estaba en **328 líneas** frente al límite de 299 y rompía
`verify:source` del frontend. Ya está partido y **verificado con salida real**:
`Source verification passed for 474 files: every portal route has an access rule and every
CSS token resolves.`

`ObjectiveCreateDialog.tsx`, que estaba en 303 líneas en la revisión anterior, **ya está
corregido** por el agente A.

Todo lo demás está verde: lint sin avisos, typecheck limpio, build correcto, 444 pruebas
de frontend y 543 + 69 + 58 de backend.

### Cambios del agente A ya integrados y verificados

- **`MISSING_DATA_ERROR_CODES`** acota qué errores puede absorber la política
  `missingData` de un campo calculado. Es estrictamente mejor que la versión anterior
  (que solo excluía `CALCULATED_FIELD_INPUT_INVALID`): un sandbox caído o un timeout ya
  no se convierten en «devuelve el valor por defecto», que habría transformado una avería
  en una decisión de crédito silenciosamente incorrecta. **No revertir.**
- **Escape del vm en el sidecar** y **grafo de dependencias acotado**: ambos verificados
  contra la suite completa del pliego; ninguna prueba de contratos se ve afectada.

### Aviso sobre `sidecar-concurrency.spec.ts`: una aserción estable pero vacía

La aserción de concurrencia se cambió (con buen motivo) porque la original comparaba tiempos
de pared contra una medición aparte y fallaba bajo carga sin que hubiera regresión. El
reemplazo —`max(inicios) < min(finales)`— es estable pero **no distingue nada**: las cuatro
llamadas se emiten síncronamente desde el `Array.from`, así que todos los inicios son el mismo
instante y la comparación solo afirma que se enviaron antes de recibir la primera respuesta,
que es cierto por construcción.

Comprobado contra el runner real con `RUNNER_MAX_CONCURRENCY=1`: **la aserción PASA igual**,
es decir, no habría detectado una vuelta a `spawnSync` — justo la regresión que existe para
vigilar.

Repuesta comparando dos magnitudes de la MISMA corrida (dispersión de los finales frente a la
duración de una), de modo que la velocidad del equipo se cancela y no vuelve la fragilidad.
Medido: en serie `spread=635ms` vs `una=290ms` (FALLA); concurrente `spread=73ms` vs
`una=409ms` (PASA).

**Regla que deja esto:** al desflakear una prueba de tiempo, verificar que la nueva aserción
sigue fallando con el comportamiento que vigila. Una prueba verde que no puede ponerse roja es
peor que ninguna, porque además da confianza.

### Hallazgo del agente A sobre el orquestador de trabajos (ya corregido)

Auditando la superficie nueva de trabajos de fondo apareció un defecto acotado en
`JobSchedulerService.runNow`. La clase promete explícitamente que «dentro de un proceso no
hay dos ejecuciones simultáneas del mismo trabajo», pero `runNow` esperaba a `inFlight` sin
**ocupar** la ranura ni cancelar el temporizador pendiente, así que un ciclo agendado podía
arrancar el MISMO trabajo en paralelo. Medido con una sonda: dos ejecuciones vivas a la vez.

Con lotes reclamados por `FOR UPDATE SKIP LOCKED` no corrompe datos, pero duplica trabajo,
vuelve intermitente cualquier prueba que use `runNow` y dejaba escrita una garantía que no se
cumplía — y el comentario de la clase anticipa «un futuro endpoint de operación que fuerce un
ciclo», que es donde sí importaría.

Corregido ocupando la ranura y **reponiendo el temporizador al terminar**: sin eso, una
ejecución manual dejaba el trabajo sin sondear el resto de la vida del proceso. La regresión
vive en `test/job-scheduler-mutual-exclusion.spec.ts`, fichero aparte a propósito para no
competir con `job-scheduler.spec.ts` mientras la feature sigue en curso.

---

## 1. Pendientes reales frente al pliego

Ordenados por impacto. Cada uno indica qué exige el pliego, qué hay hoy y qué falta.

### ~~Fuera de lista · Valores de prueba en el simulador y en los casos de suite~~ — **CERRADO** (agente B)

Petición directa del usuario, no del pliego: un botón que pida al backend valores de
prueba, y como alternativa poder subir un JSON o un CSV.

- **Backend:** `POST /v1/simulations/{artifactCode}/sample-inputs`
  (`runtime/sample-input.service.ts`) reutiliza el generador del QA Lab **sin ejecutar ni
  persistir**. Resuelve el contrato por el despliegue del ambiente, admite
  `VALID`/`BOUNDARY`/`INVALID`, 1–50 casos y semilla reproducible; PROD se rechaza.
- **Frontend:** `features/simulator/SimulatorSampleBar.tsx` (botón + carga de archivo +
  selector de casos) y `features/simulator/sample-import.ts` (lector de JSON/CSV con
  comillas, separador `;` y coma decimal, y conversión al tipo declarado).
- **Casos de suite:** `POST /v1/qa-lab/versions/{versionId}/sample-inputs` hace lo mismo
  tomando el contrato de la **versión compilada**, porque una suite prueba una versión y no
  un despliegue: ofrecer el ambiente daría a elegir entre dos contratos que pueden no
  coincidir. Los dos caminos comparten `qa-lab/sample-inputs.ts`. El botón vive en
  `testing/GenerateCaseInputButton.tsx`; el **resultado esperado no se genera** —deducirlo
  ejecutando el algoritmo haría que el caso pasara siempre—.
- **Pruebas:** `test/sample-input.service.spec.ts` (6), `test/qa-lab-sample-inputs.spec.ts`
  (4), `test/e2e/sample-inputs.e2e-spec.ts` (4, incluida la ida y vuelta generar → simular
  sin error de contrato), `sample-import.test.ts` (13), `SimulatorSampleBar.test.tsx` (6) y
  `GenerateCaseInputButton.test.tsx` (4).

### ~~P-1 · Seeders sin escenarios negativos (§11)~~ — **CERRADO**

`governance-scenarios.seed.ts` siembra los cuatro escenarios. Los tres primeros son
RECHAZOS, así que lo que se siembra es el **escenario que los provoca**, y
`governance-scenarios.integration.spec.ts` demuestra contra los servicios reales que cada
uno se rechaza con su código:

| Escenario | Rechazo verificado |
| --- | --- |
| Ciclo detectado | `CIRCULAR_ARTIFACT_REFERENCE` |
| Versión no disponible | `CHILD_VERSION_NOT_COMPILED` |
| Contrato incompatible | `VARIABLE_CONTRACT_INCOMPATIBLE` (y `WIDENING` al ampliarlo) |
| Caso de QA | Corrida archivada con contraejemplo mínimo y semilla reproducible |

El hijo del ciclo tiene una **segunda versión en DRAFT**: solo un borrador es editable, y
sin ella el escenario fallaba por `VERSION_IMMUTABLE` sin llegar a ejercitar el ciclo.
La siembra es idempotente y hay una prueba que lo fija.

### ~~P-2 · Las opciones de referencia de §9 no están en la UI~~ — **CERRADO**

`ReferencePolicyFields.tsx` expone los seis campos (ambiente, selección de versión,
reintentos y espera, obligatoriedad, política de traza y condición de ejecución) dentro
del editor de referencias. El modelo de formulario valida en cliente las dos reglas que
el backend también impone —PROD exige versión exacta; una referencia opcional no puede
tener política `FAIL`— para que el autor no las descubra tras rellenar todo el mapeo.
Ocho pruebas nuevas en `reference-authoring.test.ts`.

### ~~P-3 · El alta de variable no usa los campos de §1.1~~ — **CERRADO** (agente B)

`resource.create-fields.ts` pide ya en el **alta** las restricciones, el mensaje de
validación, los dos ejemplos, el origen esperado y la unidad. Todos opcionales: el alta
rápida sigue siendo posible, pero el contrato completo ya cabe sin volver a editar.

El nudo era de tipos, no de formulario: los ejemplos y las restricciones **no son cadenas**,
y el formulario solo sabía enviar texto — un `exampleValid` de una variable numérica llegaba
como `"2500.5"` y el backend lo rechazaba por tipo. Se añadió el género de campo `json`
(`CreateFieldKind`), que envía el valor con su tipo real y **acepta texto suelto como cadena**
sin obligar a entrecomillar, porque es lo que un analista escribe para una variable de texto.
Un JSON a medias (`{"min":`) sí se rechaza **antes de enviar**: el backend respondería 422 sin
decir qué campo lo rompió y se perdería todo lo escrito.

El origen esperado es un `select` de enumeración cerrada y no un catálogo de base de datos,
porque un input libre dejaría escribir un valor que el backend rechaza al final del formulario.

Pruebas: 8 nuevas en `resource-create.test.ts`.

### ~~P-4 · «Momento de creación» de una variable intermedia (§3.1)~~ — **CERRADO** (agente B)

`IntermediateStateEntry.createdAtStepIndex` trae el índice (base 0) del paso de la **misma
traza** que le dio valor por primera vez. El motor fija el paso en el ámbito
(`IntermediateScope.enterStep`) al entrar en cada nodo: el ámbito no puede deducirlo porque
quien lleva el recorrido es el motor.

Tres decisiones que hacen que el dato sirva para reconstruir el razonamiento:

- Una **reescritura** (`OVERWRITE`/`ACCUMULATE`) no mueve el índice. Moverlo lo desplazaría
  hacia delante justo en las trazas largas, que son las únicas donde hace falta.
- **Ausente** cubre dos casos que no son el mismo y por eso no se colapsan en un `0`: la
  variable sigue en `NOT_AVAILABLE`, o nació con `initialValue` y existía antes del paso 0.
- Es un **índice y no una marca de tiempo**: un reloj haría que dos ejecuciones idénticas
  produjeran trazas distintas, y el motor promete lo contrario.

La UI lo muestra en `NodeVariableStatePanel` como «paso N+1», en base 1 para que coincida con
la numeración de la traza que el analista está leyendo.

Pruebas: 3 en `intermediate-scope.spec.ts` (creación, reescritura que no mueve el índice,
valor inicial sin fechar), 1 en `engine-intermediate-properties.spec.ts` que fija que el
índice apunta al paso REAL de la traza, y 1 en `contract-authoring.test.tsx`.

### ~~P-5 · Límites de §9.3 sin cubrir: memoria~~ — **CERRADO** (agente A)

Se cerró decidiendo primero **cómo medir**, que era el nudo. Leer el montículo
(`process.memoryUsage()`) queda descartado: es de todo el proceso y depende del recolector
y de las peticiones vecinas, así que una decisión pasaría o fallaría por motivos ajenos a
sus datos — dejaría de ser reproducible. Lo determinista, y lo que crece de verdad, es lo
que la cadena **retiene**: cada entrada de la traza anidada conserva su `output`.

Dos mitades, ambas medidas antes de fijar los valores:

1. **Acumulado de la cadena** — `maxRetainedBytes` (1 MiB por defecto,
   `NESTED_TREE_MAX_RETAINED_BYTES`). El tope por resultado no bastaba: 25 saltos de 256 KiB
   pasan uno a uno y dejan 6,4 MiB retenidos. `assertResultSize` pasó a ser `consumeResult`,
   que cobra ambas cotas en ese orden — un resultado desmesurado debe decir que lo ES y no
   que faltó memoria, o el autor no sabe qué salto arreglar.
2. **Memoria por proceso de script** — el runner de JS ya recibía `--max-old-space-size`;
   el de Python **no tenía ninguna**, y desde que el sidecar atiende varias ejecuciones a la
   vez eso permitía que un script se llevara por delante las de otros tenants. Ahora aplica
   `RLIMIT_AS` (`SCRIPT_NODE_MAX_MEMORY_MB`, 32 MiB) en los dos wrappers, con `except
   ImportError` porque en Windows no existe `resource`. Comprobado con el wrapper real en
   Linux sobre `list(range(60_000_000))` (solo builtins permitidos): **con la cota** muere
   con `MemoryError` y falla solo ese script; **sin ella** el kernel responde `Killed` tras
   agotar el contenedor entero. A 32 MiB un script normal corre igual (probado hasta 16 MiB).

Pruebas: `chain-budget.spec.ts` (acumulado, orden de los errores, no cobrar lo rechazado) y
`sidecar-sandbox-escape.spec.ts` (la cota está en ambos runners y el valor llega al wrapper).

### ~~P-6 · Distribución de valores en el QA Lab (§10.4)~~ — **CERRADO** (agente B)

`distributions` en `POST /v1/qa-lab/versions/{id}/runs` sesga dónde caen los valores de una
variable: `shape` (`UNIFORM`, `LOW_TAIL`, `HIGH_TAIL`, `CENTERED`, `EXTREMES`) para rangos y
`valueWeights` para enumeraciones y booleanos.

El catálogo de formas es **cerrado**, como el de operaciones de los campos calculados: una
corrida archivada debe poder reejecutarse años después, y eso exige que la forma sea un nombre
estable del repositorio y no una función que el usuario escriba.

Tres garantías que lo mantienen siendo QA:

1. **No relaja el contrato.** Sesgar cambia dónde caen los valores, nunca produce uno que las
   restricciones prohíban (probado con fast-check sobre las cinco formas).
2. **Una variable ajena al contrato se rechaza** (`QA_DISTRIBUTION_VARIABLE_UNKNOWN`) en vez de
   ignorarse. Una distribución que no se aplica no da error en ninguna parte: la corrida saldría
   verde, uniforme y con el nombre de un sesgo que nunca ocurrió.
3. **La reproducibilidad se conserva.** `UNIFORM` consume exactamente un valor del flujo
   pseudoaleatorio, igual que antes, así que **una corrida archivada sin distribuciones se
   reproduce bit a bit** — hay una prueba que lo fija. `GENERATOR_VERSION` sube a 1.1.0 y las
   distribuciones viajan en la configuración archivada junto a la semilla.

Pruebas: 7 nuevas en `qa-lab-generator.spec.ts`.

### ~~P-7 · Documentación de la frontera completa (§8)~~ — **CERRADO** (agente B)

`docs/calculated-fields.md` §1 añade «La frontera con el nodo, la regla y el flujo», con la
tabla de las cuatro piezas (qué produce cada una, si decide el camino, si se reutiliza, dónde
vive) y tres apartados que explican la consecuencia práctica de cada confusión: un campo no
tiene posición en el grafo y solo ve sus entradas mapeadas; escribir como campo lo que es regla
pierde la trazabilidad de rama (`branchTaken`, ramas descartadas); y una «función» que necesita
varias etapas o evidencia propia es un artefacto referenciado, no un campo más largo.

### ~~P-8 · Runbooks y diagramas (§15)~~ — **CERRADO** (agente B)

Tres runbooks nuevos, cada uno enlazado desde `docs/runbooks/README.md` a su manual:

| Runbook | Cubre |
| --- | --- |
| `CONTRATOS_DE_VARIABLES.md` | Picos de `VARIABLE_MISSING_OR_INVALID`, `VARIABLE_CONTRACT_INCOMPATIBLE`, intermedias en `INVALID`, campo que falta en la respuesta |
| `CAMPOS_CALCULADOS.md` | Runner caído o saturado, cotas de memoria, `NESTED_TREE_MEMORY_EXCEEDED`, publicación bloqueada, habilitar una librería |
| `QA_LAB.md` | Reproducir un contraejemplo, corridas que no prueban lo que importa, timeouts, cambio de `GENERATOR_VERSION` |

Dos diagramas nuevos, con `MANIFEST.sha256` y el README del paquete actualizados:
`23_taxonomia_variables_y_contratos.puml` (catálogo global frente a ámbito de ejecución, y por
qué la intermedia no cuelga del catálogo) y `24_ciclo_vida_variable_intermedia.puml` (la
máquina de estados completa, incluido dónde se fija `createdAtStepIndex`).

### ~~P-9 · Métrica de diferencias DEV/PROD (§12)~~ — **CERRADO** (agente A)

La decisión pendiente era la semántica de «dos ejecuciones equivalentes entre ambientes».
**Queda fijada así:** solo está bien definido si se fija todo menos el ambiente, de modo que
la comparación **reutiliza los valores ya resueltos** de la simulación en vez de resolverlos
otra vez. Si cada lado resolviera los suyos, una diferencia podría venir de un valor por
defecto o de un proveedor externo, y la métrica dejaría de medir lo que dice medir. Fijadas
las entradas y siendo el motor determinista, lo único que varía es el artefacto compilado
que cada ambiente tiene desplegado — que es exactamente la desviación que §12 busca.

- **Cómo se activa:** `compareWithProduction: true` en `POST /v1/simulations/{code}`. Es
  opcional porque duplica el coste, y esa decisión es de quien lanza la simulación.
- **Qué devuelve:** un bloque `productionComparison` con `differences` entre `OUTCOME`,
  `OUTPUT` y `REASON_CODES` (comparados de forma canónica, así que reordenar claves no es
  una divergencia). Nada se persiste: es una segunda pasada del motor en memoria.
- **Métrica:** `atlas_dev_prod_result_diff_total{artifact_code, difference}`. Cuenta también
  los `NONE`, porque sin denominador la tasa de divergencia no se puede leer.
- **PROD sin desplegar** se informa como `PRODUCTION_NOT_DEPLOYED` y **no** tumba la
  simulación: lo contrario dejaría la herramienta inservible justo en el artefacto que aún no
  ha salido a producción, que es cuando más se simula.

Pruebas: `simulation.service.spec.ts` (§12) — incluida la que fija que las entradas se
resuelven una sola vez y las dos pasadas reciben el mismo objeto.

---

## 2. Fuera de alcance, por decisión explícita

No son olvidos. Se dejaron fuera con una razón, y ampliarlos es decisión del responsable
del producto:

| Tema | Por qué no |
| --- | --- |
| Pruebas de carga y estrés sostenidas (§10.6) | El QA Lab ejecuta lotes concurrentes acotados, pero un arnés tipo k6/Gatling con umbrales de SLO es una pieza de infraestructura aparte |
| Librerías de terceros (numpy, pandas…) | El registro está listo; añadir una exige escribir y revisar su prelude, que **es** el control que pide §7. Aprobar una sin eso vaciaría el control de sentido |
| Encadenamiento asíncrono (§9) | El pliego lo marca como «cuando esté soportado». Las referencias siguen siendo síncronas |
| Restricciones acotadas sembradas | El motor evalúa `byCountry`/`byProduct`/`byEnvironment`/`byTenant` y está probado, pero el catálogo sembrado no usa todavía ningún tramo |

---

## 3. Sugerencia de reparto para lo que queda

Para no pisarnos, propongo esta división por **ficheros**, no por temas:

| Pendiente | Agente | Ficheros que tocó |
| --- | --- | --- |
| ~~P-1 seeders negativos~~ | B — hecho | `seeding/data/governance-scenarios.seed.ts` |
| ~~P-2 UI de referencias~~ | B — hecho | `features/graph-editor/ReferencePolicyFields.tsx` |
| ~~P-3 alta de variable~~ | B — hecho | `resources/resource.create-fields.ts`, `resource-create.ts`, `resource.types.ts`, `ResourceCreateForm.tsx` |
| ~~P-4 momento de creación~~ | B — hecho | `graph/intermediate-scope.ts`, `graph.types.ts`, `execution-engine.service.ts`, `NodeVariableStatePanel.tsx` |
| ~~P-5 límite de memoria~~ | A — hecho | `nested-trees/chain-budget.ts`, `script-node-runner.service.ts`, `runner/server.mjs` |
| ~~P-6 distribución QA~~ | B — hecho | `qa-lab/contract-generator.ts`, `seeded-random.ts`, `qa-lab.dto.ts`, `qa-lab.service.ts` |
| ~~P-7, P-8 documentación~~ | B — hecho | `docs/calculated-fields.md`, `docs/runbooks/*`, `docs/plantuml/23`–`24` |
| ~~P-9 métrica DEV/PROD~~ | A — hecho | `observability/metrics.service.ts`, `runtime/simulation.service.ts` — semántica decidida y documentada arriba |

Regla de convivencia: **una migración de Prisma por agente y nunca editar la del otro**;
si ambos necesitan tocar `schema.prisma`, el segundo relee el fichero antes de escribir.
Ninguno de los pendientes cerrados en esta tanda necesitó migración: `createdAtStepIndex`
viaja dentro del JSON de la traza y las distribuciones dentro de `configJson` de la corrida.

## 4. Lo único que sigue abierto

Nada de la lista. Fuera de ella queda lo del apartado 2, que es decisión de producto.

### Inestabilidad de las suites: revisada y cerrada

Se comprobó una a una, y el diagnóstico cambia según CÓMO se invoque cada suite:

- **Frontend — era real.** `yarn test` usa vitest, que **sí** paraleliza, así que el plazo
  por omisión de 1 s de `findBy*`/`waitFor` se agotaba por contención de CPU y no por el
  código (`calculated-field-calls.test.tsx` tarda ~0,7 s ella sola: iba al borde). Se subió
  a 5 s en `src/test/setup.ts`, para **todas** las suites y no sólo la que falló. Un plazo
  más largo no puede convertir un fallo real en aprobado; sólo evita declararlo antes de
  tiempo.
- **Frontend — había un segundo error, mío.** Subir sólo `asyncUtilTimeout` no bastaba: el
  presupuesto de una prueba en vitest es también 5 s por omisión, así que una prueba con
  varias esperas agotaba SU presupuesto antes de que ninguna espera se rindiera, y el fallo
  pasaba de «esto nunca apareció» —que señala el problema— a «la prueba tardó demasiado»,
  que no señala nada. Los dos plazos van juntos y el de la prueba tiene que ser
  holgadamente mayor: `testTimeout`/`hookTimeout` a 20 s en `vitest.config.ts`.
- **Backend — no aplica al gate.** `yarn test` es `jest --runInBand`. `sidecar-concurrency`
  y `outbox-notifications.integration` sólo fallan si se invoca `npx jest` **sin**
  `--runInBand`, porque varios workers se pelean por la CPU y por las mismas filas. En su
  forma real el gate pasa entero (82 suites, 655 pruebas). Conviene no invocar jest a mano
  en paralelo y creerse el resultado: no es la configuración que se verifica.

### Lo que se vio en el trabajo en vuelo del agente A — ya resuelto por ellos

Durante la verificación, el relay por *lease* de `outbox-relay.service.ts` fallaba en
integración («no existe la fila que voy a actualizar») y sus pruebas no compilaban: el
constructor había ganado un parámetro. Lo dejé sin tocar por ser trabajo a medias, y el
agente A lo cerró mientras yo medía. Queda anotado sólo como registro: en la corrida final
el árbol pasa entero, así que no hay nada pendiente aquí.

### Suite de navegador: un worker, y por medida

`playwright.config.ts` fija `workers: 1`. No es prudencia: toda la suite ataca UN servidor
Next, así que repartirla entre navegadores no multiplica el rendimiento —el cuello de
botella es el servidor— y sólo añade contención. Misma suite, mismo artefacto construido:
**en paralelo 8 fallos en 25,8 min; en serie 26 en verde en 6,3 min**. Cuatro veces más
rápido Y fiable. Playwright ya usa 1 worker en CI; esto extiende el criterio al puesto.

Con eso, el barrido dejó un solo fallo real, en `contrast-dense.spec.ts`: la tabla de
`/artifacts` se medía tras un `waitForTimeout(700)` fijo y a veces aún estaba vacía, así
que la prueba acusaba de vacía una tabla que sólo iba tarde. Ahora **espera a que se llene**
(`nth(MIN_ROWS - 1).waitFor()`), con `catch` para no perder el caso que importa: si de
verdad nunca se llena, se registra y la prueba falla igual. Toqué ese fichero del agente A
porque el arreglo es el mismo patrón que el resto del des-flakeo y bloqueaba el gate
declarado; queda avisado aquí.

### Y una trampa que me tendí yo, para que nadie repita

Compilé con el servidor de desarrollo levantado. `CLAUDE.md` ya avisa: la build reescribe
`.next` y el servidor en marcha se queda con módulos que ya no existen. El síntoma no fue
un error claro sino **rutas devolviendo 404 dentro de las pruebas**, que pasé un buen rato
atribuyendo a la carga de la máquina. Diagnostiqué con la referencia contaminada. La cura
es la documentada: parar el servidor, borrar `.next`, arrancar de nuevo.

Con `.next` recién borrado, además, la primera corrida paga la compilación en frío y el
plazo de 10 s de un `expect` se queda corto en la primera vista (`/login` se quedó en
«Recuperando sesión»). No es un defecto ni merece subir el plazo: en la segunda corrida esa
misma prueba pasa en 9 s. Conviene calentar antes de creerse una corrida en frío.

### Cómo medir de verdad este árbol

Los gates de los dos repositorios **no se pueden correr a la vez en esta máquina**. Lanzados
en paralelo, el backend pasó de 206 s a 985 s y empezaron a caer pruebas distintas en cada
corrida: en una, un script de una línea «expiró» pese a tener 3 s de plazo, porque arrancar
`node.exe` tardó más que eso. Un gate cuyos fallos cambian de sitio según lo que tarde no
está detectando defectos, está midiendo la carga de la máquina. Uno cada vez.
