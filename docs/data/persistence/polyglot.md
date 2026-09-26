# Persistencia políglota

La persistencia políglota es una **capacidad, no una obligación**. Hoy el sistema usa dos
motores porque necesita dos; no se ha añadido ninguno para demostrar que se puede.

## Motores en uso

| Motor | Para qué | Conexión |
| --- | --- | --- |
| PostgreSQL 16 | Todo el dato de negocio, la evidencia y el outbox | `postgres-write`, `postgres-read` |
| Redis 7 | Caché acotada por tenant y contadores de rate limit | `redis-cache` |

Redis está **registrado como conexión de datos** aunque no se haya añadido ningún cliente:
`CacheConnection` envuelve el `CacheService` que ya existía. Eso convierte el poliglotismo
en algo comprobable — el registro contiene dos motores, `/health/data-sources` los reporta
por separado y una regla de enrutamiento puede mandar un módulo a `redis` sin código nuevo.

## Capacidades por motor

Ningún motor se supone equivalente a otro. Cada uno declara lo que ofrece en
`ports/adapter-capabilities.ts`:

| Capacidad | postgresql | mysql | redis | mongodb | opensearch | clickhouse |
| --- | --- | --- | --- | --- | --- | --- |
| `transactions` | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| `fullTextSearch` | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ |
| `optimisticLocking` | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| `changeStreams` | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ |
| `rowLevelSecurity` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `nativeJson` | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ |
| `readReplica` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `distributedTransactions` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

Dos entradas merecen explicación:

- **Redis no tiene `transactions`.** `MULTI`/`EXEC` agrupa comandos pero no deshace los ya
  aplicados si uno falla: no es una transacción en el sentido que el contrato promete.
- **Nadie tiene `distributedTransactions`.** Ningún motor de esta tabla las ofrece por sí
  mismo, y fingirlas es exactamente el error que este modelo existe para impedir.

Un módulo declara lo que necesita, y el arranque falla si el motor al que enruta no lo
ofrece:

```ts
factory.createReadAdapter({
  module: 'audit-query',
  engine: 'postgresql',
  requires: ['rowLevelSecurity'],   // evidencia regulatoria por tenant
});
```

El módulo `audit-query` **no puede** enrutarse a un motor sin aislamiento a nivel de fila.
Si alguien lo intenta, el contenedor no levanta y el mensaje nombra el módulo, la capacidad
y el motor.

## Cómo se añadiría un tercer motor

Ejemplo: servir los listados de auditoría desde OpenSearch conservando PostgreSQL como
fuente de verdad.

1. **Registrar la conexión.** Una clase que implemente `DataConnection` con su
   `healthCheck()` y su cierre, registrada en `PersistenceModule`.
2. **Declarar sus capacidades**, si el motor no está ya en la tabla.
3. **Implementar el puerto existente.** `DecisionAuditReadPort` no menciona SQL ni Prisma:
   una implementación sobre OpenSearch es un archivo nuevo, no un cambio de contrato.
4. **Superar la suite de contrato.** `describeDecisionAuditReadPortContract` corre contra
   la implementación nueva sin modificarse. Si no pasa, no entra.
5. **Enrutarlo**, declarando la consistencia honestamente:

   ```env
   DATA_ROUTING_RULES={"audit-query":{"read":"opensearch","consistency":"eventual"}}
   ```

6. **Cambiar una línea** en `audit-query.module.ts`, la que liga el símbolo del puerto a su
   implementación. El servicio, el controlador y el contrato OpenAPI no se enteran.

La proyección que alimenta ese índice iría por el outbox transaccional que el sistema ya
tiene: la escritura y su evento salen en la misma transacción, y el proyector consume con
deduplicación. Sin dual-write, sin atomicidad fingida.

## Qué NO se hace

- **No se duplica el adaptador de un motor por cambiar de proveedor.** Neon, Supabase, RDS
  o Cloud SQL son el mismo PostgreSQL; el proveedor se infiere del host y ajusta pooling y
  TLS. Hay un único adaptador PostgreSQL.
- **No se fuerza a un motor a comportarse como otro.** Un índice de búsqueda no implementa
  un repositorio CRUD genérico; se le da un puerto de búsqueda propio.
- **No se añade un motor «por si acaso».** Cada uno cuesta operación, respaldo, monitoreo y
  una consistencia más que razonar.
- **No se hace dual-write sin reconciliación.** Si algún día hace falta, hará falta también
  declarar la fuente de verdad, la métrica de divergencia y la condición de finalización.

## Documentos relacionados

- [Superficie de persistencia](architecture.md)
- [Enrutamiento de lectura y escritura](read-write-routing.md)
- [Consistencia, transacciones y fallos](consistency-and-failure.md)
- [ADR-0027 — tecnología de mensajería](https://github.com/PabloArauzCaballero/AtlasDecisionEngineBackend/blob/main/adr/ADR-0027-messaging-technology-selection.md)
