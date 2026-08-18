# Pruebas y evidencia de la capa de persistencia

Nada de lo que sigue se declara «funciona» sin la salida real del runner.

## Qué cubre cada suite

| Suite | Qué demuestra | Necesita base de datos |
| --- | --- | --- |
| `test/persistence-connection-fingerprint.spec.ts` | La huella distingue lo que debe y **nunca lleva el secreto** | No |
| `test/persistence-registry-and-router.spec.ts` | Reutilización de pool, escenarios A/B/C, y las cinco configuraciones que impiden arrancar | No |
| `test/persistence-error-mapping.spec.ts` | SQLSTATE y códigos de Prisma traducidos; el mensaje del driver no sube | No |
| `test/persistence-read-path.spec.ts` | Interruptor, fallback declarado, no reintentar lo que el primario repetiría, métricas | No |
| `test/persistence-read-only-guard.spec.ts` | La ruta de lectura rechaza toda escritura antes de tocar la base | No |
| `test/decision-audit-read-port.contract.spec.ts` | **Suite de contrato** superada por dos implementaciones | Solo la variante PostgreSQL |
| `test/postgres-role-privileges.integration.spec.ts` | Privilegios **reales**: el lector no puede escribir | Sí, con roles aprovisionados |

Construir un `Pool` de `pg` y un `PrismaClient` no abre ninguna sesión, y los rechazos
ocurren antes de emitir consulta: por eso la mayoría de estas pruebas son unitarias de
verdad y corren en cualquier máquina.

## Pruebas de contrato

`test/support/decision-audit-read-port.contract.ts` describe el comportamiento observable a
través del puerto: filtros, ventana temporal, paginación por desplazamiento y por cursor,
recorrido de la cadena, aislamiento entre tenants. No conoce SQL, ni índices, ni el nombre
de una sola tabla.

La ejecutan **dos** implementaciones:

```ts
describeDecisionAuditReadPortContract('in-memory adapter', …);
describeDecisionAuditReadPortContract('PostgreSQL adapter', …, DATABASE_URL ? describe : describe.skip);
```

Esa duplicidad es lo que convierte «el dominio no depende de la infraestructura» en algo
comprobable: si el contrato pudiera cumplirse solo con Prisma, sería el contrato de Prisma.
Además, la variante en memoria corre siempre, así que una regla de negocio rota nunca queda
escondida detrás de «no hay Postgres».

## Pruebas de privilegios

No basta con inspeccionar los `GRANT`. Lo que importa es si la escritura falla de verdad,
así que se ejecuta y se exige el código `42501` (*insufficient_privilege*) — no solo que
falle, porque un error de sintaxis o de columna daría un verde falso.

Requiere las dos conexiones aprovisionadas:

```bash
yarn db:provision:dev
DATABASE_WRITE_URL=postgresql://atlas_writer:…@localhost:55432/atlas_decision?schema=public \
DATABASE_READ_URL=postgresql://atlas_reader:…@localhost:55432/atlas_decision?schema=public \
  npx jest --runInBand test/postgres-role-privileges.integration.spec.ts
```

Sin ellas la suite se salta y lo declara: el dato externo que falta son esas dos
credenciales, y bloquear el resto de la batería por eso sería peor.

## Evidencia ejecutada — 2026-08-06

Contra PostgreSQL 16 en contenedor (`localhost:55432`, base `atlas_decision`, 76 tablas).

### Aprovisionamiento e idempotencia

```text
$ yarn db:provision:dev
PostgreSQL development roles provisioned
  database              atlas_decision
  managed schemas       public
  object owner          atlas
  tables in scope       76
  atlas_writer        created · SELECT 76 · INSERT 76
  atlas_reader        created · SELECT 76 · write 0
✔ Least-privilege verification passed

$ yarn db:provision:dev          # 2.ª ejecución
  atlas_writer        already present · SELECT 76 · INSERT 76
  atlas_reader        already present · SELECT 76 · write 0
✔ Least-privilege verification passed

$ yarn db:provision:dev          # 3.ª ejecución
  atlas_writer        already present · SELECT 76 · INSERT 76
  atlas_reader        already present · SELECT 76 · write 0
✔ Least-privilege verification passed
```

Tres ejecuciones, mismo estado final: no duplica, no falla por existencia previa y no
acumula permisos. `atlas_reader` puede leer las 76 tablas y escribir en **cero**.

### Privilegios reales

