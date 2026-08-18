<!-- GENERADO POR scripts/docs/analyze-graphify.mjs — NO EDITAR A MANO.
     Fuente: graphify-out/graph.json contrastado con src/. -->

# Auditoría del grafo de conocimiento (Graphify)

**Commit analizado:** `desconocido`
**Artefactos consultados:** `graphify-out/graph.json`, `manifest.json`, `GRAPH_REPORT.md`.

## Resumen ejecutivo

El grafo contiene **5003 nodos** y **10304 relaciones** repartidos en
**439 comunidades**. El árbol real declara
**30 módulos de dominio** en `src/modules/`, de los cuales
todos están registrados en `src/app.module.ts` (comprobado sobre el fichero, no supuesto).

El grafo cubre **250 de 663**
ficheros TypeScript de `src/` (38 %).
**6 módulo(s) de dominio no aparecen en absoluto**: `data-subject`, `model-monitoring`, `outcome-ingestion`, `risk-governance`, `sql-console`, `workers`. Consultar el grafo sobre ellos no devuelve nada, así que su documentación **no** se deriva de aquí.

## Inventario cuantitativo

| Tipo de nodo | Cantidad |
| --- | ---: |
| code | 3197 |
| document | 1740 |
| concept | 64 |
| rationale | 2 |

| Relación | Cantidad | Qué significa |
| --- | ---: | --- |
| `contains` | 3032 | Jerarquía de contención (fichero → símbolo) |
| `references` | 2484 | Un símbolo menciona a otro |
| `imports` | 1618 | Import de módulo |
| `imports_from` | 1185 | Import con origen explícito |
| `calls` | 1155 | Llamada directa |
| `method` | 677 | Método de una clase |
| `indirect_call` | 91 | Llamada resuelta indirectamente |
| `inherits` | 34 | Herencia |
| `extends` | 12 | Extensión de tipo o clase |
| `reads_from` | 4 | Lectura de un origen de datos |
| `triggers` | 3 | Disparo de un efecto |
| `implements` | 3 | — |
| `re_exports` | 3 | Reexportación |
| `rationale_for` | 2 | Justificación documental de un elemento |
| `cites` | 1 | — |

## Componentes de alta centralidad

Los nodos con más relaciones son los que, al cambiar, arrastran a más partes del sistema.
No son necesariamente un problema: en este repositorio los primeros puestos los ocupan el
esquema de datos y el módulo raíz, que por definición los tocan todos.

| Nodo | Fichero | Entradas | Salidas | Total |
| --- | --- | ---: | ---: | ---: |
| `PrismaService` | `src/common/prisma/prisma.service.ts` | 168 | 8 | 176 |
| `AuthenticatedPrincipal` | `src/common/security/security.types.ts` | 138 | 0 | 138 |
| `TenantId` | `src/common/security/security.decorators.ts` | 118 | 0 | 118 |
| `Roles()` | `src/common/security/security.decorators.ts` | 110 | 0 | 110 |
| `parseBigIntId()` | `src/common/http/id.ts` | 101 | 0 | 101 |
| `demo-graph.ts` | `src/modules/seeding/data/demo-graph.ts` | 3 | 84 | 87 |
| `MetricsService` | `src/common/observability/metrics.service.ts` | 57 | 23 | 80 |
| `app.module.ts` | `src/app.module.ts` | 3 | 67 | 70 |
| `prisma.service.ts` | `src/common/prisma/prisma.service.ts` | 66 | 3 | 69 |
| `Catálogo de entidades` | `docs/data/entity-catalog.md` | 1 | 68 | 69 |
| `DomainException` | `src/common/errors/domain-exception.ts` | 66 | 1 | 67 |
| `graph.types.ts` | `src/modules/graph/graph.types.ts` | 41 | 26 | 67 |
| `CurrentPrincipal` | `src/common/security/security.decorators.ts` | 63 | 0 | 63 |
| `domain-exception.ts` | `src/common/errors/domain-exception.ts` | 61 | 1 | 62 |
| `HashService` | `src/common/crypto/hash.service.ts` | 45 | 9 | 54 |
| `security.types.ts` | `src/common/security/security.types.ts` | 47 | 5 | 52 |
| `execution-engine.service.ts` | `src/modules/graph/execution-engine.service.ts` | 17 | 34 | 51 |
| `qa-lab.service.ts` | `src/modules/qa-lab/qa-lab.service.ts` | 3 | 45 | 48 |
| `migration.sql` | `prisma/migrations/20260712190000_init/migration.sql` | 0 | 46 | 46 |
| `AuditService` | `src/common/audit/audit.service.ts` | 42 | 4 | 46 |

## Dependencias circulares entre módulos

