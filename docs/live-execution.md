# Ejecución en vivo (Fase 8)

`GET /v1/live-executions/stream` — transmite el progreso nodo por nodo de una
decisión **mientras se ejecuta realmente**, vía Server-Sent Events (SSE):
pendiente/ejecutando/completado/error, la ruta recorrida, las ramas
descartadas en cada nodo de bifurcación, y las llamadas a árboles anidados
(Fase 7) que ocurrieron durante la ejecución.

## Justificación de arquitectura

El bus transaccional, el relay y las notificaciones ya están integrados, pero el
progreso por nodo **no se publica al outbox**. Es una decisión deliberada: los
eventos de dominio representan hechos durables de baja cardinalidad; los pasos
de una previsualización son telemetría efímera, potencialmente voluminosa y útil
sólo para la conexión que la solicitó. Persistirlos aumentaría el tamaño del
outbox, acoplaría la latencia del preview a consumidores y podría confundirse
con evidencia de una decisión productiva.

El SSE conduce el motor directamente en el request. Las ejecuciones reales de
runtime siguen persistiendo evidencia y eventos por sus caminos normales.

## Diseño

`ExecutionEngineService.execute()` acepta un **quinto parámetro opcional**,
`onStep?: (event: LiveStepEvent) => void` — un argumento de llamada plano, no
una dependencia de constructor (mismo patrón que `ArtifactReferenceResolver`,
ver `docs/nested-decision-trees.md`), así que **ningún llamador existente
cambia**: `RuntimeService`, `SimulationService` y `TestCaseExecutorService`
simplemente no lo pasan.

`LiveStepEvent`:
```ts
interface LiveStepEvent {
  status: 'RUNNING' | 'COMPLETED' | 'ERROR';
  nodeKey: string;
  nodeType: string;
  branchTaken?: string;       // la arista realmente tomada
  discardedEdgeKeys?: string[]; // todas las demás aristas salientes de este nodo
  durationUs?: number;
  errorMessage?: string;
}
```

`discardedEdgeKeys` incluye **todas** las aristas salientes no tomadas, se
hayan evaluado formalmente o no (el motor corta en corto-circuito en cuanto
encuentra la primera condición que pasa) — para una visualización de "ramas
descartadas" el usuario quiere ver cada rama no recorrida, no solo las que el
motor llegó a evaluar.

`LiveExecutionController.stream()` (`@Sse('stream')`) resuelve el despliegue y
las variables exactamente igual que `SimulationService` (mismo
`DeploymentResolverService`/`VariableResolutionService`), y **es igual de
efímero**: no persiste `DecisionExecution`, no usa idempotencia, no audita —
es una herramienta de *preview* en vivo, igual que el simulador, por lo que
**PROD está prohibido** (`LIVE_EXECUTION_PROD_FORBIDDEN`) con la misma
justificación que `SimulationService`.

Eventos SSE emitidos:
- `node_step` — un `LiveStepEvent` por cada inicio/fin de nodo.
- `heartbeat` — timestamp periódico que mantiene vivos proxy y timeout global.
- `execution_completed` — resultado final (`status`, `outcome`, `output`,
  `reasons`, `nestedExecutions`).
- `execution_failed` — variables inválidas, PROD prohibido, o cualquier error
  de ejecución; el stream siempre se cierra con `complete()`, nunca queda
  colgado.

## Endpoint

| Método | Ruta | Roles |
|---|---|---|
| GET | `/v1/live-executions/stream?artifactCode&environmentCode&requestId&variables` | RISK_ANALYST, FRAUD_ANALYST, QA_ANALYST |

`variables` es un objeto JSON codificado como string en el query param.
`null`, arrays y valores primitivos se rechazan con
`LIVE_EXECUTION_VARIABLES_INVALID`.

## Configuración y seguridad

- `LIVE_EXECUTION_STREAM_ENABLED=false` por defecto. Si está deshabilitado, el
  endpoint responde `LIVE_EXECUTION_DISABLED` (503) antes de abrir el stream.
- `LIVE_EXECUTION_STREAM_HEARTBEAT_MS=15000`, rango 1000–60000.
- `variables` se limita a 16384 caracteres y `requestId` usa el mismo alfabeto
  acotado del resto de la API.
- PROD está prohibido. No hay idempotencia, `DecisionExecution`, auditoría ni
  outbox porque la herramienta es un preview de gestión.
- Una excepción inesperada se registra con correlación en el logger estructurado
  y se devuelve como mensaje genérico; SSE ya confirmó HTTP 200 y no puede usar
  el filtro global para redactar el body.

## Pruebas

`test/execution-engine.spec.ts` (sección "onStep live progress") — el motor
emite RUNNING→COMPLETED por cada nodo visitado, con las ramas descartadas
correctas, y un evento ERROR antes de relanzar la excepción cuando un nodo
falla.

`test/e2e/live-execution.e2e-spec.ts` — contra Postgres real: despliega un
artefacto de elegibilidad por edad a SANDBOX (gobernanza completa) y confirma
que el stream SSE realmente ejecuta la decisión, reporta `CHECK` completado
con `branchTaken`/`discardedEdgeKeys` correctos, entrega un
`execution_completed` con el `outcome` correcto, y rechaza PROD con un
`execution_failed` en vez de ejecutar.

## Fuera de alcance

- Persistencia o publicación de pasos al outbox (excluida deliberadamente; ver
  justificación de arquitectura).
- El frontend anima una lista de nodos con su estado en tiempo real (no un
  lienzo 2D interactivo completo — el editor de grafo existente ya cubre esa
  vista para autoría; repurpose-arlo para animación en vivo sería un trabajo
  considerablemente mayor, no abordado aquí).
- Reconexión automática de EventSource ante corte de red (el cliente actual
  asume una conexión estable durante la ejecución, que típicamente dura
  milisegundos a pocos segundos).
