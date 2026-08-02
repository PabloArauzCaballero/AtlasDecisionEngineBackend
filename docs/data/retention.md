# Retención

## Regla que condiciona todo lo demás

!!! danger "La auditoría no se borra"
    `decision_audit_event` es append-only por diseño: disparadores que rechazan `UPDATE` y
    `DELETE`, y esos permisos revocados para el rol de aplicación. **Retención aquí no puede
    significar borrado**; significa archivado y exportación.

    Es una consecuencia del propósito del sistema: la evidencia de por qué se denegó un crédito
    es el objeto regulatorio que hay que conservar.

## Por familia de datos

| Familia | Política | Mecanismo |
| --- | --- | --- |
| `decision_runtime_idempotency` | Purga automática pasada la expiración más un margen | `RetentionSweeperService`, lotes acotados |
| `decision_execution` y satélites | Conservación 7 años desde `executedAt` ([ADR-0025](../adr/ADR-0025-execution-archival-threshold.md)) | Archivado a solo lectura, no borrado; configurable por tenant |
| `decision_audit_event` | **Sin borrado** | Exportación de solo lectura |
| `decision_access_audit` | Conservación operativa | Revisar con el responsable de seguridad |
| Diseño y catálogo | Sin borrado; ciclo `DEPRECATED` → `RETIRED` | Estado, no eliminación |
| Corridas de QA y contraejemplos | Se conservan por reproducibilidad | — |

## La purga de idempotencia, en detalle

Es la tabla de mayor volumen: **cada decisión reserva una fila**. Cada una lleva `expires_at`,
pero nadie eliminaba las vencidas y la tabla crecía sin cota.

| Parámetro | Por defecto | Para qué |
| --- | --- | --- |
| `RUNTIME_RETENTION_SWEEP_ENABLED` | `true` | Interruptor |
| `RUNTIME_RETENTION_SWEEP_INTERVAL_MS` | 1 h | Cadencia |
| `RUNTIME_IDEMPOTENCY_RETENTION_GRACE_HOURS` | 24 h | Margen tras la expiración |
| `RUNTIME_RETENTION_SWEEP_BATCH` | 1000 | Filas por sentencia, para que ningún borrado mantenga un bloqueo largo |

Una fila solo se purga cuando ya **no puede servir un replay**: pasada la expiración, una
petición repetida reclama la clave de nuevo, así que borrarla no cambia ningún comportamiento
observable. El margen de gracia cubre el replay que compite con la expiración.

Corre en el proceso `WORKER` (o en `ALL`); ver
[procesamiento en segundo plano](../architecture/background-processing.md).

## Datos personales

Los valores sensibles se persisten como **HMAC**, no en claro. Consecuencia: un borrado por
derecho al olvido no exige reescribir la evidencia —que es inmutable— porque el dato personal
no está allí en claro. La correlación se pierde al retirar el secreto de la clave
correspondiente.

Ver [clasificación](classification.md).

## Umbral de archivado de `decision_execution`

[ADR-0025](../adr/ADR-0025-execution-archival-threshold.md) adopta **7 años desde
`executedAt`** como línea base, configurable por tenant cuando cumplimiento confirme el
régimen regulatorio real de su mercado. El mecanismo (exportación de solo lectura sobre el
índice `[tenantId, executedAt]` ya existente) está disponible; el **job** que lo ejecuta de
forma periódica —análogo a `RetentionSweeperService` pero exportador en vez de purgador— es
trabajo de ingeniería de seguimiento, ya no bloqueado por una decisión de negocio pendiente.
