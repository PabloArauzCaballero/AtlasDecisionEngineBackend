<!-- GENERADO POR scripts/docs/analyze-graphify.mjs — NO EDITAR A MANO.
     Fuente: graphify-out/graph.json contrastado con src/. -->

# Auditoría del grafo de conocimiento (Graphify)

**Commit analizado:** `af6b2e7da9096a22d596a6c86a93719f3d34f238`
**Artefactos consultados:** `graphify-out/graph.json`, `manifest.json`, `GRAPH_REPORT.md`.

## Resumen ejecutivo

El grafo contiene **12281 nodos** y **29289 relaciones** repartidos en
**615 comunidades**. El árbol real declara
**31 módulos de dominio** en `src/modules/`, de los cuales
todos están registrados en `src/app.module.ts` (comprobado sobre el fichero, no supuesto).

El grafo cubre **715 de 715**
ficheros TypeScript de `src/` (100 %).
Todos los módulos de dominio aparecen en el grafo.

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

Todo fichero referenciado por el grafo existe en el árbol de trabajo.

### El disco tiene código que el grafo desconoce

Es la dirección que más daño hace: sobre un fichero ausente el grafo no devuelve nada, y una
consulta vacía se lee igual que «no existe». Por eso los catálogos del portal se generan del
código y del contrato, nunca de este grafo.

Todo fichero `.ts` de `src/` está representado en el grafo.

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

