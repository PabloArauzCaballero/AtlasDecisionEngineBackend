<!-- GENERADO POR scripts/docs/analyze-graphify.mjs — NO EDITAR A MANO.
     Fuente: graphify-out/graph.json contrastado con src/. -->

# Auditoría del grafo de conocimiento (Graphify)

**Commit analizado:** `af6b2e7da9096a22d596a6c86a93719f3d34f238`
**Artefactos consultados:** `graphify-out/graph.json`, `manifest.json`, `GRAPH_REPORT.md`.

## Resumen ejecutivo

El grafo contiene **12281 nodos** y **29289 relaciones** repartidos en
**615 comunidades**. El árbol real declara
**33 módulos de dominio** en `src/modules/`, de los cuales
todos están registrados en `src/app.module.ts` (comprobado sobre el fichero, no supuesto).

El grafo cubre **654 de 1241**
ficheros TypeScript de `src/` (53 %).
**2 módulo(s) de dominio no aparecen en absoluto**: `atlas-callback`, `reference-catalog`. Consultar el grafo sobre ellos no devuelve nada, así que su documentación **no** se deriva de aquí.

## Inventario cuantitativo

| Tipo de nodo | Cantidad |
| --- | ---: |
| code | 9249 |
| document | 2924 |
| concept | 107 |
| rationale | 1 |

| Relación | Cantidad | Qué significa |
| --- | ---: | --- |
| `contains` | 7297 | Jerarquía de contención (fichero → símbolo) |
| `references` | 6071 | Un símbolo menciona a otro |
| `imports` | 5407 | Import de módulo |
| `calls` | 4076 | Llamada directa |
| `imports_from` | 3527 | Import con origen explícito |
| `method` | 2311 | Método de una clase |
| `indirect_call` | 337 | Llamada resuelta indirectamente |
| `inherits` | 100 | Herencia |
| `implements` | 93 | — |
| `cites` | 22 | — |
| `re_exports` | 18 | Reexportación |
| `defines` | 15 | Definición de símbolo |
| `extends` | 14 | Extensión de tipo o clase |
| `rationale_for` | 1 | Justificación documental de un elemento |

## Componentes de alta centralidad

Los nodos con más relaciones son los que, al cambiar, arrastran a más partes del sistema.
No son necesariamente un problema: en este repositorio los primeros puestos los ocupan el
esquema de datos y el módulo raíz, que por definición los tocan todos.

| Nodo | Fichero | Entradas | Salidas | Total |
| --- | --- | ---: | ---: | ---: |
| `PrismaService` | `src/common/prisma/prisma.service.ts` | 325 | 5 | 330 |
| `AuthenticatedPrincipal` | `src/common/security/security.types.ts` | 253 | 0 | 253 |
| `Roles()` | `src/common/security/security.decorators.ts` | 235 | 0 | 235 |
| `TenantId` | `src/common/security/security.decorators.ts` | 224 | 0 | 224 |
| `workers.module.ts` | `src/modules/workers/workers.module.ts` | 4 | 171 | 175 |
| `pdf-worker.module.ts` | `src/pdf-worker/pdf-worker.module.ts` | 8 | 133 | 141 |
| `prisma.service.ts` | `src/common/prisma/prisma.service.ts` | 130 | 7 | 137 |
| `DomainException` | `src/common/errors/domain-exception.ts` | 127 | 1 | 128 |
| `parseBigIntId()` | `src/common/http/id.ts` | 126 | 0 | 126 |
| `MetricsService` | `src/common/observability/metrics.service.ts` | 85 | 36 | 121 |
| `domain-exception.ts` | `src/common/errors/domain-exception.ts` | 115 | 1 | 116 |
| `CurrentPrincipal` | `src/common/security/security.decorators.ts` | 114 | 0 | 114 |
| `Catálogo de entidades` | `docs/data/entity-catalog.md` | 1 | 100 | 101 |
| `identity-pipeline.service.ts` | `src/modules/workers/identity-verification/identity-pipeline.service.ts` | 7 | 92 | 99 |
| `app.module.ts` | `src/app.module.ts` | 3 | 93 | 96 |
| `security.types.ts` | `src/common/security/security.types.ts` | 86 | 5 | 91 |
| `graph.types.ts` | `src/modules/graph/graph.types.ts` | 57 | 33 | 90 |
| `statement-engine.ts` | `src/modules/workers/bank-statement/core/statement-engine.ts` | 4 | 80 | 84 |
| `bank-statement-worker.service.ts` | `src/modules/workers/bank-statement/core/application/bank-statement-worker.service.ts` | 1 | 75 | 76 |
| `scripts` | `package.json` | 1 | 71 | 72 |

## Dependencias circulares entre módulos

Pares de módulos que se referencian en ambos sentidos. Cada uno merece una revisión:
la regla del repositorio es que una colaboración opcional se pase como **argumento de
llamada**, no como dependencia de constructor.

