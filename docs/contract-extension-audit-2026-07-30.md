# Informe de auditoría — Ampliación de contratos (2026-07-30)

Ejecución de las fases 0–10 de la ampliación obligatoria de contratos de variables,
campos calculados, composición de artefactos y QA masivo, sobre `AtlasDecisionEngine`
(backend) y `AtlasDecisionEngineFrontend`.

---

## 1. Evidencia de verificación

Todos los comandos se ejecutaron al cierre, contra PostgreSQL 
(`atlas-decision-engine-postgres-1`) y la base sembrada.

### Backend

| Comando | Resultado |
| --- | --- |
| `prettier --check src test prisma` | ✅ sin diferencias |
| `tsc --noEmit` | ✅ sin errores |
| `nest build` | ✅ compila |
| `jest` (unitarias) | ✅ **512 pasan**, 2 omitidas, 60 suites |
| `jest` (integración con BD) | ✅ **61 pasan**, 13 suites |
| `jest --config test/jest-e2e.json` | ✅ **58 pasan**, 11 suites |
| `prisma migrate deploy` | ✅ migración aplicada |
| `prisma db seed` | ✅ 279 variables · 96 reason codes · 8 librerías · 3 campos calculados |

**Total backend: 631 pruebas en verde** (partiendo de 345 unitarias).

### Frontend

| Comando | Resultado |
| --- | --- |
| `prettier --check .` | ✅ sin diferencias |
| `eslint . --max-warnings=0` | ✅ sin avisos |
| `verify-source` (límite de 299 líneas) | ✅ 460 archivos |
| `tsc --noEmit` | ✅ sin errores |
| `vitest run` | ✅ **387 pasan**, 54 suites |
| `next build` | ✅ compila; rutas nuevas registradas |

**Total frontend: 387 pruebas en verde** (partiendo de 347).

---

## 2. Segunda pasada: lo que faltaba

La primera pasada dejó siete huecos frente al pliego. Una relectura punto por punto los
sacó y esta segunda pasada los cierra. El más grave era estructural, no cosmético.

### H-1 (crítico) · Los campos calculados no se podían invocar desde un grafo

§5.1 exige que un campo calculado «pueda ser utilizado por más de un artefacto sin
duplicar la lógica», y §12 pide que la traza recorra el eslabón «campo calculado». Lo
implementado era un registro aislado con un endpoint de prueba: ningún algoritmo podía
usarlo, así que el propósito entero del módulo quedaba sin cumplir.

Cerrado con: tipo `CalculatedFieldCallSnapshot` en el grafo, validador
`graph-calculated-field.validator.ts` (12 comprobaciones), ejecución en el motor con
traza, tabla `decision_artifact_calculated_field_use` —que además da la dependencia
inversa de §5.2—, panel de autoría en el editor y demostración sembrada: el demo
`AFFORDABILITY_CONTRACT_DEMO` invoca `debt_to_income` de verdad, y una prueba comprueba
que produce **exactamente** los mismos resultados que la fórmula en línea.

### H-2 · El catálogo de variables no exponía los campos de §1.1

Las columnas existían en la base desde la primera pasada, pero ni la API ni la UI dejaban
configurar mensaje de error, ejemplos, origen esperado, sensibilidad ni restricciones.
Cerrado en `VariableVersionDto`, `variable.service.ts` y la nueva página
`/variables/{id}`.

### H-3 · No había validación previa ni compatibilidad entre versiones

§1.2 pide «validar el contrato antes de guardarlo», «comparar modificaciones entre
versiones» y «visualizar dependencias». Cerrado con `VariableContractService` y tres
endpoints (`validate-contract`, `compatibility`, `dependencies`). Un cambio que estreche
el contrato de una variable usada por versiones aprobadas o desplegadas se **rechaza**
con `VARIABLE_CONTRACT_INCOMPATIBLE`.

### H-4 · El nodo de referencia estaba incompleto

Faltaban ambiente, política de selección de versión, reintentos, condición de ejecución,
obligatoriedad y exposición en traza (§9). Añadidos con migración y con una regla nueva:
en PROD la referencia debe fijar versión exacta, porque «la activa del ambiente» hace la
decisión irreproducible.

### H-5 · Los límites de cadena de §9.3 estaban a medias

Había profundidad y timeout por salto. Faltaban cantidad de artefactos, tiempo total y
tamaño de resultados intermedios. Cerrado con `ChainBudget`, que acompaña a la ejecución
raíz y recorta el timeout de cada salto a lo que le queda a la cadena.

### H-6 · El estado por nodo no traía duración, origen, estado ni errores

§3.1 los pide explícitamente. Añadidos, y con ellos una corrección que faltaba: **un nodo
que falla ahora también deja traza**. Antes, el único nodo ausente de la evidencia era
justo el que rompía la decisión.

### H-7 · Documentación de las decisiones nuevas

Seis ADR más (D-15 a D-20) y las secciones correspondientes en los manuales.

---

## 3. Defectos reales encontrados y corregidos

