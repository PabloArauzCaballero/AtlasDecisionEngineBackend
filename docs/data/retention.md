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
| `decision_semantic_analysis_run` | Minimización del texto y purga de la fila, con dos plazos | `SemanticRetentionSweeperService`, trabajo `semantic-retention` |
| `decision_bank_statement_run` | El PDF se anula al cerrar la ejecución; la fila y su resultado se conservan | En la misma escritura que cierra la ejecución, no en una barrida posterior |

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

## La retención del texto analizado, en detalle

El worker semántico conserva el texto que clasificó porque es la evidencia de por qué
respondió lo que respondió. Conservarlo para siempre, en cambio, retiene datos que ya no hacen
falta — y que con un proveedor alojado ya salieron del perímetro una vez.

Por eso hay **dos plazos y no uno**:

| Parámetro | Por defecto | Para qué |
| --- | --- | --- |
| `SEMANTIC_ANALYSIS_MINIMIZE_AFTER_DAYS` | 30 días | El texto se sustituye por `minimizado:<md5>`. Se conserva la trazabilidad y se pierde el contenido |
| `SEMANTIC_ANALYSIS_AUDIT_RETENTION_DAYS` | 90 días | La fila entera se borra |
| `SEMANTIC_ANALYSIS_RETENTION_SWEEP_INTERVAL_MS` | 1 h | Cadencia de la barrida |

Minimizar primero y purgar después no es un orden arbitrario: deja el texto fuera de la base
cuanto antes, y la purga posterior elimina filas que ya no contienen contenido sensible. Al
revés, una purga lenta mantendría texto íntegro más tiempo del debido. Ambos plazos a `0`
desactivan la barrida, que entonces ni siquiera se registra.

!!! warning "Esta política existía en el código y no se ejecutaba"
    `AuditRetentionService` venía completo en el worker absorbido, pero quien lo invocaba era
    el planificador del paquete original, descartado junto con pg-boss. Hasta que se cableó el
    trabajo `semantic-retention`, `input_text` se conservaba **indefinidamente** y las dos
    variables de arriba no estaban declaradas en el esquema de entorno: ajustarlas no tenía
    ningún efecto. Es el motivo por el que este documento las lista con su mecanismo y no solo
    con su intención.

## Lo que todavía no vence

- **El PDF de una ejecución que nunca se procesa.** `file_bytes` se anula al cerrar la
  ejecución, pero una que se queda en `QUEUED` —porque el worker está apagado— conserva su
  documento sin plazo. No hay barrida para ese caso.
- **`decision_execution`**, hasta que exista el job exportador; ver el umbral más abajo.

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
