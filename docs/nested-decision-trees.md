# Árboles de decisión anidados (Fase 7)

Permite que la versión de un artefacto invoque, desde uno de sus propios nodos RESULT,
la versión **fijada** (pinned) de otro artefacto ya compilado, mapeando variables de
entrada/salida entre ambos. Cubre: referencia entre artefactos con versión fijada,
mapeo de variables E/S, timeout configurable, política ante error, ámbito/permiso por
rol, detección de referencias circulares, profundidad máxima configurable, validación
previa, consulta de grafo de dependencias para la vista visual, y trazabilidad de
ejecución distribuida entre árboles.

## Modelo de datos

- `DecisionArtifactReference` — una referencia, dueña de: `parentArtifactVersionId` +
  `nodeKey` (identifica el nodo RESULT del padre que la posee, único por versión),
  `childArtifactId` + `childArtifactVersionId` (versión fijada del hijo — nunca
  "latest"), `inputMappingJson`, `outputMappingJson` (ver más abajo), `timeoutMs`
  (1–60000, default `NESTED_TREE_DEFAULT_TIMEOUT_MS`), `onErrorPolicy`
  (`FAIL` | `FALLBACK` | `SKIP`), `fallbackOutputJson`, `requiredRole` opcional
  (autorización adicional para editar/borrar esta referencia concreta, más allá del rol
  de ruta), `createdBy`.
- `DecisionExecutionTreeLink` — un registro por invocación anidada durante una
  ejecución. Todas las llamadas anidadas de una misma petición corren **en memoria**
  durante `ExecutionEngineService.execute()` (no se persiste una `DecisionExecution`
  propia por cada nivel — evita forzar un `deploymentId`/`environmentId` sintéticos
  para invocaciones que no pasan por resolución de despliegue). Por eso
  `rootExecutionId`/`parentExecutionId` apuntan siempre a la única ejecución raíz
  persistida, y `sequence`/`parentSequence` reconstruyen la forma real del árbol de
  llamadas (preorden). `childExecutionId` queda `NULL` salvo que el hijo también se
  haya persistido de forma independiente (no ocurre en el camino actual).
- Ambas tablas llevan `tenant_id` + política RLS (espejo de
  `20260719080000_tenant_rls_and_app_role`) y no declaran relaciones Prisma hacia los
  modelos existentes — la integridad referencial vive en SQL (`migration.sql`) para que
  el bloque de `schema.prisma` se mantenga puramente aditivo y fácil de reconciliar.

## Mapeo de variables

`inputMappingJson`: `[{ childVariableCode, source: 'VARIABLE'|'LITERAL'|'EXPRESSION', path?, value?, expression? }]`.
`VARIABLE` resuelve `path` contra el contexto del padre (`variables`/`decision`/`output`
del nodo que invoca, igual que cualquier expresión del motor). `EXPRESSION` reutiliza el
mismo AST JSON-logic que el resto del motor (`ExpressionEvaluator`) — no es JS/Python
embebido.

`outputMappingJson`: `[{ childOutputCode }]` — una lista de permitidos (allowlist) de
qué códigos de salida del hijo quedan expuestos. El nodo RESULT del padre
(`config.mode: 'REFERENCE'`) los consume en `outputAssignments: [{ outputCode,
childOutputCode }]`, asignando cada uno a una de sus **propias** variables de salida
declaradas (mismas reglas que el modo `MAPPING` existente: el `outputCode` debe estar
declarado como dependencia `OUTPUT`/`OUTPUT_PRIMARY` del padre).

## Creación manual, por JS y por Python

No existe un mecanismo de creación distinto por lenguaje: la referencia se crea
llamando al mismo endpoint REST (`POST /v1/artifact-versions/{id}/references`), ya sea
manualmente desde la UI o programáticamente desde un cliente JS o Python. Ejemplos:

```js
// JavaScript
await fetch(`/v1/artifact-versions/${parentVersionId}/references`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...authHeaders },
  body: JSON.stringify({
    nodeKey: 'NESTED_CHECK',
    childArtifactId, childArtifactVersionId,
    inputMapping: [{ childVariableCode: 'age', source: 'VARIABLE', path: 'age' }],
    outputMapping: [{ childOutputCode: 'outcome' }],
    timeoutMs: 2000, onErrorPolicy: 'FAIL',
  }),
});
```

