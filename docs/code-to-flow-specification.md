# Generador Código → Flow (Fase 5)

Convierte código JavaScript o Python, escrito con un contrato de metadatos
declarado explícitamente, en un grafo de decisión ejecutable — reutilizando por
completo el motor de ejecución, el sandbox y el validador de grafos ya existentes
(nada de esto se reimplementa).

## Decisión de diseño: contrato declarado, no inferido

Inferir de forma confiable los tipos y la obligatoriedad de entradas/salidas a
partir de código JS/Python arbitrario (dinámicamente tipado) requeriría análisis de
flujo de tipos de grado de investigación. En su lugar, el contrato se **declara
explícitamente** en un bloque de comentario al inicio del archivo — el mismo
compromiso que adoptan la mayoría de las plataformas low-code con importación de
código:

```js
// @atlas-contract
// { "contractVersion": "1",
//   "inputs": [{ "id": "age", "name": "Age", "type": "INTEGER", "required": true }],
//   "outputs": [{ "id": "riskLevel", "name": "Risk Level", "type": "STRING", "required": true }] }
return { riskLevel: variables.age >= 21 ? 'LOW' : 'HIGH' };
```

```python
# @atlas-contract
# {"contractVersion": "1", "inputs": [{"id": "age", "name": "Age", "type": "INTEGER", "required": true}], "outputs": [{"id": "riskLevel", "name": "Risk Level", "type": "STRING", "required": true}]}
result = {"riskLevel": "LOW" if variables["age"] >= 21 else "HIGH"}
```

`variables`/`decision`/`output` son exactamente los globals que
`script-node-runner.service.ts` ya inyecta en los nodos RESULT en modo `SCRIPT` —
el código importado no introduce ninguna superficie de ejecución nueva: lee sus
entradas declaradas desde `variables` y retorna (JS) o asigna `result` (Python)
con sus salidas declaradas.

Tipos soportados: `STRING`, `INTEGER`, `NUMBER`, `BOOLEAN`, `DATE`, `DATETIME`,
`OBJECT`, `ARRAY`.

## Pipeline (`CodeImportService.analyze`)

1. **Carga/edición**: el cliente envía `{ language, sourceCode, artifactId? }`.
2. **Validación de lenguaje y tamaño**: `language ∈ {JAVASCRIPT, PYTHON}`;
   `sourceCode` ≤ `CODE_IMPORT_MAX_SOURCE_BYTES` (default 128 KiB).
3. **Análisis sintáctico** (`SyntaxAnalyzerService`) — **nunca ejecuta el código**:
   JS se compila (no se corre) con `vm.Script`, envuelto en la misma forma de
   función que usa el runner real (`(function (variables, decision, output) {
   ... })`) para que un `return` de nivel superior sea válido igual que en
   ejecución real; Python se analiza con `ast.parse` en un subproceso aislado
   (mismo patrón de `spawnSync` que `script-node-runner.service.ts`, pero sin
   ejecutar nada). Retorna errores con línea/columna.
4. **Extracción del contrato** (`ContractExtractorService`) — localiza el bloque
   `@atlas-contract`, parsea su JSON, y separa el cuerpo del script (contrato
   removido) del resto del código.
5. **Validación de IDs y variables** (`ContractValidatorService`) — IDs únicos y
   con formato válido, tipos soportados, `required`/`default` consistentes, y una
   verificación heurística (no un análisis de flujo de datos completo) de que cada
   entrada se lee y cada salida se asigna en el cuerpo del script — advertencia, no
   error bloqueante, si no.
6. **Análisis de seguridad** (`SecurityAnalyzerService`) — escaneo estático línea
   por línea de patrones prohibidos (`require`/`import`/`eval`/`process`/
   `child_process`/`fs` en JS; `import`/`subprocess`/`eval`/`exec`/`__import__`/
   `open`/dunders en Python). Es defensa **en profundidad**: el sandbox de
   ejecución (`script-node-runner.service.ts`) ya bloquea estas mismas cosas en
   tiempo de ejecución; esto solo le da al autor una explicación inmediata y con
   número de línea, antes de llegar ahí.