```text
$ npx jest --runInBand test/postgres-role-privileges.integration.spec.ts
PASS test/postgres-role-privileges.integration.spec.ts (33.597 s)
  PostgreSQL reader and writer privileges (integration)
    √ connects with two different database roles (40 ms)
    √ neither role is a superuser, and neither can bypass RLS (122 ms)
    √ lets the reader select (58 ms)
    √ lets the writer select and write (137 ms)
    √ rejects INSERT from the reader (55 ms)
    √ rejects UPDATE from the reader (23 ms)
    √ rejects DELETE from the reader (21 ms)
    √ rejects TRUNCATE from the reader (18 ms)
    √ rejects CREATE from the reader (20 ms)
    √ keeps the audit chain append-only even for the writer (24 ms)

Tests:       10 passed, 10 total
```

### Unidad, router y registro

```text
$ npx jest --runInBand test/persistence-connection-fingerprint.spec.ts \
    test/persistence-error-mapping.spec.ts test/persistence-registry-and-router.spec.ts
PASS test/persistence-registry-and-router.spec.ts
PASS test/persistence-connection-fingerprint.spec.ts
PASS test/persistence-error-mapping.spec.ts

Tests:       46 passed, 46 total
```

### Contrato del puerto y guardia de solo lectura

```text
$ npx jest --runInBand test/decision-audit-read-port.contract.spec.ts \
    test/persistence-read-only-guard.spec.ts
PASS test/persistence-read-only-guard.spec.ts
PASS test/decision-audit-read-port.contract.spec.ts

Tests:       28 passed
```

La suite de contrato superada por la implementación PostgreSQL **y** por la de memoria.

### Ruta de lectura

```text
$ npx jest --runInBand test/persistence-read-path.spec.ts
PASS test/persistence-read-path.spec.ts
```

Incluye la comprobación de que el fallback deja `atlas_database_fallback_total` con
`from_connection="postgres-read"` y `reason="ConnectionUnavailableError"`, y de que un
conflicto de datos **no** se reintenta contra el primario.

### La aplicación en caliente, con las dos conexiones separadas

Arrancada con `DATABASE_READ_URL` apuntando a `atlas_reader` y
`DATA_READ_ROUTING_ENABLED=true`:

```text
$ curl -s localhost:3399/health/data-sources
{
  "status": "up",
  "connections": {
    "postgres-write": { "status": "up", "role": "write",      "engine": "postgresql", "latencyMs": 51 },
    "postgres-read":  { "status": "up", "role": "read",       "engine": "postgresql", "latencyMs": 51 },
    "redis-cache":    { "status": "up", "role": "read-write", "engine": "redis", "detail": "redis" }
  },
  "routing": {
    "audit-query": { "read": "postgres-read",  "write": "postgres-write", "consistency": "eventual" },
    "default":     { "read": "postgres-read",  "write": "postgres-write", "consistency": "strong" },
    "runtime":     { "read": "postgres-write", "write": "postgres-write", "consistency": "read-after-write" },
    "governance":  { "read": "postgres-write", "write": "postgres-write", "consistency": "read-after-write" },
    "views":       { "read": "postgres-read",  "write": "postgres-write", "consistency": "eventual" },
    "traceability":{ "read": "postgres-read",  "write": "postgres-write", "consistency": "eventual" }
  }
}
```

Una consulta real de auditoría (`GET /v1/audit/events?pageSize=1` → `200`) deja:

```text
atlas_database_operation_total{connection="postgres-read",engine="postgresql",
  module="audit-query",operation="listAuditEvents",outcome="ok"} 1
atlas_database_pool_connections{connection="postgres-read",state="total"} 3
atlas_database_pool_connections{connection="postgres-write",state="total"} 2
```

La consulta viajó por el rol `atlas_reader`, que no puede escribir.

### El interruptor de rollback, en caliente

Reiniciando lo mismo con `DATA_READ_ROUTING_ENABLED=false`, la **misma** petición produce:

```text
atlas_database_operation_total{connection="postgres-write",engine="postgresql",
  module="audit-query",operation="listAuditEvents",outcome="ok"} 1
```

Toda la lectura vuelve al primario sin desplegar código.

## Lo que falta por ejercitar

- **Réplica real (Escenario C).** El router la distingue y hay pruebas unitarias de la
  decisión, pero no hay una réplica desplegada contra la que medir retraso real. El dato
  externo que falta es esa réplica.
- **Segundo motor sirviendo un puerto.** La suite de contrato está lista para recibirlo;
  no hay ningún módulo que hoy lo justifique.

## Documentos relacionados

- [Superficie de persistencia](architecture.md)
- [Roles y privilegios PostgreSQL](postgres-roles.md)
- [Plan de migración y rollback](migration-plan.md)
- [Ejecutar las pruebas](https://github.com/PabloArauzCaballero/AtlasDecisionEngineBackend/blob/main/getting-started/running-tests.md)
