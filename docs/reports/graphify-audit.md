<!-- GENERADO POR scripts/docs/analyze-graphify.mjs — NO EDITAR A MANO.
     Fuente: graphify-out/graph.json contrastado con src/. -->

# Auditoría del grafo de conocimiento (Graphify)

**Commit analizado:** `50f9f7ce9dd5d37a626926f3e4f99c886b5002e9`
**Artefactos consultados:** `graphify-out/graph.json`, `manifest.json`, `GRAPH_REPORT.md`.

## Resumen ejecutivo

El grafo contiene **2724 nodos** y **6056 relaciones** repartidos en
**295 comunidades**. El árbol real declara
**24 módulos de dominio** en `src/modules/`, todos registrados en
`src/app.module.ts`.

## Inventario cuantitativo

| Tipo de nodo | Cantidad |
| --- | ---: |
| code | 2141 |
| document | 525 |
| concept | 57 |
| rationale | 1 |

| Relación | Cantidad | Qué significa |
| --- | ---: | --- |
| `references` | 1576 | Un símbolo menciona a otro |
| `contains` | 1292 | Jerarquía de contención (fichero → símbolo) |
| `imports` | 1042 | Import de módulo |
| `imports_from` | 808 | Import con origen explícito |
| `calls` | 717 | Llamada directa |
| `method` | 525 | Método de una clase |
| `indirect_call` | 59 | Llamada resuelta indirectamente |
| `inherits` | 15 | Herencia |
| `extends` | 12 | Extensión de tipo o clase |
| `defines` | 4 | Definición de símbolo |
| `triggers` | 3 | Disparo de un efecto |
| `reads_from` | 1 | Lectura de un origen de datos |
| `rationale_for` | 1 | Justificación documental de un elemento |
| `re_exports` | 1 | Reexportación |

## Componentes de alta centralidad

Los nodos con más relaciones son los que, al cambiar, arrastran a más partes del sistema.
No son necesariamente un problema: en este repositorio los primeros puestos los ocupan el
esquema de datos y el módulo raíz, que por definición los tocan todos.

| Nodo | Fichero | Entradas | Salidas | Total |
| --- | --- | ---: | ---: | ---: |
| `PrismaService` | `src/common/prisma/prisma.service.ts` | 144 | 8 | 152 |
| `AuthenticatedPrincipal` | `src/common/security/security.types.ts` | 119 | 0 | 119 |
| `TenantId` | `src/common/security/security.decorators.ts` | 98 | 0 | 98 |
| `demo-graph.ts` | `src/modules/seeding/data/demo-graph.ts` | 3 | 84 | 87 |
| `Roles()` | `src/common/security/security.decorators.ts` | 86 | 0 | 86 |
| `parseBigIntId()` | `src/common/http/id.ts` | 84 | 0 | 84 |
| `app.module.ts` | `src/app.module.ts` | 2 | 59 | 61 |
| `prisma.service.ts` | `src/common/prisma/prisma.service.ts` | 54 | 3 | 57 |
| `DomainException` | `src/common/errors/domain-exception.ts` | 54 | 1 | 55 |
| `CurrentPrincipal` | `src/common/security/security.decorators.ts` | 55 | 0 | 55 |
| `domain-exception.ts` | `src/common/errors/domain-exception.ts` | 49 | 1 | 50 |
| `HashService` | `src/common/crypto/hash.service.ts` | 38 | 9 | 47 |
| `migration.sql` | `prisma/migrations/20260712190000_init/migration.sql` | 0 | 46 | 46 |
| `security.types.ts` | `src/common/security/security.types.ts` | 40 | 5 | 45 |
| `code-import.service.ts` | `src/modules/code-import/code-import.service.ts` | 2 | 42 | 44 |
| `graph.types.ts` | `src/modules/graph/graph.types.ts` | 26 | 18 | 44 |
| `AuditService` | `src/common/audit/audit.service.ts` | 33 | 4 | 37 |
| `id.ts` | `src/common/http/id.ts` | 33 | 4 | 37 |
| `MetricsService` | `src/common/observability/metrics.service.ts` | 27 | 10 | 37 |
| `security.decorators.ts` | `src/common/security/security.decorators.ts` | 25 | 11 | 36 |

## Dependencias circulares entre módulos

No se detectó ningún par de módulos de dominio que se referencie en ambos sentidos.

## Componentes huérfanos

15 nodos no participan en ninguna relación del grafo.
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
- `scripts/validate-migrations.py`
- `test/setup-env.ts`
- `test/tenant-rls-views.integration.spec.ts`

## Divergencia entre el grafo y el disco

Todo fichero referenciado por el grafo existe en el árbol de trabajo. El grafo está alineado con el disco.

## Riesgos identificados

| Riesgo | Naturaleza | Mitigación vigente |
| --- | --- | --- |
| El grafo se desactualiza tras cada cambio de código | Documental | `graphify update .` tras modificar código; esta auditoría detecta la divergencia |
| Un módulo con mucho fan-in concentra el impacto de sus cambios | Arquitectónico | Contratos explícitos y pruebas por módulo |
| La documentación derivada del grafo hereda sus errores | Documental | Los catálogos del portal se generan del **código y del contrato**, no del grafo |

## Acciones ejecutadas a partir de esta auditoría

1. Se generó [`architecture/module-dependencies.md`](../architecture/module-dependencies.md) con el grafo real de dependencias entre módulos.
2. Los catálogos de endpoints, entidades, eventos, errores y configuración se derivan del código, no de este grafo, para no propagar su desfase.
3. Esta auditoría es reproducible: `node scripts/docs/analyze-graphify.mjs`.