| Módulo A | Módulo B | A→B | B→A |
| --- | --- | ---: | ---: |
| `calculated-fields` | `graph` | 5 | 5 |
| `deployments` | `runtime` | 3 | 20 |

## Componentes huérfanos

11 nodos no participan en ninguna relación del grafo.
La mayoría son ficheros de configuración y documentos sueltos, que por naturaleza no importan ni son importados. Se listan los primeros 20:

- `docs/plantuml/compile_all.ps1`
- `docs/script-prueba.js`
- `docs/script-prueba.py`
- `eslint.config.mjs`
- `jest.config.js`
- `prisma.config.ts`
- `scripts/smoke.ps1`
- `test/rls-guc-contamination.integration.spec.ts`
- `test/setup-env.ts`
- `test/tenant-rls-views.integration.spec.ts`
- `src/modules/workers/bank-statement/core/engine/document-routes.ts`

## Divergencia entre el grafo y el disco

### El grafo menciona ficheros que ya no existen

**61 ficheros** referenciados por el grafo ya no existen en disco. El grafo está desactualizado respecto al árbol; ejecute `graphify update .`:

- `src/common/contracts/constraint-engine.ts`
- `src/common/llm/openai-compatible-transport.ts`
- `src/common/openapi/openapi-document.ts`
- `src/common/seeding/seed-sync.ts`
- `src/common/statistics/binomial.ts`
- `src/modules/artifacts/artifact.response.dto.ts`
- `src/modules/artifacts/artifact.service.ts`
- `src/modules/audit-query/adapters/postgres-decision-audit-read.adapter.ts`
- `src/modules/calculated-fields/calculated-field.response.dto.ts`
- `src/modules/calculated-fields/calculated-field.service.ts`
- `src/modules/calculated-fields/operation-catalog.ts`
- `src/modules/code-import/branch-reader.ts`
- `src/modules/code-import/expression-parser.ts`
- `src/modules/deployments/deployment.service.ts`
- `src/modules/governance/governance.service.ts`
- `src/modules/graph/validators/graph-intermediate.validator.ts`
- `src/modules/graph/validators/graph-structure.validator.ts`
- `src/modules/graph/worker-call.ts`
- `src/modules/manual-review/manual-review.service.ts`
- `src/modules/model-monitoring/model-monitoring.service.ts`

### El disco tiene código que el grafo desconoce

Es la dirección que más daño hace: sobre un fichero ausente el grafo no devuelve nada, y una
consulta vacía se lee igual que «no existe». Por eso los catálogos del portal se generan del
código y del contrato, nunca de este grafo.

**587 de 1241** ficheros `.ts` de `src/` no aparecen en el grafo, incluidos **2 módulo(s) completos** (`atlas-callback`, `reference-catalog`). Se listan los primeros 20:

- `src/common/config/build-identity.ts`
- `src/common/config/env/audio-tts.env.ts`
- `src/common/config/env/auth.env.ts`
- `src/common/config/env/bank-statement.env.ts`
- `src/common/config/env/bootstrap.env.ts`
- `src/common/config/env/callback-and-monitoring.env.ts`
- `src/common/config/env/data-stores.env.ts`
- `src/common/config/env/engine-and-qa.env.ts`
- `src/common/config/env/env-object.ts`
- `src/common/config/env/helpers.ts`
- `src/common/config/env/http-and-observability.env.ts`
- `src/common/config/env/identity-worker.env.ts`
- `src/common/config/env/jobs.env.ts`
- `src/common/config/env/nested-trees-and-outbox.env.ts`
- `src/common/config/env/object-storage.env.ts`
- `src/common/config/env/rules/audio-tts-coherence.rules.ts`
- `src/common/config/env/rules/audit-hash.rules.ts`
- `src/common/config/env/rules/auth.rules.ts`
- `src/common/config/env/rules/data-routing.rules.ts`
- `src/common/config/env/rules/env-rule.ts`

## Riesgos identificados

| Riesgo | Naturaleza | Mitigación vigente |
| --- | --- | --- |
| El grafo se desactualiza tras cada cambio de código | Documental | `graphify update .` tras modificar código; esta auditoría detecta la divergencia en ambos sentidos |
| El grafo desconoce 2 módulo(s) (atlas-callback, reference-catalog), así que consultarlo sobre ellos devuelve vacío | Documental | Su documentación se deriva del código y del contrato; esta auditoría lo declara en vez de ocultarlo |
| Un módulo con mucho fan-in concentra el impacto de sus cambios | Arquitectónico | Contratos explícitos y pruebas por módulo |
| La documentación derivada del grafo hereda sus errores | Documental | Los catálogos del portal se generan del **código y del contrato**, no del grafo |

## Acciones ejecutadas a partir de esta auditoría

1. Se generó [`architecture/module-dependencies.md`](../architecture/module-dependencies.md) con el grafo real de dependencias entre módulos.
2. Los catálogos de endpoints, entidades, eventos, errores y configuración se derivan del código, no de este grafo, para no propagar su desfase.
3. Esta auditoría es reproducible: `node scripts/docs/analyze-graphify.mjs`.