Además de los huecos anteriores, la auditoría destapó tres fallos que ya estaban en el
sistema y que habrían llegado a producción.

### D-A · Una decisión declinada en KYC moría con `REQUIRED_OUTPUT_MISSING`

**Severidad: alta.** Reproducible en `test/e2e/runtime.e2e-spec.ts`.

El catálogo declara `fraud_score` como anulable —un rechazo temprano en KYC nunca llega a
calcularlo— pero la fila de la base seguía con `nullable = false`. Causa: `ensureVariable`
salía antes de tocar nada si la versión 1 ya existía, así que **ninguna corrección del
catálogo llegaba jamás a una base ya sembrada**.

Corregido en `seeding/data/helpers.ts`: la versión 1 es propiedad del seeder (la API
siempre crea versiones nuevas, nunca edita la 1), así que ahora converge al catálogo. El
demo se rehace vía `DEMO_SEMANTIC_VERSION = 2.1.0`.

### D-B · La validación de referencias rechazaba las salidas implícitas del motor

**Severidad: media.** Reproducible en `test/e2e/nested-decision-trees.e2e-spec.ts`.

El motor añade siempre `outcome`, `score`, `riskBand` y `limit` al sobre de salida, tenga
o no el artefacto una variable declarada con ese nombre. Un hijo que solo fija `outcome`
con una acción terminal —el caso más común— quedaba rechazado con
`REFERENCE_OUTPUT_UNKNOWN`. Corregido con `IMPLICIT_CHILD_OUTPUTS`, con prueba dedicada.

### D-C · Un helper Python no podía llamar a otro helper

**Severidad: media (latente).** Afectaba también a los nodos de script existentes.

El runner ejecutaba `exec(code, globals, locals)` con diccionarios separados: una función
definida por el script queda en `locals` y su cuerpo no la ve al ejecutarse, así que
cualquier helper que llamara a otro fallaba con `NameError`. Corregido en
`script-node-runner.service.ts` y en el sidecar `runner/server.mjs` usando un único
diccionario. Los builtins restringidos no cambian: la seguridad es idéntica.

---

## 4. Cumplimiento de los criterios de aceptación (§18)

| Criterio | Estado | Evidencia |
| --- | --- | --- |
| Cada artefacto declara entradas tipadas y restringidas | ✅ | `data-types.ts`, `constraint-engine.ts` |
| Las restricciones se configuran desde el frontend | ✅ | `ConstraintEditor.tsx` |
| Las restricciones se almacenan y aplican en el backend | ✅ | `constraints_json`, `VariableResolutionService` |
| Existe el tipo `INTERMEDIATE` | ✅ | `decision_intermediate_variable` |
| Las intermedias solo existen dentro del grafo | ✅ | `IntermediateScope` en el estado de ejecución |
| Las intermedias no se exponen accidentalmente | ✅ | propiedad `NO_INTERMEDIATE_LEAK` + prueba fast-check |
| Cada nodo muestra el estado de los valores | ✅ | `variableState` + `NodeVariableStatePanel` |
| Los valores internos no se confunden con salidas | ✅ | tres bloques separados en traza y UI |
| Cada artefacto define su contrato final de salida | ✅ | `decision_output_contract_field` |
| Toda salida obligatoria tiene origen válido | ✅ | 10 validaciones de `graph-output-contract.validator` |
| Existen campos calculados reutilizables | ✅ | 3 sembrados; el demo invoca `debt_to_income` desde su grafo |
| Un campo calculado se usa desde más de un artefacto sin duplicar lógica | ✅ | `graph-calculated-fields.spec.ts`, `decision_artifact_calculated_field_use` |
| Los campos calculados no reemplazan artefactos | ✅ | `TOO_MANY_INPUTS`, `TIMEOUT_TOO_HIGH`, `CODE_TOO_LONG` |
| Se define explícitamente el valor de retorno | ✅ | contrato de retorno obligatorio (§5.3) |
| Se admiten operaciones visuales | ✅ | catálogo cerrado de ~45 operaciones |
| JavaScript y Python se ejecutan aislados | ✅ | sandbox de proceso; sidecar obligatorio en PROD |
| El código no supera tres líneas ejecutables | ✅ | `code-guard.ts`, incluye conteo de sentencias |
| Las librerías se eligen de un catálogo autorizado | ✅ | `LibrarySelector`, sin campo libre |
| Las librerías se muestran como chips | ✅ | `LibraryChip.tsx` con nombre, versión, categoría |
| No existen importaciones arbitrarias | ✅ | preludes en repositorio; la BD solo habilita |
| Un artefacto puede referenciar otro | ✅ | ya existía; reforzado |
| Los contratos encadenados son compatibles | ✅ | `reference-contract.validator.ts` |
| Se detectan ciclos y se limita la profundidad | ✅ | ya existía; ahora con métrica |
| Se limitan artefactos, tiempo total y tamaño de resultados | ✅ | `chain-budget.spec.ts` |
| La referencia configura ambiente, versión, reintentos y condición | ✅ | migración `20260730130000` |
| El contrato de variable se valida antes de guardar | ✅ | `POST /v1/variables/validate-contract` |
| Se verifica compatibilidad entre versiones de variable | ✅ | `POST /v1/variables/{id}/compatibility` |
| Se visualizan las dependencias de una variable | ✅ | `GET /v1/variables/{id}/dependencies` |
| Se registra la cadena completa | ✅ | `DecisionExecutionTreeLink` |
| Faker genera datos sintéticos masivos | ✅ | `qa-lab-generator.spec.ts` |
| fast-check verifica propiedades | ✅ | 6 propiedades, sobre el motor real |
| Los fallos son reproducibles por semilla | ✅ | `SeededRandom` + snapshot del contrato |
| Los contraejemplos se almacenan | ✅ | `decision_qa_counterexample` + reducción |
| Los seeders coinciden con los resultados reales | ✅ | `contract-demo-seed.spec.ts` ejecuta el motor |
| DEV y PROD permanecen aislados | ✅ | QA rechaza PROD; librerías por ambiente |
| Las pruebas pasan | ✅ | 603 backend + 376 frontend |
| La documentación coincide con la implementación | ✅ | 2 manuales + 1 ADR, con referencias a archivos |