```python
# Python
import requests
requests.post(
    f"{base_url}/v1/artifact-versions/{parent_version_id}/references",
    json={
        "nodeKey": "NESTED_CHECK",
        "childArtifactId": child_artifact_id,
        "childArtifactVersionId": child_version_id,
        "inputMapping": [{"childVariableCode": "age", "source": "VARIABLE", "path": "age"}],
        "outputMapping": [{"childOutputCode": "outcome"}],
        "timeoutMs": 2000, "onErrorPolicy": "FAIL",
    },
    headers=auth_headers,
)
```

## Validaciones al crear/editar una referencia (`NestedTreeService`)

1. La versión **padre** debe estar en `DRAFT` o `VALIDATION_FAILED` (mismas reglas que
   editar el grafo).
2. El artefacto hijo no puede ser el propio artefacto padre (auto-referencia directa).
3. La versión hija debe existir, pertenecer al artefacto hijo declarado, y tener al
   menos un `DecisionCompiledArtifact` con `compileStatus = SUCCESS`.
4. **Ciclos**: se construye el grafo de referencias existentes a nivel de **artefacto**
   (no de versión — el ciclo relevante es "A termina dependiendo de A otra vez",
   independientemente de qué versión concreta lleve el enlace) y se ejecuta una
   búsqueda de camino de vuelta al padre (`cycle-detector.ts`, 100 % puro y con
   pruebas unitarias exhaustivas). Rechaza con `CIRCULAR_ARTIFACT_REFERENCE` (409).
5. **Profundidad máxima**: se calcula la cadena más larga alcanzable desde cualquier
   ancestro del padre (no solo el padre mismo, para no permitir que un artefacto ya
   profundamente anidado adquiera una referencia que empuje a sus propios
   "padres" más allá del límite) y se rechaza con `NESTED_TREE_MAX_DEPTH_EXCEEDED`
   (409) si excede `NESTED_TREE_MAX_DEPTH` (env, default 5; depth=1 = grafo propio sin
   referencias).

## Ejecución y trazabilidad

`NestedTreeExecutionService` implementa el contrato `ArtifactReferenceResolver`
(`graph.types.ts`) y se pasa como **argumento de llamada** —nunca como dependencia de
constructor— a `ExecutionEngineService.execute(compiled, variables, resolver?,
cursor?)`. Esto mantiene `GraphModule` sin ninguna dependencia hacia
`NestedTreesModule`: solo `NestedTreesModule` depende de `GraphModule` (para reutilizar
`ExecutionEngineService`/`ExpressionEvaluator` al ejecutar el grafo del hijo), evitando
cualquier dependencia circular entre módulos de NestJS.

Al alcanzar un nodo RESULT en modo `REFERENCE`, el motor invoca al resolver con
`(parentArtifactVersionId, nodeKey, contexto, cursor)`. El cursor (`{ sequence: {
value }, parentSequence, depth }`) es un contador compartido por referencia: cada
llamada anidada, sin importar la profundidad, incrementa el mismo contador, de modo que
`sequence`/`parentSequence` alcanzan a reconstruir la forma exacta del árbol de
llamadas aunque ningún nivel intermedio tenga su propia fila `DecisionExecution`.

Política ante error (`onErrorPolicy`):
- `FAIL` (default): la excepción se propaga y toda la ejecución padre falla cerrado.
- `FALLBACK`: se usa `fallbackOutputJson` tal cual como salida del nodo.
- `SKIP`: la salida queda vacía (`{}`); las asignaciones que dependan de ella reciben
  `undefined` (sujeto a las mismas reglas de salida requerida/nullable del motor).

El timeout (`timeoutMs`) se aplica con `Promise.race` alrededor de la ejecución
recursiva completa del hijo (incluyendo sus propias referencias anidadas, si las
tuviera).

Los puntos de integración reales (dónde se pasa un resolver a `engine.execute()`):
`RuntimeService` (decisiones en vivo), `SimulationService` (simulador — el resultado
incluye `trace.nested`), y `TestCaseExecutorService` (para que los artefactos con
referencias anidadas puedan pasar por un suite de pruebas bloqueante antes de entrar a
gobernanza, igual que cualquier otro artefacto).

