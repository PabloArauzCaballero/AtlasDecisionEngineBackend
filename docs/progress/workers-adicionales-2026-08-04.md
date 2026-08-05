# Integración de dos workers adicionales — informe

**Fecha:** 2026-08-04 · **Rama:** `feat/workers-adicionales-semantico-y-extractos`
(misma en los dos repositorios).

## 1. Qué se incorporó

| Worker | Origen | Qué hace |
| --- | --- | --- |
| Análisis semántico | `@business/semantic-analysis-worker` | Clasifica texto libre contra un catálogo de categorías, resolviendo entidades, montos y fechas |
| Extractos bancarios | `@cpa/bolivia-bank-statement-worker` | Convierte extractos bolivianos en PDF a movimientos normalizados |

Los dos llegaron como repositorios independientes. Estaban clonados dentro de
`AtlasAdminPortal/` por accidente; ese portal quedó **fuera de alcance**.

## 2. Arquitectura reutilizada

No se inventó procedimiento: el motor ya tenía uno completo y en producción.

- `src/common/jobs/` — orquestador con retroceso adaptativo, despertar por
  `LISTEN`/`NOTIFY` y un solo ciclo de vida.
- El patrón de `test-run`: reclamo atómico con `FOR UPDATE SKIP LOCKED`, lease
  con latido, recuperación de leases vencidos y drenaje en `onModuleDestroy`.
- `MetricsService` (`atlas_job_*`), el tracer de OpenTelemetry ya registrado,
  `PrismaService`, los decoradores `@Roles`/`@TenantId` y la RLS por tenant.

**Se descartó** de los paquetes: pg-boss, Sequelize, sus registros de Prometheus,
su bootstrap de OpenTelemetry, sus controladores HTTP y su interfaz propia.

## 3. Archivos

### `AtlasDecisionEngine` (backend)

**Nuevos** — `src/modules/workers/` (81 archivos, ~11 400 líneas), de los cuales
80 son núcleo absorbido **sin modificar** salvo por la resolución de imports:

- `bank-statement/core/` (48) · `bank-statement/` (servicio, processor,
  validación, descargas, fixtures, controlador)
- `semantic-analysis/core/` (32) · `semantic-analysis/` (servicio, processor,
  puente de configuración, fixtures, controlador) · `adapters/` (4)
- `workers.controller.ts`, `workers.dto.ts`, `workers.mapper.ts`, `workers.module.ts`
- `scripts/run-jest.mjs`
- `test/bank-statement-fixtures.spec.ts`
- `docs/workers/*`, `docs/adr/ADR-0026-*`

**Modificados** — `prisma/schema.prisma`, `src/app.module.ts`,
`src/common/config/env.schema.ts`, `src/common/jobs/job-names.ts`,
`package.json` (scripts de prueba + dos dependencias), `yarn.lock`.

### `AtlasDecisionEngineFrontend` (portal)

**Nuevos** — `src/features/workers/` (9), `src/pages/{Semantic,Bank}*.tsx`,
`src/app/(portal)/workers/**` (2), `src/styles/parts/workers{,-run}.css`,
`docs/AGENT-COORDINATION.md`.

**Modificados** — `access-policies.ts` (+1), `route-access.ts` (+2),
`navigation.ts` (+1 sección), `global.css` (+2 `@import`), `api/http-client.ts`.

## 4. Migraciones

| Migración | Contenido |
| --- | --- |
| `20260804090000_additional_workers` | `decision_semantic_analysis_run`, `decision_bank_statement_run`, enums `WorkerRunStatus` y `WorkerInputSource`, índices y RLS |
| `20260804120000_semantic_analysis_catalog` | Catálogo semántico: categorías, alias, embeddings y presupuesto por tenant, con RLS |

Ninguna tabla existente se modifica. No hay pérdida de historial ni cambio de
estados compartidos.

## 5. Endpoints