7. **Representación intermedia común (IR)** — ver más abajo.
8. **Generación del grafo** (`GraphGeneratorService`) — mapeo determinístico,
   documentado a continuación.
9. **Validación del grafo** — el grafo generado se valida con el
   `GraphValidatorService` **existente** en el momento de `save-draft`/`confirm`
   (vía `ArtifactGraphWriterService.replaceDraftGraph` → validate), sin duplicar
   ninguna regla estructural.
10. **Preview** — la respuesta de `analyze()` incluye el grafo generado sin
    persistir nada en el artefacto todavía.
11. **Confirmar / guardar borrador / cancelar** — ver endpoints abajo.

## Representación intermedia (IR)

```ts
interface CodeImportIR {
  irVersion: '1';
  language: 'JAVASCRIPT' | 'PYTHON';
  sourceChecksum: string;       // sha256 del código fuente completo tal como se envió
  contract: MetadataContract;   // el contrato extraído y validado
  scriptBody: string;           // el código con el encabezado @atlas-contract removido
  branches?: DecisionBranch[];  // ramas traducidas sin pérdida; ausente si requiere SCRIPT
}
```

Es deliberadamente **independiente del lenguaje**: JS y Python se leen con reglas
de bloques distintas, pero ambos producen el mismo `DecisionBranch[]` y el mismo
AST de expresiones. Si alguna sentencia queda fuera del subconjunto soportado, la
IR conserva `scriptBody` y no conserva ramas parciales; el generador elige el nodo
`SCRIPT` original.

## Generación del grafo (`GraphGeneratorService`)

Cuando todas las ramas se pueden traducir sin pérdida, el IR genera una escalera
de condiciones y resultados:

```
START -> CHECK_1 --sí--> RESULT_1
           | no
           v
         CHECK_2 --sí--> RESULT_2
           | no
           v
         RESULT_DEFAULT
```

- Una dependencia `INPUT` por cada entrada del contrato (`dependencyPath:
  input.<id>`).
- Una dependencia `OUTPUT`/`OUTPUT_PRIMARY` por cada salida del contrato
  (`dependencyPath: output.<id>`); la salida marcada `primaryOutputId` en el
  contrato (o la primera declarada si no se especifica) se marca
  `OUTPUT_PRIMARY` — exactamente la única permitida por
  `graph-structure.validator.ts`.
- Cada `if`/`elif` produce una condición `JSON_AST`, un nodo `CONDITION`, una
  arista condicional y un `RESULT` en modo `MAPPING`.
- La salida “no” encadena la siguiente condición y termina en el `else`, que es
  obligatorio para demostrar un camino por defecto.
- Cada rama debe escribir todas las salidas requeridas del contrato. Si omite
  alguna, la traducción se descarta completa; así un script válido no se convierte
  en un grafo que falle después con `REQUIRED_OUTPUT_MISSING`.
- Salidas desconocidas, `if` anidados, múltiples cadenas principales, funciones,
  bucles u operadores no soportados generan
  `CODE_IMPORT_TREE_NOT_DERIVABLE` (warning) y activan el fallback seguro.

El fallback es determinista y conserva la semántica original:

```
START --(default)--> CODE_IMPORT_RESULT [RESULT, mode=SCRIPT]
```

Ese nodo lleva `config.script = { language, source: scriptBody }` y usa el runner
aislado existente. Una warning de derivación no bloquea guardar; los errores de
sintaxis, contrato o seguridad sí lo bloquean.

Las variables de entrada/salida del contrato se resuelven contra
`DecisionVariableDefinition` existentes por `variableCode` dentro del tenant; si
no existe una, `CodeImportService` la crea automáticamente (con una versión
inicial mínima) para que el escritor del grafo tenga un `variableVersionId` real
al que apuntar.

## Comparación código ↔ grafo

La respuesta de `analyze()`/`GET /v1/code-imports/{id}` incluye tanto
`irJson.scriptBody` (el código, ya sin el encabezado de contrato) como
`generatedGraph` (nodos/dependencias) — la vista de comparación en el frontend
renderiza ambos lado a lado.

## Errores por línea