Al persistir la ejecución raíz (`ExecutionWriterService.write`), si
`result.nestedExecutions` no está vacío se insertan las filas
`DecisionExecutionTreeLink` correspondientes en la misma transacción que la
`DecisionExecution` — la traza queda disponible para auditoría/consulta posterior.

## Vista de dependencias

`GET /v1/artifacts/{artifactId}/dependency-graph` devuelve
`{ nodes, edges, maxDepth, maxEdges, truncated }` — todos los artefactos alcanzables
desde `artifactId` (sus dependencias) y todos los que dependen de él (sus
dependientes), hasta `NESTED_TREE_MAX_DEPTH` saltos en cada dirección, como fuente de
datos para la vista visual de navegación del frontend.

El recorrido consulta **solo la frontera de cada nivel** (`NestedTreeService
.getDependencyGraph`), nunca el catálogo completo del tenant, y está acotado a
`NESTED_TREE_GRAPH_MAX_EDGES` aristas (2000 por defecto). Si alcanza esa cota,
`truncated: true` lo declara en la propia respuesta: la vista no debe presentar un
grafo recortado como si fuera el conjunto completo de dependencias.

## Endpoints

| Método | Ruta | Roles |
|---|---|---|
| POST | `/v1/artifact-versions/{versionId}/references` | RISK_ANALYST, FRAUD_ANALYST |
| GET | `/v1/artifact-versions/{versionId}/references` | RISK_ANALYST, FRAUD_ANALYST, QA_ANALYST, COMPLIANCE, AUDITOR |
| PUT | `/v1/artifact-versions/{versionId}/references/{referenceId}` | RISK_ANALYST, FRAUD_ANALYST |
| DELETE | `/v1/artifact-versions/{versionId}/references/{referenceId}` | RISK_ANALYST, FRAUD_ANALYST |
| GET | `/v1/artifacts/{artifactId}/dependency-graph` | RISK_ANALYST, FRAUD_ANALYST, QA_ANALYST, COMPLIANCE, AUDITOR |

## Configuración (`env.schema.ts`, bloque aditivo)

`NESTED_TREE_MAX_DEPTH` (default 5), `NESTED_TREE_DEFAULT_TIMEOUT_MS` (default 2000).

## Pruebas

- `test/cycle-detector.spec.ts` — detección de ciclos y cómputo de profundidad, puro.
- `test/nested-tree-execution.service.spec.ts` — éxito, FAIL/FALLBACK/SKIP, timeout,
  profundidad excedida, referencia inexistente.
- `test/execution-engine.spec.ts` (sección "nested artifact references") — el motor
  falla cerrado sin resolver, y con un resolver falso invoca correctamente y mapea la
  salida.
- `test/e2e/nested-decision-trees.e2e-spec.ts` — de punta a punta contra Postgres real:
  crea y compila un artefacto hijo, crea el padre con un nodo REFERENCE, rechaza
  auto-referencia y referencia a versión no compilada, crea la referencia real, valida
  el grafo de dependencias, valida+compila el padre, corre su suite de pruebas
  bloqueante (esto expuso y corrigió un bug preexistente en `TestCaseExecutorService`:
  no filtraba variables de salida antes de resolver variables de entrada), lo gobierna
  y despliega a SANDBOX, y finalmente ejecuta el simulador confirmando que la salida
  anidada llega correctamente para los casos aprobado y rechazado.

## Pendiente / fuera de alcance de esta rebanada

- No hay UI de edición visual del mapeo E/S todavía más allá de lo descrito en
  `docs/flowchart-user-guide.md` (backend completo y probado; frontend cubre listado y
  grafo de dependencias, ver `VIEW_INVENTORY.md`).
- La ejecución anidada no crea su propia fila `DecisionExecution` por nivel (ver
  justificación arriba); si en el futuro se requiere trazabilidad de ejecución
  independiente por nivel, requeriría revisar el esquema de `DecisionExecution`
  (relajar `deploymentId`/`environmentId` a opcionales) — cambio que no se hizo aquí
  para no tocar un modelo compartido de forma no aditiva.