`GET /v1/workers` · y por worker (`semantic-analysis`, `bank-statement`):
`GET fixtures`, `POST runs`, `GET runs`, `GET runs/:id`, `POST runs/:id/cancel`.
Extractos añade `GET runs/:id/download?format=csv|json|normalized`.

## 6. Evidencia

| Verificación | Resultado |
| --- | --- |
| Typecheck backend | **limpio** |
| Prisma validate | **válido** |
| `bank-statement-fixtures.spec.ts` | **9/9 en verde** contra el motor real |
| No regresión backend (`test:unit`) | **660 pasadas / 663**, 1 fallo preexistente |
| `verify-source` frontend | **verde** — 617 archivos |
| Typecheck frontend | **limpio** |
| ESLint frontend | **sin avisos** |
| `worker-types.test.ts` | **9/9 en verde** |

La prueba de fixtures ejercita el motor de extractos entero —lector de PDF,
clasificador, detector de institución, inferencia de tabla y validaciones
financieras— dentro de este repositorio y con su compilación a CommonJS. Es la
prueba de equivalencia funcional. Incluye la comprobación de que el número de
cuenta **nunca** sale sin enmascarar.

### Regresión preexistente, documentada

`test/script-prueba.spec.ts` falla. **No lo causa este cambio**: en `dev` limpio
ese mismo spec falla **3 de 6**, frente a 1 aquí. Afecta al ejecutor de scripts
Python (`ScriptNodeRunnerService.executeInProcess`); el entorno tiene Python
3.14.6 instalado, así que no es falta de intérprete. Queda fuera de este trabajo.

## 7. Riesgos y decisiones

1. **`pdfjs-dist` v5 es ESM puro** y el motor compila a CommonJS, donde
   TypeScript degrada `await import()` a `require()`. El fallo aparecía en
   tiempo de ejecución, no al compilar. Aislado en `core/pdf/esm-import.ts`.
2. **Ese mismo import no funciona en la VM de Jest** sin
   `--experimental-vm-modules`; sin el flag las pruebas caían con
   `PDF_EXTRACTION_FAILED`, que parece un fallo del motor y no lo es. Cableado
   en `scripts/run-jest.mjs`, sin añadir `cross-env`.
3. **El PDF se guarda en PostgreSQL** y se borra al cerrar la ejecución. Correcto
   para documentos acotados a 10 MiB; deja de serlo si el volumen crece
   (ver plan de revisión del ADR-0026).
4. **Los serializadores CSV/JSON del paquete de extractos se eliminaron**:
   quedaron huérfanos al descartar sus controladores y publicaban
   `account_number` completo. La descarga se reescribió sobre el contrato
   normalizado, que va enmascarado.
5. **El worker semántico exige `SEMANTIC_ANALYSIS_PROVIDER`.** Sin él no se
   registra y lo dice en el log, en vez de encolar trabajo condenado a fallar.

## 8. Segunda tanda — lo que se cerró después

Todo esto estaba en «pendientes» y ya no lo está. Rama:
`test/workers-integracion-postgres`.

| Pendiente | Estado |
| --- | --- |
| Migraciones contra PostgreSQL real | **aplicadas** — 6 tablas, RLS y 20 índices verificados |
| Integración contra Postgres | **10/10** (`test/worker-runs.integration.spec.ts`) |
| Semilla del catálogo semántico | **hecha** — 5 categorías, 10 alias, idempotente |
| OpenAPI regenerado | **hecho** — 10 rutas, gate 122/122 con esquema |
| `yarn build` del backend | **limpio** |
| E2E del portal | **escrito** (`e2e/workers.spec.ts`, 6 casos) |

### Lo que la integración demuestra

Las garantías de la cola ya no están sólo razonadas. Se comprueban donde de
verdad viven —no en JavaScript— y por eso no se pueden probar con dobles:

- reclamo atómico (`FOR UPDATE SKIP LOCKED`): nunca entrega la misma ejecución
  dos veces, y respeta el orden de llegada con desempate por `id`;
