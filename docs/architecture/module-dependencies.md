<!-- GENERADO POR scripts/docs/analyze-graphify.mjs — NO EDITAR A MANO.
     Fuente: graphify-out/graph.json contrastado con src/. -->

# Dependencias entre módulos

Derivado del grafo de conocimiento y contrastado con `src/modules/`. Muestra qué módulo
depende de cuál **en el código**, no en la intención del diseño.

## Grafo (40 relaciones más fuertes)

```mermaid
flowchart LR
    nested_trees --> graph
    runtime --> graph
    runtime --> deployments
    artifacts --> graph
    runtime --> variables
    testing --> graph
    code_import --> artifacts
    runtime --> nested_trees
    deployments --> artifacts
    live_execution --> graph
    governance --> artifacts
    code_import --> variables
    live_execution --> deployments
    deployments --> governance
    governance --> testing
    live_execution --> nested_trees
    live_execution --> variables
    testing --> nested_trees
    testing --> variables
    variables --> graph
    code_import --> graph
    deployments --> graph
```

## Acoplamiento por módulo

Un `fan-in` alto significa que muchos módulos dependen de este: cambiarlo es caro. Un
`fan-out` alto significa que este depende de muchos: es frágil ante cambios ajenos.

| Módulo | Fan-in | Fan-out |
| --- | ---: | ---: |
| [`graph`](../modules/graph.md) | 82 | 0 |
| [`runtime`](../modules/runtime.md) | 0 | 55 |
| [`nested-trees`](../modules/nested-trees.md) | 22 | 22 |
| [`artifacts`](../modules/artifacts.md) | 25 | 14 |
| [`deployments`](../modules/deployments.md) | 21 | 17 |
| [`variables`](../modules/variables.md) | 31 | 4 |
| [`testing`](../modules/testing.md) | 6 | 23 |
| [`live-execution`](../modules/live-execution.md) | 0 | 26 |
| [`code-import`](../modules/code-import.md) | 0 | 19 |
| [`governance`](../modules/governance.md) | 6 | 13 |
| [`audit-query`](../modules/audit-query.md) | 0 | 0 |
| [`calculated-fields`](../modules/calculated-fields.md) | 0 | 0 |
| [`health`](../modules/health.md) | 0 | 0 |
| [`identity-session`](../modules/identity-session.md) | 0 | 0 |
| [`libraries`](../modules/libraries.md) | 0 | 0 |
| [`manual-review`](../modules/manual-review.md) | 0 | 0 |
| [`notifications`](../modules/notifications.md) | 0 | 0 |
| [`outbox-relay`](../modules/outbox-relay.md) | 0 | 0 |
| [`qa-lab`](../modules/qa-lab.md) | 0 | 0 |
| [`security-review`](../modules/security-review.md) | 0 | 0 |
| [`seeding`](../modules/seeding.md) | 0 | 0 |
| [`traceability`](../modules/traceability.md) | 0 | 0 |
| [`tutorials`](../modules/tutorials.md) | 0 | 0 |
| [`views`](../modules/views.md) | 0 | 0 |

## Ciclos

Ninguno entre módulos de dominio.

!!! note "La regla que evita los ciclos"
    Cuando un servicio necesita colaborar con otro dominio **de forma opcional**, se pasa como
    argumento de llamada y no como dependencia de constructor. Es lo que permite que el motor
    de ejecución no dependa del módulo de árboles anidados ni del stream en vivo.

