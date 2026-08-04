# Integración de dos workers adicionales — análisis previo (Fase 1)

> Entregable de la Fase 1 del encargo «integración de dos workers adicionales».
> Documenta lo que **ya existe** antes de tocar nada, para que la integración
> siga el procedimiento aprobado en vez de inventar uno nuevo.

- **Worker adicional A** — análisis semántico híbrido (`semantic-analysis-worker`).
- **Worker adicional B** — conversión de extractos bancarios bolivianos
  (`bolivia-bank-statement-worker`).

Ambos llegan como repositorios independientes. Estaban clonados dentro de
`AtlasAdminPortal/` por accidente: ese portal **no** forma parte del alcance ni
tiene relación con ellos.

## 0. Alcance y reparto de repositorios

| Repositorio                    | Qué recibe                                                    |
| ------------------------------ | ------------------------------------------------------------- |
| `AtlasDecisionEngine`          | Backend completo: módulos, colas, persistencia, endpoints, observabilidad, pruebas |
| `AtlasDecisionEngineFrontend`  | Pestaña «Procesamiento» y las dos vistas de worker             |

### Por qué el backend no puede vivir en el repositorio del frontend

`AtlasDecisionEngineFrontend` **no tiene backend**. Su ruta
`src/app/v1/[...path]/route.next.ts` es un comodín que reenvía todo `/v1/*` al
Decision Engine mediante `src/server/decision-engine-proxy.ts`; su propio
`INTEGRATION.md` lo dice sin rodeos — *«Frontend React … no contiene código del
backend»*. No hay ORM, ni base de datos, ni Redis, ni cola. El «motor simulado»
que usan las pruebas es interceptación de rutas de Playwright, no un servidor.

Montar allí una cola y una persistencia habría creado un segundo sistema de
seguimiento de jobs, que es justo lo que el encargo prohíbe en su §12.

## 1. Arquitectura de workers existente en `AtlasDecisionEngine`

Esta es la implementación de referencia que hay que imitar. Existe de extremo a
extremo y está madura.

| Capacidad             | Cómo está resuelto hoy                                                                 |
| --------------------- | -------------------------------------------------------------------------------------- |
| Tecnología de cola    | **PostgreSQL**, sin broker. Reclamo atómico con `FOR UPDATE SKIP LOCKED` + lease con vencimiento |
| Despertar             | `LISTEN`/`NOTIFY` en el canal `atlas_jobs`, con el nombre del trabajo como carga útil (`JobSignalService`) |
| Registro de trabajos  | `JobSchedulerService.register(job)`, contra la interfaz `BackgroundJob`                  |
| Nombres               | `src/common/jobs/job-names.ts` — constante `JobName`, tratada como contrato              |
| Reparto de procesos   | `WORKER_ROLE` = `ALL` \| `API` \| `WORKER` (`src/common/config/worker-role.ts`)          |
| Proceso worker        | `src/worker.ts` — mismo `AppModule`, sin adaptador HTTP, con sondas y `/metrics` propios |
| Concurrencia          | Por trabajo, vía configuración (p. ej. `TEST_RUN_WORKER_CONCURRENCY`)                    |
| Cadencia              | Retroceso exponencial adaptativo; `runOnce()` devuelve unidades procesadas               |
| Reintentos            | `attempt_count` en la fila + recuperación de leases vencidos                             |
| Idempotencia          | Tabla `RuntimeIdempotency` + purga periódica (`runtime-retention`)                       |
| Persistencia          | Prisma sobre PostgreSQL; una tabla de ejecución por dominio                              |
| Observabilidad        | `MetricsService`: `atlas_job_runs_total`, `atlas_job_items_total`, `atlas_job_duration_ms`, `atlas_job_wakeups_total`, `atlas_job_last_success_timestamp_seconds` |
| Trazas                | OpenTelemetry propio (`src/common/observability/tracing.ts`)                             |
| Apagado controlado    | `onModuleDestroy` drena lo que está en vuelo antes de cerrar el pool de Prisma           |
| Seguridad             | Decoradores `@Roles`, `@TenantId`, `@CurrentPrincipal` (`common/security/security.decorators`) |
| OpenAPI               | Decoradores `@ApiTags`/`@ApiOperation`/`@Api*Response`; el documento se genera            |

### Trabajos ya registrados

| Nombre              | Módulo          | Qué hace                                    |
| ------------------- | --------------- | ------------------------------------------- |
| `outbox-relay`      | `outbox-relay`  | Reparte el outbox transaccional al bus       |
| `test-run`          | `testing`       | Ejecuta corridas de prueba encoladas         |
| `runtime-retention` | `runtime`       | Purga filas de idempotencia vencidas         |

### Patrón de extremo a extremo, tomado de `testing`

