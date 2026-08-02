# Matriz de trazabilidad

Enlaza **necesidad de negocio → código → contrato → datos → prueba**. Sirve para responder «¿qué
respalda esta afirmación?» sin buscar a ciegas.

## Capacidades

| # | Necesidad de negocio | Código | Contrato / API | Datos | Prueba |
| --- | --- | --- | --- | --- | --- |
| N1 | Variables con contrato explícito, validado en servidor | `modules/variables/`, `common/contracts/constraint-engine.ts` | `Variable Catalog` | `decision_variable`, `decision_variable_version` | `constraint-engine.spec.ts`, `variable-resolution.spec.ts` |
| N2 | Valores temporales que no contaminan el catálogo | `graph/intermediate-scope.ts` | — | `decision_intermediate_variable` | `intermediate-scope.spec.ts`, `engine-intermediate-properties.spec.ts` |
| N3 | La salida no se infiere del último nodo | `validators/graph-output-contract.validator.ts` | — | `decision_output_contract_field` | `graph-contract-validators.spec.ts` |
| N4 | Funciones reutilizables y gobernadas | `modules/calculated-fields/` | `Calculated Fields` | tablas de campo calculado | `calculated-fields.spec.ts`, `graph-calculated-fields.spec.ts` |
| N5 | Librerías solo con prelude revisado | `modules/libraries/` | `Approved Libraries` | registro de librerías | pruebas del módulo |
| N6 | Diseñar y compilar un algoritmo | `graph/compiler.service.ts`, `graph-validator.service.ts` | `Decision Artifacts` | artefacto, versión, nodos, aristas | `checksum-stability.spec.ts`, `graph-validator-rules.spec.ts` |
| N7 | Importar código existente sin ejecutarlo | `modules/code-import/` | `Code to Flow Import` | tablas de importación | `code-import-pipeline.spec.ts` |
| N8 | Encadenar algoritmos con presupuesto | `modules/nested-trees/` | `Nested Decision Trees` | `decision_execution_tree_link` | `chain-budget.spec.ts`, `cycle-detector.spec.ts`, e2e |
| N9 | Regresión determinista | `modules/testing/` | `Decision Testing` | suites, casos, corridas | suites del módulo |
| N10 | Generación masiva reproducible | `modules/qa-lab/` | `QA Lab` | corridas y contraejemplos | `qa-lab-generator.spec.ts` |
| N11 | Aprobación con segregación de funciones | `modules/governance/` | `Decision Governance` | solicitudes y pasos | `governance-sod.integration.spec.ts` (20) |
| N12 | Despliegue y reversión por ambiente | `modules/deployments/` | `Decision Deployments` | `decision_deployment` | `deployment-invariants.integration.spec.ts` |
| N13 | Decisión idempotente con evidencia | `modules/runtime/` | `Decision Runtime` | ejecución y satélites | `idempotency-*.spec.ts`, `runtime.e2e-spec.ts` |
| N14 | Simular y comparar con PROD | `runtime/simulation.service.ts` | `Decision Simulation` | — (no persiste) | `simulation.service.spec.ts` |
| N15 | Revisión manual | `modules/manual-review/` | `Manual Review` | `decision_manual_review_case` | pruebas del módulo |
| N16 | Evidencia inalterable | `common/audit/`, migraciones append-only | `Audit and Observability` | `decision_audit_event` | `audit-*.spec.ts` |
| N17 | Notificar sin perder ni duplicar | `common/events/`, `outbox-relay/`, `notifications/` | `Notifications` | outbox, `decision_processed_event` | `outbox-*.spec.ts`, `notification-*.spec.ts` |

## Controles de seguridad

| # | Control | Código | Prueba |
| --- | --- | --- | --- |
| S1 | La identidad no viene del llamante | `authentication.guard.ts` | `identity-*.spec.ts` |
| S2 | Comodín solo en identidad firmada | `roles.guard.ts` | `api-key-privilege-escalation.spec.ts` |
| S3 | Aislamiento por tenant en el motor | migraciones RLS, `prisma.service.ts` | `tenant-rls-isolation.integration.spec.ts` |
| S4 | Código importado aislado | `script-node-runner.service.ts`, `runner/server.mjs` | `sidecar-sandbox-escape.spec.ts`, `script-runner-production-guard.spec.ts` |
| S5 | Auditoría append-only | migración `audit_append_only` | `audit-append-only.spec.ts` |
| S6 | Sin secretos en artefactos versionados | `env.schema.ts`, compose, smoke | `env-schema.spec.ts`, `docs:openapi:check` |
| S7 | Anti-ReDoS en patrones dinámicos | `common/validation/safe-regex.ts` | `safe-regex.spec.ts` |

## Trabajos de fondo

| # | Necesidad | Código | Prueba |
| --- | --- | --- | --- |
| B1 | Escalar fondo y API por separado | `common/config/worker-role.ts`, `src/worker.ts` | `worker-role.spec.ts` |
| B2 | Despacho sin doble entrega | `outbox-relay.service.ts` | `outbox-relay.spec.ts` |
| B3 | Crecimiento acotado de idempotencia | `retention-sweeper.service.ts` | `retention-sweeper.spec.ts` |

## Cómo mantenerla

Al añadir una capacidad, añada su fila. Una fila sin prueba es una afirmación sin respaldo: o
se escribe la prueba, o se registra como brecha en el
[análisis de brechas](../reports/documentation-gap-analysis.md).
