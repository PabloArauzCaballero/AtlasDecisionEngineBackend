# Arquitectura de datos

Esta página describe **el modelo de datos**: qué tablas hay, cómo se relacionan y cómo
crecen. La capa que separa el dominio del motor —puertos, registro de conexiones,
enrutamiento de lectura y escritura, roles separados y persistencia políglota— vive en
[superficie de persistencia](persistence/architecture.md) y se decidió en
[ADR-0029](../adr/ADR-0029-polyglot-persistence-read-write.md).

## Motor y acceso

PostgreSQL 16 con Prisma 6 sobre el adaptador `@prisma/adapter-pg`. El adaptador importa: el
proxy de tenancy (`common/prisma/tenant-rls.ts`, compartido por los clientes de escritura y
de lectura) fija el GUC `app.tenant_id` en la conexión antes de cada consulta, y es lo que
activa las políticas RLS.

El pool ya no lo abre el cliente: lo gobierna el registro de conexiones, que decide si
lectura y escritura comparten uno o usan dos
([enrutamiento](persistence/read-write-routing.md)).

| Parámetro | Variable | Para qué |
| --- | --- | --- |
| Tamaño del pool | `DATABASE_POOL_MAX` | Acota conexiones por réplica |
| Timeout de conexión | `DATABASE_CONNECTION_TIMEOUT_MS` | Falla rápido en vez de acumular esperas |
| Timeout de sentencia | `DATABASE_STATEMENT_TIMEOUT_MS` | Una consulta desbocada no bloquea el pool |
| Timeout de inactividad | `DATABASE_IDLE_TIMEOUT_MS` | Devuelve conexiones ociosas |

## Familias de tablas

| Familia | Ejemplos | Naturaleza |
| --- | --- | --- |
| Catálogo | `decision_variable`, `decision_reason_code`, `decision_environment` | Lectura frecuente, escritura rara |
| Diseño | `decision_artifact`, `decision_artifact_version`, nodos, aristas, condiciones | Versionado inmutable |
| Compilado | artefacto compilado con checksum | Lo que el runtime ejecuta |
| Ejecución | `decision_execution` y sus tablas satélite | Alto volumen, solo inserción |
| Idempotencia | `decision_runtime_idempotency` | **La de mayor volumen**; con purga programada |
| Auditoría | `decision_audit_event`, `decision_access_audit` | Append-only, encadenada por hash |
| Mensajería | outbox y `decision_processed_event` | Entrega al menos una vez con deduplicación |

El catálogo completo, generado del esquema, está en
[catálogo de entidades](entity-catalog.md); las relaciones entre esos modelos, agrupadas por
dominio, en [relaciones entre entidades](relationships.md).

## Invariantes de datos

1. **Una versión aprobada no se modifica.** Un cambio genera una versión nueva.
2. **La evidencia no se reescribe.** `decision_audit_event` tiene revocados `UPDATE` y `DELETE` para el rol de aplicación, además de disparadores que lo impiden.
3. **Todo dato de negocio tiene tenant.** Y toda tabla con tenant tiene su política RLS espejo.
4. **El valor sensible no se guarda en claro:** se persiste su HMAC.

## Transacciones

- Ejecución, evidencia y evento de auditoría se confirman **juntos**: una decisión sin su rastro sería inauditable, y un rastro sin decisión, ficticio.
- **Nunca** se abre una transacción alrededor de E/S de red. Las variables externas se resuelven antes; los scripts se ejecutan antes de persistir.
- La escritura del grafo usa `createManyAndReturn` por lotes y mapea los identificadores generados por su clave de negocio, no por el orden de inserción.

## Crecimiento y su control

| Tabla | Control |
| --- | --- |
| `decision_runtime_idempotency` | Purga por lotes acotados con margen de gracia |
| `decision_execution` | Índices por `(tenant_id, executed_at)`; sin particionado, por la decisión documentada |
| `decision_audit_event` | Índice `(tenant_id, id)` para el recorrido por cursor; **no se borra nunca** |

!!! note "Por qué no hay particionado temporal"
    PostgreSQL exige la clave de partición en toda restricción única. Particionar
    `decision_execution` por `executed_at` forzaría su clave primaria a `(id, executed_at)` y,
    con ella, una columna desnormalizada y claves foráneas compuestas en las **cinco** tablas que
    la referencian — algo que Prisma no modela hoy. A los volúmenes actuales, los índices por
    rango temporal ya existentes cubren las consultas. La decisión se revisará a un umbral real
    de volumen.
