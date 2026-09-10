<!-- GENERADO POR scripts/docs/analyze-graphify.mjs — NO EDITAR A MANO.
     Fuente: graphify-out/graph.json contrastado con src/. -->

# Auditoría del grafo de conocimiento (Graphify)

**Commit analizado:** `ab59e5971cc89066d215cbab8f0623ab560d09be`
**Artefactos consultados:** `graphify-out/graph.json`, `manifest.json`, `GRAPH_REPORT.md`.

## Resumen ejecutivo

El grafo contiene **11768 nodos** y **28152 relaciones** repartidos en
**552 comunidades**. El árbol real declara
**31 módulos de dominio** en `src/modules/`, de los cuales
todos están registrados en `src/app.module.ts` (comprobado sobre el fichero, no supuesto).

El grafo cubre **693 de 704**
ficheros TypeScript de `src/` (98 %).
Todos los módulos de dominio aparecen en el grafo.

## Inventario cuantitativo

| Tipo de nodo | Cantidad |
| --- | ---: |
| code | 8812 |
| document | 2848 |
| concept | 107 |
| rationale | 1 |

| Relación | Cantidad | Qué significa |
| --- | ---: | --- |
| `contains` | 6876 | Jerarquía de contención (fichero → símbolo) |
| `references` | 6009 | Un símbolo menciona a otro |
| `imports` | 5169 | Import de módulo |
| `calls` | 3867 | Llamada directa |
| `imports_from` | 3393 | Import con origen explícito |
| `method` | 2271 | Método de una clase |
| `indirect_call` | 309 | Llamada resuelta indirectamente |
| `inherits` | 99 | Herencia |
| `implements` | 91 | — |
| `cites` | 22 | — |
| `re_exports` | 16 | Reexportación |
| `defines` | 15 | Definición de símbolo |
| `extends` | 14 | Extensión de tipo o clase |
| `rationale_for` | 1 | Justificación documental de un elemento |

## Componentes de alta centralidad

Los nodos con más relaciones son los que, al cambiar, arrastran a más partes del sistema.
No son necesariamente un problema: en este repositorio los primeros puestos los ocupan el
esquema de datos y el módulo raíz, que por definición los tocan todos.

| Nodo | Fichero | Entradas | Salidas | Total |
| --- | --- | ---: | ---: | ---: |
| `PrismaService` | `src/common/prisma/prisma.service.ts` | 324 | 5 | 329 |
| `AuthenticatedPrincipal` | `src/common/security/security.types.ts` | 252 | 0 | 252 |
| `Roles()` | `src/common/security/security.decorators.ts` | 235 | 0 | 235 |
| `TenantId` | `src/common/security/security.decorators.ts` | 224 | 0 | 224 |
| `workers.module.ts` | `src/modules/workers/workers.module.ts` | 3 | 163 | 166 |
| `pdf-worker.module.ts` | `src/pdf-worker/pdf-worker.module.ts` | 8 | 133 | 141 |
| `prisma.service.ts` | `src/common/prisma/prisma.service.ts` | 130 | 7 | 137 |
| `DomainException` | `src/common/errors/domain-exception.ts` | 125 | 1 | 126 |
| `parseBigIntId()` | `src/common/http/id.ts` | 126 | 0 | 126 |
| `MetricsService` | `src/common/observability/metrics.service.ts` | 84 | 36 | 120 |
| `domain-exception.ts` | `src/common/errors/domain-exception.ts` | 113 | 1 | 114 |
| `CurrentPrincipal` | `src/common/security/security.decorators.ts` | 114 | 0 | 114 |
| `Catálogo de entidades` | `docs/data/entity-catalog.md` | 1 | 100 | 101 |
| `app.module.ts` | `src/app.module.ts` | 3 | 93 | 96 |
| `security.types.ts` | `src/common/security/security.types.ts` | 86 | 5 | 91 |
| `identity-pipeline.service.ts` | `src/modules/workers/identity-verification/identity-pipeline.service.ts` | 7 | 82 | 89 |
| `graph.types.ts` | `src/modules/graph/graph.types.ts` | 55 | 33 | 88 |
| `statement-engine.ts` | `src/modules/workers/bank-statement/core/statement-engine.ts` | 4 | 78 | 82 |
| `bank-statement-worker.service.ts` | `src/modules/workers/bank-statement/core/application/bank-statement-worker.service.ts` | 1 | 75 | 76 |
| `ports.ts` | `src/modules/workers/semantic-analysis/core/application/ports.ts` | 27 | 45 | 72 |