```txt
TestingController (@Roles, @TenantId)
  → TestExecutionService: valida, crea decision_test_run en QUEUED
      dentro de la MISMA transacción: JobSignalService.notify(tx, 'test-run')
  → JobSchedulerService despierta al oír el NOTIFY
  → TestRunWorkerService.runOnce():
      recoverExpiredRuns()  — devuelve a QUEUED lo que perdió su lease
      claimNextRun()        — UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED LIMIT 1)
      execute(runId)        — heartbeat que renueva el lease; error ⇒ status ERROR
  → resultado persistido en decision_test_case_run / decision_test_coverage
  → GET /v1/test-runs/:id devuelve estado, progreso y resultado
```

Los seis puntos que hay que replicar sin negociación: reclamo atómico, lease con
latido, recuperación de leases vencidos, `notify` dentro de la transacción del
productor, `runOnce()` devolviendo el conteo, y drenaje en `onModuleDestroy`.

## 2. Worker adicional A — análisis semántico

`@business/semantic-analysis-worker`, ~60 archivos TypeScript, arquitectura
hexagonal estricta.

### Contrato

```ts
SemanticAnalysisRequest {
  requestId, idempotencyKey, text,
  tenantId?, requestedBy?, metadata?
}

SemanticAnalysisResult {
  requestId, status,            // MATCH | MULTI_MATCH | UNKNOWN | AMBIGUOUS | CONTRADICTED
  normalizedText, entities[], matches[],
  evaluatedCategoryCodes[], tierUsed,   // FAST | DEEP
  model, modelVersion, processingTimeMs
}
```

### Lo que se conserva tal cual

Todo el núcleo, porque no conoce infraestructura: `text-normalizer`,
`entity-resolver`, `lexical-candidate-retriever`, `hybrid-candidate-retriever`,
`decision-engine`, `semantic-analysis.pipeline`, `result-builder`,
`catalog-cache`, `tenant-budget.guard`, los esquemas y los tipos de dominio.

### Lo que hay que sustituir, y por qué

`src/application/ports.ts` deja toda la infraestructura detrás de símbolos de
inyección, así que la sustitución es de adaptadores, no de lógica.

| Puerto                          | Adaptador que trae         | Adaptador que recibe                                   |
| ------------------------------- | -------------------------- | ------------------------------------------------------ |
| `SEMANTIC_JOB_QUEUE`            | pg-boss 10.4.2             | `BackgroundJob` + `FOR UPDATE SKIP LOCKED` + `pg_notify` |
| `SEMANTIC_CATEGORY_REPOSITORY`  | Sequelize                  | Prisma                                                  |
| `ENTITY_ALIAS_REPOSITORY`       | Sequelize                  | Prisma                                                  |
| `SEMANTIC_AUDIT_REPOSITORY`     | Sequelize                  | Prisma                                                  |
| `CATEGORY_EMBEDDING_REPOSITORY` | Sequelize                  | Prisma                                                  |
| `TENANT_BUDGET_REPOSITORY`      | Sequelize                  | Prisma                                                  |
| `AUDIT_RETENTION_REPOSITORY`    | Sequelize                  | Prisma                                                  |
| `SEMANTIC_METRICS_RECORDER`     | Prometheus propio          | `MetricsService` del motor                              |
| —                               | OpenTelemetry propio       | `common/observability/tracing.ts` del motor             |

**Incompatibilidad principal: pg-boss.** Es una segunda tecnología de colas y
un segundo sistema de seguimiento de jobs. El motor ya resuelve lo mismo sobre
las tablas que ya tiene. Se descarta el adaptador, se conserva el puerto.

Lo que pg-boss aportaba y hay que reimplementar explícitamente: reintentos con
retroceso, cola dead-letter, deduplicación por clave de idempotencia y
profundidad de cola (`getDepth()`, que alimenta `recordQueueDepth`).

**Segunda incompatibilidad: Sequelize.** El motor usa Prisma. Las migraciones
`001`–`003` del esquema `semantic_analysis` se traducen a una migración Prisma
versionada.

**Tercera: proveedores de modelo.** Trae adaptadores OpenAI y Ollama tras
`SEMANTIC_MODEL_PROVIDER`. Se conservan ambos; sin credenciales configuradas el
worker debe quedar deshabilitado por variable de entorno, no fallar al arrancar.

## 3. Worker adicional B — extractos bancarios

`@cpa/bolivia-bank-statement-worker`. Perfil opuesto: **no tiene cola, ni base
de datos, ni llamadas externas**. Es un motor en memoria.

```ts
const engine = createStatementEngine();
const normalized = await engine.normalize(pdf);   // NormalizedBankStatement
```