Cada entrada de `issuesJson` tiene la forma:

```ts
interface LineIssue {
  source: 'SYNTAX' | 'CONTRACT' | 'SECURITY' | 'GRAPH';
  severity: 'ERROR' | 'WARNING';
  line: number;
  column?: number;
  message: string;
  code: string;
}
```

Cualquier issue con `severity: 'ERROR'` bloquea `save-draft`/`confirm`
(`CODE_IMPORT_HAS_BLOCKING_ISSUES`, 409).

## Ejecución aislada

El código importado corre exactamente por el mismo camino que cualquier nodo
RESULT en modo SCRIPT autorado a mano: `ScriptNodeRunnerService`, con
`SCRIPT_RUNNER_MODE=SIDECAR` obligatorio en producción (contenedor gVisor,
sin red, con límites de tiempo/tamaño) — ver `docs/CONFIGURABLE_OUTPUTS.md`. La
Fase 5 no introduce un runner nuevo ni relaja esa política.

## Endpoints

| Método | Ruta | Roles | Descripción |
|---|---|---|---|
| POST | `/v1/code-imports` | RISK_ANALYST, FRAUD_ANALYST | Analiza el código, genera el preview, persiste el registro (`ANALYZED`) |
| GET | `/v1/code-imports` | + QA_ANALYST, AUDITOR | Lista paginada |
| GET | `/v1/code-imports/{id}` | + QA_ANALYST, AUDITOR | Detalle (código, contrato, IR, issues, grafo) |
| POST | `/v1/code-imports/{id}/save-draft` | RISK_ANALYST, FRAUD_ANALYST | Escribe el grafo generado en una versión DRAFT (`{ artifactVersionId, expectedLockVersion }`) |
| POST | `/v1/code-imports/{id}/confirm` | RISK_ANALYST, FRAUD_ANALYST | Igual que save-draft, y además valida + compila |
| POST | `/v1/code-imports/{id}/cancel` | RISK_ANALYST, FRAUD_ANALYST | Marca el import como `CANCELLED` |

`DecisionCodeImport.status`: `ANALYZED → DRAFT_SAVED | CONFIRMED | CANCELLED`.

## Configuración

`CODE_IMPORT_MAX_SOURCE_BYTES` (default 131072) limita bytes UTF-8.
`CODE_IMPORT_ANALYSIS_TIMEOUT_MS` (default 2000, rango 100–10000) limita el
subproceso de `ast.parse` de Python; un timeout falla cerrado como analizador no
disponible.

## Pruebas

- `test/code-import-pipeline.spec.ts` — cada paso puro del pipeline en aislamiento
  (extracción de contrato JS/Python, validación de contrato, análisis de
  seguridad, análisis de sintaxis — incluyendo el caso real que este mismo test
  detectó: un `return` de nivel superior es válido en el contexto de ejecución
  real pero inválido si se compila sin el wrapper de función, corregido en
  `SyntaxAnalyzerService`), y generación del grafo.
- `test/e2e/code-import.e2e-spec.ts` — de punta a punta contra Postgres real:
  analiza código válido y código con errores de sintaxis/seguridad/contrato
  simultáneos, rechaza guardar un borrador con issues bloqueantes, guarda un
  borrador real y verifica el grafo escrito, y (cuando `SCRIPT_NODES_ENABLED=true
  SCRIPT_RUNNER_MODE=IN_PROCESS`) confirma, corre una suite de pruebas
  bloqueante, gobierna, despliega y ejecuta una decisión real end-to-end
  confirmando la salida (`riskLevel: 'LOW'`/`'HIGH'`) según la entrada.

## Límites deliberados

- La derivación visual admite una cadena principal `if/elif/else`, asignaciones
  simples, retornos de objetos, lógica/comparaciones, aritmética, ternarios y
  `min`/`max`/`round`. Código fuera de ese subconjunto conserva el nodo SCRIPT.
- La verificación "input leído / output asignado" en `ContractValidatorService`
  es una heurística basada en patrones (regex), no un análisis de flujo de datos
  completo; solo emite advertencias, nunca bloquea el guardado.