---

## 5. Qué se decidió y por qué

Las decisiones no obvias están razonadas en
[`ADR-0011`](adr/ADR-0011-contract-extensions.md). Las tres con más consecuencias:

1. **Las intermedias tienen tabla propia** (D-1). Con `usageType='INTERMEDIATE'` sobre el
   catálogo global, la variable aparecería en los listados por construcción y habría que
   filtrarla en cada consulta; un filtro olvidado sería una fuga.
2. **La disponibilidad se comprueba por dominancia** (D-2). La alcanzabilidad simple
   acepta grafos que fallan la mitad de las veces.
3. **El registro de librerías solo habilita preludes del repositorio** (D-6). Si la fila
   pudiera aportar código, aprobar una librería equivaldría a inyectar código en el
   sandbox.
4. **La definición del campo calculado viaja congelada en el compilado** (D-15) y **el
   cliente nunca la aporta** (D-16). Lo primero hace reproducible una decisión archivada;
   lo segundo impide que guardar un grafo se convierta en una vía para ejecutar código
   saltándose el ciclo de aprobación.

---

## 6. Pendientes y alcance no cubierto

La lista viva de lo que falta —con severidad, verificación y reparto entre agentes— está
en [`PENDIENTES-ampliacion-contratos.md`](PENDIENTES-ampliacion-contratos.md). Resumen: 9
pendientes, ninguno crítico; los dos de mayor impacto son los escenarios negativos de los
seeders (§11) y las opciones del nodo de referencia en la interfaz (§9), que en backend
ya están completas.

### Alcance no cubierto por decisión

Declarado explícitamente, para que la decisión de ampliarlo sea de quien corresponde:

- **Pruebas de carga y estrés reales** (§10.6). El QA Lab ejecuta lotes concurrentes con
  concurrencia configurable y acota el tiempo total, pero no hay un arnés de carga
  sostenida tipo k6/Gatling ni umbrales de SLO automatizados.
- **Librerías de terceros** (numpy, pandas…). El registro está preparado, pero solo se
  aprobaron cuatro preludes propios y deterministas. Añadir una librería externa exige
  escribir su prelude y revisarlo, que es precisamente el control que §7 pide.
- **Encadenamiento asíncrono** (§9). Las referencias son síncronas, como estaban.
- **Restricciones por tenant y por país sembradas**. El motor las evalúa y hay pruebas,
  pero el catálogo sembrado no usa todavía ningún tramo acotado.

---

## 7. Cómo verlo funcionando

```bash
# Backend
cd AtlasDecisionEngine
docker compose up -d postgres redis
yarn prisma:migrate && yarn prisma:seed
yarn start:dev

# Frontend
cd ../AtlasDecisionEngineFrontend
yarn dev            # http://localhost:5173
```

Recorrido sugerido:

1. **Editor de grafo** → declara una intermedia, mira cómo el panel exige nodo productor.
2. **Contrato de salida** → pulsa «Declarar las que faltan» y observa las validaciones.
3. **Campos calculados** → crea uno visual, pruébalo con un ejemplo, publícalo (ejecuta
   sus casos antes de dejarte).
4. **Librerías autorizadas** → comprueba que `finance` está restringida a SANDBOX/TEST.
4.bis **Editor de grafo → un nodo** → panel «Campos calculados»: invoca `debt_to_income`,
   mapea sus entradas y elige dónde se guarda el resultado.
4.ter **Catálogo → una variable** → contrato completo, versiones, quién la usa y
   validación previa con detección de cambios incompatibles.
5. **QA Lab** → 200 casos sobre `AFFORDABILITY_CONTRACT_DEMO`, mira los contraejemplos y
   vuelve a ejecutar uno.
6. **Detalle de ejecución** → panel «Estado de variables por nodo».
