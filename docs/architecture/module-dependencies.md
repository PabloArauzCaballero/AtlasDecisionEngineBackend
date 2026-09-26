<!-- GENERADO POR scripts/docs/analyze-graphify.mjs — NO EDITAR A MANO.
     Fuente: graphify-out/graph.json contrastado con src/. -->

# Dependencias entre módulos

Derivado del grafo de conocimiento y contrastado con `src/modules/`. Muestra qué módulo
depende de cuál **en el código**, no en la intención del diseño.

## Grafo (40 relaciones más fuertes)

```mermaid
flowchart LR
    qa_lab --> graph
    nested_trees --> graph
    runtime --> graph
    runtime --> deployments
    calculated_fields --> libraries
    workers --> graph
    artifacts --> graph
    calculated_fields --> qa_lab
    runtime --> variables
    testing --> graph
    risk_governance --> model_monitoring
    runtime --> nested_trees
    runtime --> workers
    code_import --> artifacts
    runtime --> qa_lab
    deployments --> artifacts
    live_execution --> graph
    governance --> artifacts
    governance --> security_review
    runtime --> risk_governance
    live_execution --> deployments
    deployments --> governance
    deployments --> model_monitoring
    governance --> testing
    live_execution --> nested_trees
    live_execution --> variables
    testing --> nested_trees
    workers --> notifications
    qa_lab --> variables
    testing --> variables
    testing --> workers
    calculated_fields --> graph
    graph --> calculated_fields
    outcome_ingestion --> runtime
    variables --> graph
    qa_lab --> workers
    code_import --> graph
    deployments --> graph
    deployments --> runtime
    deployments --> risk_governance
```

## Acoplamiento por módulo

Un `fan-in` alto significa que muchos módulos dependen de este: cambiarlo es caro. Un
`fan-out` alto significa que este depende de muchos: es frágil ante cambios ajenos.

| Módulo | Fan-in | Fan-out |
| --- | ---: | ---: |
| [`graph`](../modules/graph.md) | 145 | 5 |
| [`runtime`](../modules/runtime.md) | 8 | 93 |
| [`qa-lab`](../modules/qa-lab.md) | 24 | 41 |
| [`deployments`](../modules/deployments.md) | 26 | 29 |
| [`workers`](../modules/workers.md) | 21 | 25 |
| [`nested-trees`](../modules/nested-trees.md) | 23 | 22 |
| [`artifacts`](../modules/artifacts.md) | 25 | 18 |
| [`calculated-fields`](../modules/calculated-fields.md) | 5 | 38 |
| [`testing`](../modules/testing.md) | 6 | 29 |
| [`variables`](../modules/variables.md) | 31 | 4 |
| [`governance`](../modules/governance.md) | 6 | 20 |
| [`live-execution`](../modules/live-execution.md) | 0 | 26 |
| [`risk-governance`](../modules/risk-governance.md) | 10 | 11 |
| [`model-monitoring`](../modules/model-monitoring.md) | 20 | 0 |
| [`libraries`](../modules/libraries.md) | 19 | 0 |
| [`code-import`](../modules/code-import.md) | 0 | 13 |
| [`outcome-ingestion`](../modules/outcome-ingestion.md) | 0 | 8 |
| [`security-review`](../modules/security-review.md) | 7 | 0 |
| [`notifications`](../modules/notifications.md) | 6 | 0 |
| [`audit-query`](../modules/audit-query.md) | 0 | 0 |
| [`data-subject`](../modules/data-subject.md) | 0 | 0 |
| [`health`](../modules/health.md) | 0 | 0 |
| [`identity-session`](../modules/identity-session.md) | 0 | 0 |
| [`manual-review`](../modules/manual-review.md) | 0 | 0 |
| [`outbox-relay`](../modules/outbox-relay.md) | 0 | 0 |
| [`platform-catalog`](../modules/platform-catalog.md) | 0 | 0 |
| [`seeding`](../modules/seeding.md) | 0 | 0 |
| [`sql-console`](../modules/sql-console.md) | 0 | 0 |
| [`traceability`](../modules/traceability.md) | 0 | 0 |
| [`tutorials`](../modules/tutorials.md) | 0 | 0 |
| [`views`](../modules/views.md) | 0 | 0 |

## Ciclos

- `calculated-fields` ↔ `graph`
- `deployments` ↔ `runtime`

!!! note "La regla que evita los ciclos"
    Cuando un servicio necesita colaborar con otro dominio **de forma opcional**, se pasa como
    argumento de llamada y no como dependencia de constructor. Es lo que permite que el motor
    de ejecución no dependa del módulo de árboles anidados ni del stream en vivo.

