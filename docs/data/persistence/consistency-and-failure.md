# Consistencia, transacciones y recuperación ante fallos

## Modelo de consistencia

Tres niveles, declarados por módulo o por llamada:

| Nivel | Significado | Se resuelve contra |
| --- | --- | --- |
| `strong` | Lectura coherente con la última escritura confirmada | Lectura si es el mismo servidor; primario si es réplica |
| `read-after-write` | «Acabo de escribir y necesito verlo» | Siempre el primario |
| `eventual` | Se acepta retraso de replicación | Conexión de lectura |

`read-after-write` no es sinónimo de `strong`: expresa una dependencia causal con una
escritura concreta de la misma petición, y por eso sube al primario aunque la conexión de
lectura fuera perfectamente coherente.

### Qué está anclado al primario y por qué

`runtime` y `governance` leen lo que acaban de escribir: la clave de idempotencia, el
despliegue activo, el estado de aprobación. Resolver esas lecturas contra una réplica
devolvería una **decisión tomada con estado viejo**, que en un motor de decisiones de
crédito no es un retraso sino un error de negocio. Están anclados por regla base, no por
configuración de despliegue.

### Retraso de replicación

Cuando la conexión de lectura sea una réplica real:

- El router la reconoce como tal comparando host, puerto y base, y **sube automáticamente**
  toda lectura declarada fuerte.
- Las métricas separan las dos conexiones (`atlas_database_operation_total{connection=…}`),
  así que la carga desviada al primario es visible.
- Nunca se afirma consistencia fuerte sobre una conexión que va por detrás.

## Transacciones

Toda transacción de negocio va por la ruta de escritura. Está garantizado por construcción:

- El router **rechaza al arrancar** cualquier regla que mande una escritura a una conexión
  registrada como de solo lectura.
- El cliente de lectura rechaza `create`, `update`, `upsert`, `delete`, sus variantes
  `*Many`, `$executeRaw` y `$executeRawUnsafe` **antes de emitir consulta alguna**, con un
  `ReadOnlyConnectionError` que nombra la conexión mal usada.
- El rol `atlas_reader` tampoco tiene el privilegio, que es la barrera real.

Una lectura **dentro** de una transacción de escritura usa el cliente transaccional, no la
réplica: mezclarlos rompería la atomicidad que la transacción existe para dar.

```ts
await writePath.execute(async (transaction) => {
  await customerWriter.save(customer, { transaction });
  await outbox.append(event, { transaction });
});
```

El `TransactionContext` es **opaco** a propósito. Si expusiera el cliente del ORM, la capa
de aplicación podría emitir consultas por su cuenta y el desacoplamiento sería decorativo;
el cliente real viaja bajo un símbolo que solo el adaptador PostgreSQL sabe desenvolver.

La regla que ya regía sigue vigente: la escritura de negocio y su auditoría
(`AuditService.append`) van en la **misma** transacción, para que la acción y su evidencia
sean atómicas.

### Sin transacciones distribuidas

Ningún motor de la tabla de capacidades ofrece transacciones distribuidas, y ninguna se
simula. La coordinación entre motores va por el outbox transaccional que el sistema ya
tiene (ver [ADR-0027](../../adr/ADR-0027-messaging-technology-selection.md)): outbox, inbox
de deduplicación, reintentos con retroceso y cola muerta.

## Errores normalizados

El caso de uso no ramifica sobre `error.code === '23505'`: eso ata el dominio al motor tan
fuerte como importar el driver.

| SQLSTATE / código | Error normalizado |
| --- | --- |
| `23505` | `DuplicateEntityError` |
| `23503` | `ForeignKeyConflictError` |
| `23502` | `RequiredFieldError` |
| `40001` | `ConcurrencyConflictError` |
| `40P01` | `DeadlockDetectedError` |
| `42501` | `InsufficientPrivilegeError` |
| `57014` | `QueryTimeoutError` |
| `53300`, clase `08xxx` | `ConnectionUnavailableError` |
| `P2002`, `P2003`, `P2011` | equivalentes de Prisma |
| `P1001`, `P1002`, `P1017` | `ConnectionUnavailableError` |

El mensaje del driver **no se propaga**. Un `duplicate key value violates unique constraint
"decision_artifact_tenant_id_artifact_code_key"` filtra nombres de tabla y de índice a quien
provocó el error; se conserva en `cause` para el log interno y hacia arriba sale un mensaje
estable.

## Estrategia ante fallo de lectura

`ENABLE_PRIMARY_READ_FALLBACK` (por defecto `true`):

| Estrategia | Comportamiento |
| --- | --- |
| `fallback-to-primary` | Reintenta contra el primario **y lo declara** |
| `fail-fast` | Propaga `ConnectionUnavailableError` |

**Solo la indisponibilidad justifica cambiar de conexión.** Un conflicto de datos —un
duplicado, una clave foránea— no se reintenta: el primario devolvería exactamente el mismo
error con el doble de carga.

Cada degradación deja un registro estructurado con todo lo necesario para auditarla:

```json
{
  "event": "read_path_fallback",
  "module": "audit-query",
  "operation": "listAuditEvents",
  "from": "postgres-read",
  "to": "postgres-write",
  "reason": "ConnectionUnavailableError",
  "durationMs": 12,
  "outcome": "served",
  "requestId": "…"
}
```

más el contador `atlas_database_fallback_total{from_connection,to_connection,reason}`. Un
fallback que nadie puede ver es una réplica caída que nadie arregla.

## Ciclo de vida y apagado ordenado

| Fase | Quién |
| --- | --- |
| Construcción de pools (sin E/S) | Constructor del registro |
| Conexión y validación | `ConnectionRegistryService.onModuleInit` |
| Comprobación de superusuario / solo lectura | `onModuleInit` de cada cliente |
| Sondas y muestreo de pools | `DataSourceHealthService` |
| Desconexión de clientes | `onModuleDestroy` de cada cliente |
| Cierre de pools | `ConnectionRegistryService.onApplicationShutdown` |

El orden importa: Nest ejecuta primero todos los `onModuleDestroy`, y ahí es donde los
clientes hacen `$disconnect()`. Cerrar el pool antes dejaría esa desconexión sin
transporte. El cierre es idempotente, así que un pool compartido por dos nombres lógicos no
se cierra dos veces.

## Métricas

| Serie | Qué responde |
| --- | --- |
| `atlas_database_operation_total{connection,engine,module,operation,outcome}` | Qué ruta sirve qué y con qué resultado |
| `atlas_database_operation_duration_ms` | Latencia por conexión y módulo |
| `atlas_database_fallback_total` | Cuánto se está degradando la lectura |
| `atlas_database_connection_failures_total` | Fallos de conexión por ruta |
| `atlas_database_pool_connections{connection,state}` | `total`, `idle`, `waiting` por pool |

Las etiquetas son catálogos cerrados del propio código —nombres lógicos de conexión,
nombres de módulo, nombres de método de un puerto—, nunca entrada del llamante: una
etiqueta abierta aquí haría explotar la cardinalidad de la serie.

El tamaño del pool se muestrea **en el instante del scrape**, mediante un colector
registrado en `MetricsService`, en vez de publicarse desde un temporizador propio que
añadiría un reloj más al proceso para dar un dato viejo.

## Documentos relacionados

- [Enrutamiento de lectura y escritura](read-write-routing.md)
- [Superficie de persistencia](architecture.md)
- [Métricas](../../observability/metrics.md)
- [Alertas](../../observability/alerts.md)
