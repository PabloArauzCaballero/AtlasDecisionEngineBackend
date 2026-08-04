# Workers adicionales — diseño de integración (Fase 2)

Decisiones fijadas en
[ADR-0026](../adr/ADR-0026-additional-workers-integration.md). Este documento es
el detalle operativo: contratos, estados, persistencia, permisos y endpoints.

## 1. Trabajos

```ts
// src/common/jobs/job-names.ts
SemanticAnalysis: 'semantic-analysis'
BankStatement:    'bank-statement'
```

Cada uno es un `BackgroundJob` propio, con su servicio, su tabla, su
configuración y sus métricas. No comparten processor.

| Trabajo             | Cadencia mínima | Cadencia máxima | Concurrencia | Lease  |
| ------------------- | --------------- | --------------- | ------------ | ------ |
| `semantic-analysis` | 500 ms          | 30 s            | 4            | 120 s  |
| `bank-statement`    | 500 ms          | 30 s            | 2            | 300 s  |

La cadencia es sólo la red de seguridad: la latencia real la da el `pg_notify`
emitido dentro de la transacción que crea la ejecución.

## 2. Estados

Un único enum compartido por las dos tablas, porque el frontend pinta los mismos
estados en las dos vistas:

```txt
QUEUED → RUNNING → SUCCEEDED
                 → SUCCEEDED_WITH_WARNINGS
                 → FAILED
                 → CANCELLED
```

- `SUCCEEDED_WITH_WARNINGS` existe porque los dos workers producen resultados
  útiles con advertencias: el A degrada a `UNKNOWN` al agotar presupuesto, el B
  entrega movimientos con nivel de confianza y avisos de validación financiera.
  Colapsarlo con `SUCCEEDED` escondería justo lo que hay que revisar.
- `CANCELLED` sólo desde `QUEUED`. Cancelar algo ya reclamado exigiría cooperación
  del processor y una señal entre procesos que el motor no tiene; prometerlo en la
  interfaz sería mentir.

Estados de la interfaz que **no** son estados del backend (`Idle`, `Selecting
example`, `Uploading`, `Validating`, `Ready`, `Submitting`) viven sólo en el
cliente: describen el formulario antes de que exista una ejecución.

## 3. Persistencia

Tabla por worker, ninguna tabla existente se modifica.

### `decision_semantic_analysis_run`

| Campo                | Tipo         | Nota                                            |
| -------------------- | ------------ | ----------------------------------------------- |
| `id`                 | BigInt       |                                                 |
| `tenant_id`          | BigInt       |                                                 |
| `request_id`         | VarChar(64)  | Identificador público de la ejecución            |
| `idempotency_key`    | VarChar(200) | Único por tenant                                 |
| `status`             | enum         |                                                 |
| `progress`           | Int          | 0–100                                            |
| `input_source`       | enum         | `FIXTURE` \| `UPLOAD` \| `INLINE`                |
| `input_text`         | Text         | Se minimiza según retención                      |
| `input_metadata`     | Json?        |                                                 |
| `result_json`        | Json?        | `SemanticAnalysisResult`                         |
| `warnings_json`      | Json?        |                                                 |
| `error_code`         | VarChar(120)?|                                                  |
| `error_message`      | Text?        |                                                  |
| `attempt_count`      | Int          |                                                  |
| `lease_expires_at`   | Timestamptz? |                                                  |
| `queued_at` / `started_at` / `finished_at` | Timestamptz |                          |
| `requested_by`       | VarChar(160) |                                                  |
| `correlation_id`     | VarChar(64)  |                                                  |

`@@unique([tenant_id, idempotency_key])` · `@@index([status, queued_at])` ·
`@@index([tenant_id, queued_at])`

### `decision_bank_statement_run`

Mismos campos de ciclo de vida, y en vez de `input_text`:

| Campo               | Tipo         | Nota                                                    |
| ------------------- | ------------ | ------------------------------------------------------- |
| `file_name`         | VarChar(255) | Ya saneado                                               |
| `file_hash`         | Char(64)     | SHA-256; base de la idempotencia                         |
| `file_size_bytes`   | Int          |                                                          |
| `file_bytes`        | Bytes?       | **Se borra al terminar la ejecución**                    |
| `result_json`       | Json?        | `NormalizedBankStatement`                                |
| `confidence`        | Decimal?     |                                                          |
| `institution_id`    | VarChar(16)? |                                                          |
| `transaction_count` | Int?         |                                                          |