## Dependencias circulares entre módulos

Pares de módulos que se referencian en ambos sentidos. Cada uno merece una revisión:
la regla del repositorio es que una colaboración opcional se pase como **argumento de
llamada**, no como dependencia de constructor.

| Módulo A | Módulo B | A→B | B→A |
| --- | --- | ---: | ---: |
| `calculated-fields` | `graph` | 5 | 5 |
| `deployments` | `runtime` | 3 | 20 |

## Componentes huérfanos

10 nodos no participan en ninguna relación del grafo.
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

## Divergencia entre el grafo y el disco

### El grafo menciona ficheros que ya no existen

**1 ficheros** referenciados por el grafo ya no existen en disco. El grafo está desactualizado respecto al árbol; ejecute `graphify update .`:

- `src/modules/workers/semantic-analysis/core/infrastructure/http/openai-compatible-transport.ts`

### El disco tiene código que el grafo desconoce

Es la dirección que más daño hace: sobre un fichero ausente el grafo no devuelve nada, y una
consulta vacía se lee igual que «no existe». Por eso los catálogos del portal se generan del
código y del contrato, nunca de este grafo.

**11 de 704** ficheros `.ts` de `src/` no aparecen en el grafo. Se listan los primeros 20:

- `src/common/llm/llm-provider.error.ts`
- `src/common/llm/openai-compatible-transport.ts`
- `src/common/llm/openrouter-chat.client.ts`
- `src/modules/runtime/manual-review-case-code.ts`
- `src/modules/workers/bank-statement/core/engine/generic/column-advisor.ts`
- `src/modules/workers/bank-statement/core/infrastructure/openrouter-column-advisor.adapter.ts`
- `src/modules/workers/identity-verification/core/adapters/document-framing.ts`
- `src/modules/workers/identity-verification/core/adapters/openrouter-second-reader.adapter.ts`
- `src/modules/workers/identity-verification/core/engine/second-reader.ts`
- `src/modules/workers/identity-verification/core/forensics/selfie-liveness.ts`
- `src/modules/workers/semantic-analysis/core/infrastructure/http/semantic-transport.errors.ts`

## Riesgos identificados

| Riesgo | Naturaleza | Mitigación vigente |
| --- | --- | --- |
| El grafo se desactualiza tras cada cambio de código | Documental | `graphify update .` tras modificar código; esta auditoría detecta la divergencia en ambos sentidos |
| Ningún módulo de dominio queda fuera del grafo | Documental | Comprobado en cada ejecución de esta auditoría |
| Un módulo con mucho fan-in concentra el impacto de sus cambios | Arquitectónico | Contratos explícitos y pruebas por módulo |
| La documentación derivada del grafo hereda sus errores | Documental | Los catálogos del portal se generan del **código y del contrato**, no del grafo |

## Acciones ejecutadas a partir de esta auditoría

1. Se generó [`architecture/module-dependencies.md`](../architecture/module-dependencies.md) con el grafo real de dependencias entre módulos.
2. Los catálogos de endpoints, entidades, eventos, errores y configuración se derivan del código, no de este grafo, para no propagar su desfase.
3. Esta auditoría es reproducible: `node scripts/docs/analyze-graphify.mjs`.