- idempotencia: el índice único rechaza el archivo duplicado **en la base**, y
  lo permite en otro tenant;
- cota de intentos: deja de reclamar lo que agotó sus reintentos;
- recuperación de leases: lo que perdió el suyo vuelve a la cola y se reclama;
- rango del progreso: el `CHECK` rechaza un 340 %;
- privacidad: el documento se borra al cerrar y el resultado se conserva.

Un caso falló al principio por contaminación entre pruebas —no por un defecto
del producto— y está documentado en el propio archivo.

## 8 bis. Defectos propios encontrados por otros agentes

Trabajaron sobre el mismo árbol y encontraron cosas que yo no vi. Se anotan aquí
porque son defectos reales de esta integración, no incidencias de proceso.

1. **El motor no arrancaba sin `OPENAI_API_KEY`** (lo corrigió el agente de
   documentación). `workers.module.ts` construía el proveedor de OpenAI al
   cablear el módulo, y su fábrica valida la clave al construir: cualquier
   proceso sin esa variable moría al iniciar, incluida una réplica de API con el
   worker apagado. Peor: el generador de OpenAPI fallaba **en silencio** —salida
   0, sin mensajes— y dejaba el contrato publicado sin las operaciones de
   `/v1/workers`. Resuelto con un puente que construye en la primera
   clasificación.

2. **La retención del texto analizado no se ejecutaba nunca** (mismo agente).
   `AuditRetentionService` estaba absorbido y completo, pero nada lo invocaba:
   en el paquete original lo disparaba el planificador de pg-boss, que se
   descartó. `input_text` se conservaba indefinidamente. Resuelto con un trabajo
   `semantic-retention`. **Es el fallo más instructivo de toda la integración**:
   al sustituir una infraestructura hay que inventariar también lo que esa
   infraestructura *disparaba*, no sólo lo que ofrecía.

3. **El presupuesto de análisis se quedaba corto** (corregido aquí).
   `assertProviderTimeoutFitsAnalysis` exige
   `timeout × intentos × 2 tiers ≤ analysisTimeoutSeconds`, y el puente derivaba
   el presupuesto del lease sin comprobar la desigualdad: con los valores por
   defecto salían 180 s de peor caso contra 110 s de presupuesto, y la **primera
   clasificación** fallaba. El lease pasa a ser un suelo que se eleva al peor
   caso del proveedor, y `test/semantic-config-bridge.spec.ts` fija la aritmética
   con un barrido para que no se rompa en silencio.

## 9. Pendientes que siguen abiertos

- **Smoke de extremo a extremo con el stack levantado**: API → cola → worker →
  resultado consultable por HTTP. La integración cubre la cola contra Postgres,
  no el recorrido completo por la API.
- **Verificación de la inyección de dependencias del módulo semántico** en un
  arranque real: el typecheck no detecta un proveedor que falte.
- **Ejecución del E2E del portal**: el spec está escrito y commiteado, falta
  correrlo en verde.
- **Modo híbrido de recuperación**: absorbido pero no activado; necesita un
  vector por categoría calculado de antemano.
- **`yarn build` del frontend** no se ejecutó (la imagen Docker sí se
  reconstruyó, que lo ejercita).

## 10. Aviso de coordinación

Hay **otro agente trabajando en `AtlasDecisionEngine` a la vez**, en
observabilidad. Consolidó `tracing.service.ts` y `messaging-trace.service.ts` en
`src/common/observability/` y reescribió los imports de este módulo — es el
refactor correcto y elimina la duplicación que la absorción había introducido.

Su trabajo en curso deja hoy el `typecheck` en rojo por dos cosas suyas
(`telemetry.instrumentations.ts` con identificador duplicado y las pruebas de
`job-scheduler` desfasadas tras añadir un cuarto argumento al constructor).
**Ninguna es de los workers** y no se han tocado. Detalle en
`docs/AGENT-COORDINATION.md`.
