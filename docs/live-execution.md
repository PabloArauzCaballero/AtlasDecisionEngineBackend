# Ejecución en vivo (Fase 8)

`GET /v1/live-executions/stream` — transmite el progreso nodo por nodo de una
decisión **mientras se ejecuta realmente**, vía Server-Sent Events (SSE):
pendiente/ejecutando/completado/error, la ruta recorrida, las ramas
descartadas en cada nodo de bifurcación, y las llamadas a árboles anidados
(Fase 7) que ocurrieron durante la ejecución.

## ⚠️ Dependencia de la Rebanada 1 — estado de la integración

Esta característica **depende conceptualmente** del bus de eventos que la
Rebanada 1 (Event-driven + Outbox + Notificaciones) está construyendo en
paralelo sobre `src/common/events/**`, `src/modules/outbox-relay/**` y
`src/modules/notifications/**`. Esos archivos son propiedad exclusiva de esa
sesión y **no se editaron ni se leyeron como dependencia** en esta rebanada —
siguiendo la instrucción explícita de programar contra el contrato documentado
en su brief sin tocar código ajeno.

**Lo que se implementó aquí es autosuficiente**: el stream SSE conduce la
ejecución directamente (misma conexión HTTP = misma llamada a
`ExecutionEngineService.execute()`), sin pasar por ningún bus de eventos. No
requiere que la Rebanada 1 exista para funcionar, y funciona hoy contra la
rama de este trabajo tal cual.

**Pendiente de merge de R1**: una vez fusionado el bus de eventos, tendría
sentido que el motor de ejecución **además** publique un evento
`live_execution.step` (o similar) al bus para que otros consumidores
(auditoría en tiempo real, notificaciones, un panel de operaciones separado)
puedan escuchar sin necesidad de una conexión SSE dedicada. Esa publicación
adicional **no se implementó** — es un paso de integración posterior,
documentado aquí explícitamente como pendiente, en lugar de fabricar una
versión propia del contrato de eventos de R1 que luego colisionaría en el
merge.

## Diseño

`ExecutionEngineService.execute()` gana un **sexto parámetro opcional**,
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

## Pendiente / fuera de alcance de esta rebanada

- Publicación al bus de eventos de R1 (ver arriba).
- El frontend anima una lista de nodos con su estado en tiempo real (no un
  lienzo 2D interactivo completo — el editor de grafo existente ya cubre esa
  vista para autoría; repurpose-arlo para animación en vivo sería un trabajo
  considerablemente mayor, no abordado aquí).
- Reconexión automática de EventSource ante corte de red (el cliente actual
  asume una conexión estable durante la ejecución, que típicamente dura
  milisegundos a pocos segundos).