Cascada de tres estrategias con techo de confianza propio: analizador
especializado (`1.00`), perfil configurable (`0.92`), motor generalista
(`0.85`). Formatos verificados: BGA, BEC, BCR, BME, BNB, BUN, BSO.

### Lo que se conserva tal cual

Todo `engine/`, `parsers/`, `pdf/`, `csv/`, `json/`, `institutions/`,
`domain/`. Es lógica pura sobre un `Buffer`.

### Lo que hay que añadir

No es una incompatibilidad sino una ausencia: hoy es **síncrono** sobre HTTP
(`bank-statement.controller.ts` con `multer`). El encargo exige un worker
persistente, así que se envuelve:

- Tabla de ejecución con estado, progreso, intentos y referencia al resultado.
- Reclamo atómico y lease, igual que `test-run`.
- Almacenamiento del PDF de entrada y del resultado.
- Endpoint de descarga (CSV / JSON / contrato normalizado).

Sus controladores propios (`bank-statement.controller.ts`, `…ui.controller.ts`,
`…docs.controller.ts`) **no se montan**: duplicarían endpoints y una interfaz
que el portal ya provee.

**Nota de privacidad, ya resuelta por el motor:** enmascara el número de cuenta
(`accountNumberMasked`) y no registra contenido bancario. Esa garantía se
mantiene en la capa que se añade: el PDF no se registra en logs y el resultado
almacenado hereda el enmascarado.

## 4. Matriz de capacidades

| Capacidad         | Implementación existente                     | Worker A                     | Worker B                  | Acción requerida                                   |
| ----------------- | -------------------------------------------- | ---------------------------- | ------------------------- | -------------------------------------------------- |
| Registro de cola  | `JobSchedulerService.register`                | pg-boss                      | no tiene                  | Adaptar A, crear para B                            |
| Creación de job   | Fila `QUEUED` + `notify` en la transacción    | `enqueue()` de pg-boss       | no tiene                  | Reescribir sobre el patrón del motor               |
| Validación        | DTO + `class-validator`                       | Zod propio                   | validación de archivo     | Conservar la de dominio, añadir DTO en el borde    |
| Persistencia      | Prisma                                        | Sequelize                    | ninguna                   | Migración Prisma nueva para ambos                  |
| Progreso          | `status` + `attempt_count`                    | sin progreso parcial         | sin progreso parcial      | Añadir `progress` a la tabla de ejecución          |
| Resultado         | Tabla por dominio                             | tabla de auditoría           | valor en memoria          | Tabla de resultado por worker                      |
| Reintentos        | `attempt_count` + recuperación de lease       | pg-boss                      | no tiene                  | Patrón del motor para ambos                        |
| Idempotencia      | `RuntimeIdempotency`                          | clave por tenant             | no tiene                  | Conservar la de A; añadir a B por huella del archivo |
| Interfaz          | Páginas del portal                            | ninguna                      | UI propia (se descarta)   | Pestaña nueva con dos vistas                       |
| Datos de prueba   | Semillas de `seeding`                         | `local-fixtures/`            | `examples/`               | Fixtures versionados, servidos por endpoint        |
| Carga de archivos | no existe hoy                                 | no aplica                    | `multer`                  | Capacidad nueva, con validación por contenido      |
| Pruebas           | Jest + `test/`                                | Jest propio                  | Jest propio               | Portar y ampliar                                   |
| Observabilidad    | `MetricsService` + OTel                       | Prometheus propio            | métricas de conversión    | Sustituir por el recolector del motor              |

## 5. Bloqueos y riesgos detectados

1. **Sin credenciales de modelo, el worker A no puede clasificar.** Se resuelve
   con un interruptor de entorno: deshabilitado por defecto, y el `UNKNOWN`
   degradado que el propio worker ya contempla.
2. **`pdfjs-dist` es una dependencia pesada** y nueva para el motor. Sólo la
   carga el proceso worker; conviene que no entre en el arranque de la API.
3. **Almacenamiento de archivos: el motor no tiene uno.** Hay que decidirlo en
   la Fase 2 sin introducir un proveedor nuevo (§12 lo prohíbe).
4. **Otro agente trabaja en el repositorio del frontend** con ~28 archivos sin
   commitear. La Fase 4 debe esperar a que consolide, o resolverse en una rama
   aparte, para no secuestrar sus commits.

## 6. Conclusión

No hace falta inventar procedimiento: `testing` + `common/jobs` ya es el patrón
completo, y los dos workers encajan en él sin desnaturalizarse.

- El worker A conserva **todo su núcleo** y cambia sólo adaptadores, porque su
  arquitectura hexagonal ya separaba exactamente eso.
- El worker B conserva **todo su motor** y gana la capa asíncrona que le falta.
- Se descartan pg-boss, Sequelize, la telemetría duplicada y los controladores
  de interfaz propios del worker B.
