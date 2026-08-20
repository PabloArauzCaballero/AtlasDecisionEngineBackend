# Superficie de persistencia

La capa que separa el dominio del motor de datos. Su objetivo es que un caso de uso pueda
decir *«necesito lectura eventual del módulo de auditoría»* sin poder decir *«usa el pool
de Prisma»*, y que cambiar la topología de datos —una réplica, un rol distinto, otro
motor— sea configuración y no una reescritura.

La decisión y sus alternativas están en
[ADR-0029](https://github.com/PabloArauzCaballero/AtlasDecisionEngineBackend/blob/main/adr/ADR-0029-polyglot-persistence-read-write.md).

## Dirección de dependencias

```text
Controladores (interfaces/http)
        ↓
Servicios de aplicación            ← dependen de PUERTOS
        ↓
Puertos de persistencia            ← sin Prisma, sin pg, sin tipos del driver
        ↓
Adaptadores por motor              ← única capa que habla Prisma
        ↓
Registro de conexiones · Router · Fábrica
        ↓
Pool pg / PrismaClient / PostgreSQL
```

Ni un solo archivo de `ports/` importa `@prisma/client`, `pg` ni `@nestjs/*` de dominio.
Esa es la propiedad que hace posible la suite de contrato: si el puerto estuviera calcado
del ORM, la implementación en memoria no podría superarla.

## Mapa de la capa

| Carpeta | Responsabilidad | Archivos clave |
| --- | --- | --- |
| `ports/` | Vocabulario y contratos sin infraestructura | `data-source.types.ts`, `repository.port.ts`, `adapter-capabilities.ts` |
| `connections/` | Pools, huellas saneadas, ciclo de vida | `connection-registry.service.ts`, `postgres-connection.ts`, `connection-fingerprint.ts`, `cache-connection.ts` |
| `routing/` | Reglas declarativas y resolución | `routing-rules.ts`, `data-source-router.service.ts` |
| `factory/` | Asas de lectura y escritura, validadas al construir | `persistence-adapter.factory.ts` |
| `adapters/postgres/` | Ejecución, fallback, transacciones, métricas | `read-path.service.ts`, `write-path.service.ts` |
| `errors/` | Errores normalizados y traducción de SQLSTATE | `persistence-errors.ts`, `postgres-error-mapper.ts` |
| `health/` | Sonda pública y muestreo de pools | `data-source-health.service.ts` |

Los dos clientes de PostgreSQL viven fuera de esta carpeta, junto al proxy de tenancy que
comparten: `src/common/prisma/prisma.service.ts` (escritura),
`src/common/prisma/prisma-read.service.ts` (lectura) y `src/common/prisma/tenant-rls.ts`.

## Diagrama

```mermaid
flowchart TD
    API[Controladores REST] --> APP[Servicios de aplicación]

    APP --> QUERIES[Consultas]
    APP --> COMMANDS[Comandos]

    QUERIES --> READ_PORT["Puertos de lectura<br/>DecisionAuditReadPort"]
    COMMANDS --> WRITE_PORT["Puertos de escritura<br/>TransactionManager"]

    READ_PORT --> READ_ADAPTER["Adaptador PostgreSQL de lectura"]
    WRITE_PORT --> WRITE_ADAPTER["Adaptador PostgreSQL de escritura"]

    READ_ADAPTER --> FACTORY[Fábrica de adaptadores]
    WRITE_ADAPTER --> FACTORY
    FACTORY --> ROUTER[Router de fuentes de datos]

    ROUTER --> RULES[["Reglas declarativas<br/>DATA_ROUTING_RULES"]]
    ROUTER --> REGISTRY[Registro de conexiones]

    REGISTRY --> PGW[("postgres-write<br/>atlas_writer")]
    REGISTRY --> PGR[("postgres-read<br/>atlas_reader")]
    REGISTRY --> CACHE[("redis-cache<br/>CacheService")]

    READ_ADAPTER -. "fallback declarado" .-> PGW

    ADMIN[["postgres-admin<br/>migraciones y aprovisionamiento"]] -.->|nunca se registra| REGISTRY

    HEALTH[/health/data-sources] --> REGISTRY
    METRICS[atlas_database_*] --> REGISTRY
```

`postgres-admin` aparece punteado a propósito: es un nombre **reservado** que el registro
se niega a registrar y el router se niega a resolver. Una conexión administrativa
alcanzable por inyección acaba, tarde o temprano, inyectada en un caso de uso ordinario.

## Qué garantiza el arranque

El contenedor no levanta si alguna de estas condiciones falla:

| Condición | Dónde se comprueba |
| --- | --- |
| `DATA_ROUTING_RULES` es JSON válido | `env.schema.ts` |
| La forma de cada regla es válida | `routing-rules.ts` (zod) |
| Toda conexión nombrada existe | `DataSourceRouterService.validateRules` |
| Ninguna regla usa `postgres-admin` | ídem |
| Ninguna escritura va a una conexión de solo lectura | ídem |
| El motor ofrece las capacidades que el módulo exige | ídem + `PersistenceAdapterFactory` |
| El adaptador habla el motor al que su módulo enruta | `PersistenceAdapterFactory` |
| Las conexiones responden | `ConnectionRegistryService.onModuleInit` |
| La conexión de escritura NO es superusuario | `PrismaService.assertNotSuperuser` |
| El rol de la conexión de lectura no puede escribir | `PrismaReadService.assertCannotWrite` |

Ningún mensaje de error de arranque contiene host, usuario ni cadena de conexión.

## Documentos relacionados

- [Inventario de fuentes de datos](source-inventory.md) — matriz de accesos por módulo.
- [Enrutamiento y configuración](read-write-routing.md) — escenarios A–F y variables.
- [Roles y privilegios PostgreSQL](postgres-roles.md) — aprovisionamiento idempotente.
- [Consistencia, transacciones y fallos](consistency-and-failure.md).
- [Persistencia políglota](polyglot.md).
- [Plan de migración y rollback](migration-plan.md).
- [Pruebas y evidencia](testing-and-evidence.md).
- [Arquitectura de datos](../data-architecture.md) — el modelo de datos en sí.
