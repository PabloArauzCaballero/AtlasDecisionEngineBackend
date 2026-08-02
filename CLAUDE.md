## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

## Contratos de variables (§1–§4)

- Tipos canónicos y compatibilidad: `src/common/contracts/data-types.ts`.
- Restricciones configurables y su evaluación autoritativa:
  `src/common/contracts/constraint-engine.ts`. **Ninguna validación vive solo en el
  frontend**: el motor reevalúa siempre antes de ejecutar.
- Variables intermedias (`INTERMEDIATE`): tabla propia `decision_intermediate_variable`,
  ámbito por ejecución en `src/modules/graph/intermediate-scope.ts`, validación estática
  por dominancia en `validators/graph-intermediate.validator.ts`.
  Se referencian como `intermediate.<code>`; nunca cuelgan del catálogo global.
- Contrato de salida explícito: `decision_output_contract_field` +
  `validators/graph-output-contract.validator.ts`. La salida final no se infiere del
  último nodo.
- Manual: `docs/variable-contracts.md`. Decisiones: `docs/adr/ADR-0011-contract-extensions.md`.

## Campos calculados, librerías y QA Lab (§5–§10)

- `src/modules/calculated-fields/` — catálogo cerrado de operaciones visuales, guardián
  de código (máximo 3 líneas ejecutables) y contrato de retorno obligatorio.
- `src/modules/libraries/` — registro de librerías. Una fila solo puede HABILITAR un
  prelude ya presente en `library-preludes.ts`; nunca aportar código.
- `src/modules/qa-lab/` — generación masiva guiada por contrato, determinista por semilla,
  con reducción de contraejemplos. Faker y fast-check son dependencias de DESARROLLO y
  solo se usan en `test/`.
- Manual: `docs/calculated-fields.md`.