`@@unique([tenant_id, file_hash])`

El resultado hereda el enmascarado del motor: `accountNumberMasked` nunca trae
el número completo.

## 4. Endpoints

Prefijo `/v1`, controladores separados por worker.

| Método | Ruta                                        | Qué hace                                  |
| ------ | ------------------------------------------- | ----------------------------------------- |
| `GET`  | `/v1/workers`                                | Catálogo: disponibilidad, límites, formatos |
| `GET`  | `/v1/workers/semantic-analysis/fixtures`     | Escenarios de prueba                       |
| `POST` | `/v1/workers/semantic-analysis/runs`         | Crea ejecución (fixture o texto propio)    |
| `GET`  | `/v1/workers/semantic-analysis/runs`         | Lista paginada                             |
| `GET`  | `/v1/workers/semantic-analysis/runs/:id`     | Estado, progreso, resultado o error        |
| `POST` | `/v1/workers/semantic-analysis/runs/:id/cancel` | Sólo desde `QUEUED`                     |
| `GET`  | `/v1/workers/bank-statement/fixtures`        | Escenarios de prueba                       |
| `POST` | `/v1/workers/bank-statement/runs`            | Crea ejecución (fixture o PDF subido)      |
| `GET`  | `/v1/workers/bank-statement/runs`            | Lista paginada                             |
| `GET`  | `/v1/workers/bank-statement/runs/:id`        | Estado, progreso, resultado o error        |
| `GET`  | `/v1/workers/bank-statement/runs/:id/download?format=csv\|json\|normalized` | Descarga |
| `POST` | `/v1/workers/bank-statement/runs/:id/cancel` | Sólo desde `QUEUED`                        |

El seguimiento es por sondeo desde el cliente. El motor no tiene canal de
servidor a navegador para este dominio, y añadir uno sería infraestructura nueva.

## 5. Permisos

Rol nuevo no; se reutilizan los existentes. Regla de mínimo privilegio y
denegación por defecto, validada en el backend con `@Roles`, nunca ocultando
botones.

| Acción                      | Roles                                              |
| --------------------------- | -------------------------------------------------- |
| Ver el catálogo de workers   | `RISK_ANALYST` `FRAUD_ANALYST` `QA_ANALYST` `OPERATIONS` `COMPLIANCE` `AUDITOR` |
| Ejecutar con fixture         | `RISK_ANALYST` `FRAUD_ANALYST` `QA_ANALYST`         |
| Ejecutar con datos propios   | `RISK_ANALYST` `FRAUD_ANALYST` `OPERATIONS`         |
| Ver resultados               | mismos que ver el catálogo                          |
| Descargar resultados         | `RISK_ANALYST` `FRAUD_ANALYST` `OPERATIONS` `COMPLIANCE` `AUDITOR` |
| Cancelar                     | `RISK_ANALYST` `FRAUD_ANALYST` `OPERATIONS`         |

Toda consulta va acotada por `tenant_id`: una ejecución de otro tenant responde
`404`, no `403`, para no confirmar que existe.

**Cargar datos propios exige más que ejecutar un fixture**: un fixture es
sintético y versionado, un archivo subido es un documento bancario real.

## 6. Validación de la entrada

| Regla                | Worker A                       | Worker B                                 |
| -------------------- | ------------------------------ | ---------------------------------------- |
| Tamaño máximo        | 8 000 caracteres               | 10 MiB (`BANK_STATEMENT_MAX_UPLOAD_BYTES`) |
| Número de archivos   | —                              | 1                                         |
| Tipo permitido       | —                              | `application/pdf`                         |
| Comprobación real    | texto no vacío tras normalizar | **firma `%PDF-` del contenido**           |
| Nombre seguro        | —                              | sin rutas, sin control, ≤255              |
| Duplicados           | `idempotencyKey` por tenant    | SHA-256 del archivo por tenant            |

La extensión y el `Content-Type` declarados por el cliente no se creen. El
frontend repite estas reglas para dar respuesta inmediata; el backend las
revalida siempre.