Pares de módulos que se referencian en ambos sentidos. Cada uno merece una revisión:
la regla del repositorio es que una colaboración opcional se pase como **argumento de
llamada**, no como dependencia de constructor.

| Módulo A | Módulo B | A→B | B→A |
| --- | --- | ---: | ---: |
| `calculated-fields` | `graph` | 5 | 5 |

## Componentes huérfanos

14 nodos no participan en ninguna relación del grafo.
La mayoría son ficheros de configuración y documentos sueltos, que por naturaleza no importan ni son importados. Se listan los primeros 20:

- `docs/plantuml/compile_all.ps1`
- `docs/script-prueba.js`
- `docs/script-prueba.py`
- `jest.config.js`
- `prisma.config.ts`
- `prisma/migrations/20260717054500_async_test_run_queue/migration.sql`
- `prisma/migrations/20260719080000_tenant_rls_and_app_role/migration.sql`
- `prisma/migrations/20260719083000_fix_rls_empty_context/migration.sql`
- `prisma/migrations/20260719100000_views_security_invoker/migration.sql`
- `prisma/migrations/20260720030000_audit_event_tenant_keyset_index/migration.sql`
- `scripts/smoke.ps1`
- `scripts/validate-baseline.py`
- `test/setup-env.ts`
- `test/tenant-rls-views.integration.spec.ts`

## Divergencia entre el grafo y el disco

### El grafo menciona ficheros que ya no existen

**4 ficheros** referenciados por el grafo ya no existen en disco. El grafo está desactualizado respecto al árbol; ejecute `graphify update .`:

- `prisma/deploy-demo-all-envs.ts`
- `prisma/seed-chain-example.ts`
- `scripts/generate-baseline-sql.py`
- `scripts/validate-baseline.py`

### El disco tiene código que el grafo desconoce

Es la dirección que más daño hace: sobre un fichero ausente el grafo no devuelve nada, y una
consulta vacía se lee igual que «no existe». Por eso los catálogos del portal se generan del
código y del contrato, nunca de este grafo.

**413 de 663** ficheros `.ts` de `src/` no aparecen en el grafo, incluidos **6 módulo(s) completos** (`data-subject`, `model-monitoring`, `outcome-ingestion`, `risk-governance`, `sql-console`, `workers`). Se listan los primeros 20:

- `src/common/contracts/constraint-coherence.ts`
- `src/common/events/trace-carrier.ts`
- `src/common/observability/messaging-trace.service.ts`
- `src/common/observability/metrics-token.ts`
- `src/common/observability/telemetry.config.ts`
- `src/common/observability/telemetry.constants.ts`
- `src/common/observability/telemetry.instrumentations.ts`
- `src/common/observability/telemetry.types.ts`
- `src/common/observability/trace-context.service.ts`
- `src/common/observability/trace-error.ts`
- `src/common/observability/trace-response.interceptor.ts`
- `src/common/observability/tracing.service.ts`
- `src/common/persistence/adapters/postgres/read-path.service.ts`
- `src/common/persistence/adapters/postgres/write-path.service.ts`
- `src/common/persistence/connections/cache-connection.ts`
- `src/common/persistence/connections/connection-fingerprint.ts`
- `src/common/persistence/connections/connection-registry.service.ts`
- `src/common/persistence/connections/postgres-connection.ts`
- `src/common/persistence/errors/persistence-errors.ts`
- `src/common/persistence/errors/postgres-error-mapper.ts`

## Riesgos identificados

| Riesgo | Naturaleza | Mitigación vigente |
| --- | --- | --- |
| El grafo se desactualiza tras cada cambio de código | Documental | `graphify update .` tras modificar código; esta auditoría detecta la divergencia en ambos sentidos |
| El grafo desconoce 6 módulo(s) (data-subject, model-monitoring, outcome-ingestion, risk-governance, sql-console, workers), así que consultarlo sobre ellos devuelve vacío | Documental | Su documentación se deriva del código y del contrato; esta auditoría lo declara en vez de ocultarlo |
| Un módulo con mucho fan-in concentra el impacto de sus cambios | Arquitectónico | Contratos explícitos y pruebas por módulo |
| La documentación derivada del grafo hereda sus errores | Documental | Los catálogos del portal se generan del **código y del contrato**, no del grafo |

## Acciones ejecutadas a partir de esta auditoría

1. Se generó [`architecture/module-dependencies.md`](../architecture/module-dependencies.md) con el grafo real de dependencias entre módulos.
2. Los catálogos de endpoints, entidades, eventos, errores y configuración se derivan del código, no de este grafo, para no propagar su desfase.
3. Esta auditoría es reproducible: `node scripts/docs/analyze-graphify.mjs`.

