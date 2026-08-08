# Inventario de fuentes de datos y matriz de accesos

Estado a 2026-08-06, tras la primera fase de la migración progresiva.

## Descubrimiento

| Dimensión | Valor real |
| --- | --- |
| Lenguaje / framework | TypeScript 5.8 · NestJS 11 |
| Gestor de paquetes | Yarn (`yarn.lock`) |
| ORM | Prisma 6 sobre `@prisma/adapter-pg` |
| Driver | `pg` 8 |
| Motores en uso | PostgreSQL 16 (datos), Redis 7 (caché y contadores) |
| Proveedor | Docker en desarrollo; genérico en despliegue |
| Migraciones | `prisma migrate`, 29 migraciones, con rol elevado |
| Semillas | `prisma db seed`, idempotentes |
| RLS | Sí, por tenant, desde la migración `20260719080000` |
| Rol de la aplicación | `atlas_app` (NO superusuario) |
| Archivos que inyectaban `PrismaService` | 52 |
| Consultas crudas (`$queryRaw`/`$executeRaw`) | 30 |

Nada de lo anterior se dio por supuesto: se leyó del repositorio antes de tocar código.

## Conexiones registradas

| Nombre lógico | Motor | Rol | Origen | Se registra en runtime |
| --- | --- | --- | --- | --- |
| `postgres-write` | postgresql | `write` | `DATABASE_WRITE_URL` → `DATABASE_URL` | Sí |
| `postgres-read` | postgresql | `read` | `DATABASE_READ_URL` → la de escritura | Sí (mismo objeto si la huella coincide) |
| `redis-cache` | redis | `read-write` | `CacheService` (`REDIS_URL`) | Sí |
| `postgres-admin` | postgresql | `admin` | `ADMIN_DATABASE_URL` | **No — nombre reservado** |

`postgres-admin` no se registra a propósito. Una conexión administrativa alcanzable por
inyección acaba, tarde o temprano, inyectada en un caso de uso ordinario; el registro la
rechaza y el router se niega a resolverla.

## Matriz de accesos por módulo

`Puerto` = el módulo depende de una interfaz sin infraestructura.
`Directo` = el módulo inyecta `PrismaService` (compatibilidad; ver
[plan de migración](migration-plan.md)).

| Módulo | Operación | R/W | Motor | Conexión | Acceso | Transacción | Riesgo | Adaptador destino |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `audit-query` | consultas, informes, cadena | R | postgresql | `postgres-read` | **Puerto** | no | bajo | ✅ `PostgresDecisionAuditReadAdapter` |
| `runtime` | ejecutar decisión | R+W | postgresql | `postgres-write` | Directo | sí | **alto** | Puerto de comandos |
| `governance` | aprobar, promover | R+W | postgresql | `postgres-write` | Directo | sí | **alto** | Puerto de comandos |
| `deployments` | despliegue activo | R+W | postgresql | `postgres-write` | Directo | sí | alto | Puerto de comandos |
| `artifacts` | versionado | R+W | postgresql | `postgres-write` | Directo | sí | medio | Puerto de comandos |
| `graph` | nodos, aristas, validación | R+W | postgresql | `postgres-write` | Directo | sí | medio | Puerto de comandos |
| `variables` | catálogo y contratos | R+W | postgresql | `postgres-write` | Directo | sí | medio | Lectura → puerto |
| `views` | modelos de lectura del portal | R | postgresql | `postgres-read` | Directo | no | bajo | **Siguiente piloto** |
| `traceability` | recorridos | R | postgresql | `postgres-read` | Directo | no | bajo | Siguiente piloto |
| `manual-review` | casos y resoluciones | R+W | postgresql | `postgres-write` | Directo | sí | medio | Puerto de comandos |
| `notifications` | bandeja | R+W | postgresql | `postgres-write` | Directo | sí | bajo | Lectura → puerto |
| `outbox-relay` | reparto de eventos | R+W | postgresql | `postgres-write` | Directo | sí | alto | Se queda directo (§) |
| `testing`, `qa-lab` | corridas y casos | R+W | postgresql | `postgres-write` | Directo | sí | medio | Puerto de comandos |
| `workers` | análisis semántico, extractos | R+W | postgresql | `postgres-write` | Directo | sí | medio | Puerto de comandos |
| `seeding` | semillas idempotentes | W | postgresql | `postgres-write` | Directo | sí | bajo | Se queda directo (§) |
| `health` | sondas | R | postgresql + redis | ambas | **Puerto** | no | bajo | ✅ `DataSourceHealthService` |
| `common/cache` | caché y rate limit | R+W | redis | `redis-cache` | Puerto propio | no | bajo | ✅ `CacheService` |

**(§)** El relay del outbox y las semillas manipulan el mecanismo de persistencia en sí
—reclamación con `FOR UPDATE SKIP LOCKED`, bloqueos consultivos, `pg_notify`—. Envolverlos
en un puerto agnóstico del motor no eliminaría acoplamiento: lo escondería detrás de una
interfaz que solo PostgreSQL podría implementar. Se quedan donde están, declarado.

## Riesgos que la auditoría encontró y qué se hizo

| Hallazgo | Estado |
| --- | --- |
| Lecturas y escrituras con la misma credencial | Resuelto: dos roles y dos rutas, con el interruptor apagado por defecto |
| No había forma de usar una réplica | Resuelto: Escenario C soportado, con distinción réplica/segundo rol |
| El dominio nombraba tipos de Prisma | Resuelto en el piloto; declarado para el resto |
| El error del driver podía llegar a la respuesta | Resuelto: jerarquía normalizada, causa solo en observabilidad |
| No había visibilidad de pools ni de rutas | Resuelto: `atlas_database_*` y `/health/data-sources` |
| Una configuración de datos mala fallaba tarde | Resuelto: validación al arrancar, sin exponer secretos |
| 30 módulos siguen con acceso directo | **Abierto, declarado**, con plan y orden |

## Documentos relacionados

- [Superficie de persistencia](architecture.md)
- [Plan de migración y rollback](migration-plan.md)
- [Dependencias entre módulos](../../architecture/module-dependencies.md)