## 7. Fixtures

Versionados en el repositorio, sintéticos, sin datos personales reales, y
validados con el **mismo esquema** que la entrada real.

```txt
src/modules/workers/fixtures/
  semantic-analysis/
    valid-basic.json          reclamo claro, un único MATCH
    valid-complete.json       entidades, montos y fechas
    boundary-case.json        texto en el límite de longitud
    invalid-example.json      texto vacío tras normalizar
  bank-statement/
    valid-basic.json          extracto mínimo de una institución conocida
    valid-complete.json       varias cuentas y movimientos
    boundary-case.json        documento en el límite de tamaño
    invalid-example.json      PDF que no es un estado de cuenta
```

Los fixtures del worker B guardan el PDF en base64 dentro del JSON para que
queden versionados junto a su descripción y su resultado esperado.

Sólo se sirven cuando `WORKERS_FIXTURES_ENABLED` está activo; en producción está
apagado por defecto, para que un escenario de prueba no contamine la operación.

## 8. Observabilidad

Sin métricas nuevas: los dos workers alimentan las `atlas_job_*` que ya emite
`MetricsService` a través del orquestador, etiquetadas por nombre de trabajo.

Se registran por ejecución: `runId`, `workerType`, `correlationId`, `traceId`,
estado, duración, intento, tipo y tamaño de entrada, resultado y tipo de error.

**Nunca se registran**: el texto analizado completo, los bytes del PDF, el
contenido bancario, tokens ni credenciales. Las etiquetas de métrica no llevan
identificadores de usuario ni mensajes de error completos, para no disparar la
cardinalidad.

## 9. Variables de entorno

Siguiendo la nomenclatura existente (`TEST_RUN_WORKER_*`), todas validadas al
arrancar en `common/config/env.schema.ts`.

```env
SEMANTIC_ANALYSIS_WORKER_ENABLED=false
SEMANTIC_ANALYSIS_WORKER_CONCURRENCY=4
SEMANTIC_ANALYSIS_WORKER_POLL_MS=500
SEMANTIC_ANALYSIS_WORKER_MAX_POLL_MS=30000
SEMANTIC_ANALYSIS_LEASE_SECONDS=120
SEMANTIC_ANALYSIS_MAX_ATTEMPTS=3
SEMANTIC_ANALYSIS_MAX_TEXT_LENGTH=8000
SEMANTIC_ANALYSIS_PROVIDER=            # openai | ollama; vacío ⇒ worker no se registra
SEMANTIC_ANALYSIS_BUDGET_WINDOW_SECONDS=3600
SEMANTIC_ANALYSIS_BUDGET_MAX_ANALYSES=1000

BANK_STATEMENT_WORKER_ENABLED=false
BANK_STATEMENT_WORKER_CONCURRENCY=2
BANK_STATEMENT_WORKER_POLL_MS=500
BANK_STATEMENT_WORKER_MAX_POLL_MS=30000
BANK_STATEMENT_LEASE_SECONDS=300
BANK_STATEMENT_MAX_ATTEMPTS=3
BANK_STATEMENT_MAX_UPLOAD_BYTES=10485760
BANK_STATEMENT_TIMEOUT_MS=60000

WORKERS_FIXTURES_ENABLED=false
```

## 10. Flujo en el frontend

Pestaña nueva **Procesamiento**, sección propia de la navegación, con dos
entradas: «Análisis Semántico» (`/workers/semantic-analysis`) y «Extractos
Bancarios» (`/workers/bank-statement`).

Se usa una sección con dos entradas —no una pestaña por worker suelta— porque la
navegación del portal ya agrupa por dominio (`Diseño`, `Calidad`, `Gobierno`,
`Operación`, `Auditoría`), y dos workers sueltos en la raíz romperían esa lectura.

Cada vista: encabezado con disponibilidad y límites → elección entre «usar datos
de prueba» y «cargar datos propios» → vista previa → ejecución con protección
contra doble envío → seguimiento con progreso, intento y tiempo transcurrido →
resultado con resumen, descarga y reinicio, o error con código, correlation ID y
acción correctiva.

Ambas rutas se registran en `src/auth/route-access.ts`: una ruta sin regla no da
error de permisos, desaparece.
