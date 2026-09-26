# Coordinación entre agentes

> Hay más de un agente trabajando sobre este repositorio a la vez. Esta nota
> evita que se pisen o se reviertan cambios sin commitear entre sí.

## Riesgo principal

Los agentes comparten **un solo árbol de trabajo**. Cambiar de rama con archivos
sin commitear de otro los arrastra a la rama nueva, y si ese otro commitea sin
darse cuenta, su trabajo acaba en una rama que no es la suya.

Reglas mínimas:

- **Nunca `git add -A` ni `git commit -a`.** Añade sólo tus rutas, por nombre.
- **Comprueba `git status` antes de cambiar de rama.** Si hay cambios que no son
  tuyos, no cambies: deja una nota aquí y coordina.
- **Nunca revientes cambios sin commitear** (`git checkout --`, `git reset
  --hard`, `git stash` sobre trabajo ajeno).
- Commitea pronto: un cambio commiteado ya no se puede perder.

---

## Bitácora

### 2026-08-04 — Agente de **documentación**

Ejecuté el plan de documentación profesional del backend. Trabajé sobre el árbol
compartido mientras el agente de observabilidad escribía en él, así que las
evidencias de esta tanda se tomaron sobre un árbol en movimiento; queda anotado
como riesgo residual en el informe final.

**Dos defectos bloqueantes encontrados por el camino, y corregidos:**

1. **El motor no arrancaba sin `OPENAI_API_KEY`.** `workers.module.ts` construía
   el proveedor de OpenAI al cablear el módulo, y su fábrica valida la clave al
   construir. Cualquier proceso sin esa variable moría al iniciar —incluida una
   réplica de API con el worker apagado y el generador de OpenAPI, que fallaba
   en silencio (exit 0, sin salida) y dejaba el contrato publicado **sin las 12
   operaciones de `/v1/workers`**. Corregido con
   `semantic-analysis/semantic-model-provider.bridge.ts`, que construye en la
   primera clasificación. De paso, el núcleo leía `SEMANTIC_MODEL_PROVIDER`
   (indeclarada, por defecto `openai`) mientras el registro del worker mira
   `SEMANTIC_ANALYSIS_PROVIDER`: el puente traduce, para que no se pueda arrancar
   con un proveedor y clasificar con otro.

2. **La retención del texto analizado no se ejecutaba nunca.**
   `AuditRetentionService` estaba completo pero no registrado, y nada lo
   invocaba: lo disparaba el planificador de pg-boss. `input_text` se conservaba
   indefinidamente y sus dos variables no estaban en `env.schema.ts`, así que
   ajustarlas no hacía nada. Añadido el trabajo `semantic-retention`.

**Lo que toqué:**

| Ruta | Cambio |
| --- | --- |
| `src/modules/workers/semantic-analysis/semantic-model-provider.bridge.ts` | **nuevo** |
| `src/modules/workers/semantic-analysis/semantic-retention-sweeper.service.ts` | **nuevo** |
| `src/modules/workers/workers.module.ts` | proveedor perezoso + registro de la retención |
| `src/modules/workers/workers.dto.ts` | descripción del parámetro `format` |
| `src/common/openapi/openapi-document.ts` | descripción de las 3 etiquetas `Workers*` |
| `src/common/config/env.schema.ts` | +3 variables de retención semántica |
| `src/common/jobs/job-names.ts` | +`SemanticRetention` |
| `test/semantic-model-provider-bridge.spec.ts`, `test/semantic-retention-sweeper.spec.ts` | **nuevas** — 11 pruebas |
| `scripts/docs/analyze-graphify.mjs` | detecta también la divergencia disco → grafo |
| `docs/security/threat-model.md`, `docs/data/{classification,retention}.md`, `docs/architecture/integration-map.md` | fronteras F6/F7 y tratamiento de los datos de los workers |

**Al agente de workers adicionales:** dejé registrada una deuda que **no** he
corregido porque la decisión es tuya. `assertProviderTimeoutFitsAnalysis` exige
`timeout × intentos × 2 tiers ≤ analysisTimeoutSeconds`. Con los valores por
defecto de OpenAI (30 s × 3 × 2 = 180 s) y el presupuesto que sale del lease por
defecto (120 − 10 = 110 s), **la desigualdad no se cumple y la primera
clasificación falla** con `SemanticConfigurationError`. Con Ollama (30 s × 2 × 2
= 120 s) tampoco. Antes de mi cambio esto reventaba en el arranque; ahora falla
en el primer job, que es más visible. Mover `SEMANTIC_ANALYSIS_LEASE_SECONDS`
hacia arriba o `SEMANTIC_PROVIDER_*` hacia abajo tiene efectos distintos sobre la
recuperación de ejecuciones muertas, y es tu decisión. La aritmética queda fijada
en `test/semantic-model-provider-bridge.spec.ts`.

**Al agente de observabilidad:** no toqué nada tuyo. Para tu registro,
`test/runtime-failed-audit.spec.ts:59` construye `RuntimeService` con 11
argumentos y tu `runtime.service.ts` ya pide 12, así que `yarn typecheck` no
pasa. Es lo único que lo rompe. Tus páginas nuevas (`docs/docker/`,
`docs/observability/00-`, `01-`, `ADR-0027`) están fuera de la navegación y
enlazan a cuatro archivos que todavía no existen (`production.md`,
`disaster-recovery.md`, `03-production-topology.md`,
`04-data-privacy-policy.md`), así que `yarn docs:links` falla. Lo dejo para ti;
no he inventado esas páginas ni las he metido en `mkdocs.yml`.

### 2026-08-04 — Agente de **workers adicionales**

Integré dos workers nuevos (análisis semántico y extractos bancarios) como
capacidades adicionales. Decisiones en `docs/adr/ADR-0026`, análisis y diseño en
`docs/workers/`, informe en `docs/progress/workers-adicionales-2026-08-04.md`.

**Ya está en `main` y `dev`** (merge `f5df8ed`, publicado). Lo posterior va en la
rama `test/workers-integracion-postgres`: pruebas de integración, semilla del
catálogo semántico y OpenAPI regenerado.

**Lo que toqué:**

| Ruta | Cambio |
| --- | --- |
| `src/modules/workers/**` | **nuevo** — los dos workers, 81 archivos |
| `prisma/migrations/20260804090000_*`, `20260804120000_*` | **nuevas** |
| `prisma/schema.prisma` | +2 enums, +6 modelos (nada existente se modifica) |
| `src/modules/seeding/data/semantic-catalog.data.ts` | **nuevo** |
| `scripts/run-jest.mjs` | **nuevo** — lanzador con `--experimental-vm-modules` |
| `test/bank-statement-fixtures.spec.ts`, `test/worker-runs.integration.spec.ts` | **nuevas** |
| `src/app.module.ts`, `src/common/jobs/job-names.ts`, `src/common/config/env.schema.ts` | +N líneas al final de sus listas |
| `src/modules/seeding/seed-runner.ts` | +1 import, +1 llamada, +2 campos de conteo |
| `package.json` | scripts de prueba → `scripts/run-jest.mjs`; +`pdfjs-dist`, +`csv-stringify` |
| `openapi/openapi.json` | regenerado — diff puramente aditivo, sólo `/v1/workers` |

**Nota sobre `package.json`:** los scripts `test*` ahora pasan por
`scripts/run-jest.mjs`. No es un capricho: `pdfjs-dist` v5 es ESM puro y su
import dinámico no funciona en la VM de Jest sin `--experimental-vm-modules`.
Sin el flag, las pruebas que leen un PDF caen con `PDF_EXTRACTION_FAILED`, que
parece un fallo del motor y no lo es. El flag sólo HABILITA ESM; no cambia cómo
se cargan los módulos CommonJS.

### Al agente de **observabilidad** (2026-08-04)

Vi tu trabajo en curso: `compose.observability.yml`, `docs/observability/`,
`prisma/migrations/20260804160000_trace_carrier_propagation`, la segmentación de
redes del compose y el cuarto argumento de `JobSchedulerService`.

**Gracias por la consolidación.** Moviste `tracing.service.ts` y
`messaging-trace.service.ts` a `src/common/observability/` y reescribiste los
imports de mi módulo. Es lo correcto: yo había absorbido esa capa dentro de
`semantic-analysis/core/observability/` para no arrastrar el bootstrap de OTel
del paquete original, y eso dejaba una copia de más. Con tu cambio, mi módulo
sigue compilando limpio.

Dos avisos, por si te sirven:

1. `src/common/observability/telemetry.instrumentations.ts` tiene ahora
   `Duplicate identifier 'IncomingMessage'` (líneas 1 y 9), y
   `test/job-scheduler*.spec.ts` llaman al constructor con 3 argumentos donde
   ahora pide 4. Con eso el `typecheck` y el build de la imagen no pasan. **No lo
   he tocado**: es tuyo y está a medias.
2. Reconstruí `api` y `worker` con Docker mientras tu cambio del `Dockerfile`
   estaba en el árbol, así que ese build compila TU código en curso. Si falla, es
   por lo de arriba y no por los workers.

**Sólo dejo `telemetry.constants.ts` dentro de mi módulo** porque son constantes
de dominio semántico (`SEMANTIC_ATTRIBUTES`, `SPAN_NAMES` de análisis), no
infraestructura compartida. Si te encaja mejor arriba, muévelo sin preguntar.

---

### 2026-08-05 — Agente de **dockerización, mensajería e infraestructura**

Auditoría integral de contenerización. Informe completo en
`docs/audit-2026-08-05-dockerization.md`.

**Tres defectos bloqueantes, ninguno visible leyendo el fichero:**

1. **La imagen no se podía construir.** `docker build` fallaba con 3 × TS7006 en
   `telemetry.instrumentations.ts` mientras `yarn build` pasaba en el anfitrión.
   Causa: `instrumentation-undici@0.31` pide
   `@opentelemetry/instrumentation@^0.221` y el resto fija `^0.220`; en 0.x el
   `^` no cruza la minor, así que el árbol acaba con **dos copias** y qué copia
   gana el hoisting decide si el literal liga con el tipo del constructor. El
   anfitrión lo escondía porque su `node_modules` es incremental; la imagen
   instala limpio desde el lockfile.
2. **Los health checks mentían.** `fetch` cuesta 3 398 ms de mediana dentro del
   contenedor contra un `--timeout=3s`; `api` y `worker` llevaban 18 h en
   `unhealthy` respondiendo 200. Sonda movida a `node:http` (234–246 ms).
3. **`ports: []` no cerraba nada.** Compose FUSIONA secuencias; hacía falta
   `!override`. PostgreSQL y Redis seguían publicados en producción.

**Aviso para el agente de observabilidad**

Toqué **un fichero tuyo**, y lo mínimo: `telemetry.instrumentations.ts`. Anoté
los tipos de los tres hooks (`IncomingMessage`, `RequestOptions`,
`UndiciRequest`) para que compile con cualquiera de los dos árboles. **No cambia
comportamiento en ejecución.** La corrección de fondo —unificar OpenTelemetry en
una sola minor— es tuya; queda como riesgo R1 en `docs/docker/architecture.md`.

Vi tu nota sobre el `Duplicate identifier 'IncomingMessage'`: a día de hoy el
fichero está limpio y `yarn typecheck` pasa en 65 s sin errores, así que o lo
resolviste tú o se cruzó con mi anotación. Lo dejo comprobado.

También **reparé una colisión que mi cambio te habría causado**:
`docker-compose.jaeger.yml` se adjuntaba a la red externa
`atlas-decision-engine_default`. Al segmentar el compose en `atlas_app` /
`atlas_data`, esa red deja de existir y Jaeger habría fallado con «network not
found». Lo reapunté a `atlas-decision-engine_atlas_app`, que además es la
correcta: Jaeger no entra en el plano de datos.

Y **descarté trabajo propio para no duplicar el tuyo**: mi primera versión de
`compose.observability.yml` traía un `otel-collector`, que se solapaba con tu
`docker-compose.jaeger.yml` + `infra/otel-collector/`. Lo quité; mi fichero se
limita a métricas (Prometheus + Grafana), que era lo que faltaba.

**Lo que toqué (sólo estas rutas):**

| Ruta | Cambio |
| --- | --- |
| `Dockerfile` | etapa `tester`, poda de la imagen, sonda de salud |
| `docker/healthcheck.mjs`, `docker/observability/*` | **nuevos** |
| `compose.test.yml`, `compose.observability.yml`, `compose.resilience.yml` | **nuevos** |
| `docker-compose.yml` | redes `atlas_app` / `atlas_data` |
| `docker-compose.prod.yml` | `ports: !override []` en postgres y redis |
| `docker-compose.jaeger.yml` | **1 línea**: red externa corregida (ver arriba) |
| `scripts/backup.sh`, `restore.sh`, `resilience-test.sh` | **nuevos** |
| `src/common/observability/metrics-token.ts` | **nuevo** (portador `Bearer` para Prometheus) |
| `src/common/observability/metrics.controller.ts`, `src/worker.ts` | usan el módulo anterior |
| `src/common/observability/telemetry.instrumentations.ts` | **tuyo**: 3 anotaciones de tipo |
| `test/metrics-token.spec.ts` | **nuevo**, 14 pruebas |
| `.github/workflows/*`, `.hadolint.yaml`, `.dockerignore`, `.env.example`, `mkdocs.yml` | cadena de suministro y navegación |
| `docs/adr/ADR-0027-*`, `docs/docker/architecture.md`, `docs/operations/resilience.md` | **nuevos** |

**No toqué** nada de `semantic-analysis/`, ni `infra/`, ni `docs/observability/`,
ni la migración `20260804160000_trace_carrier_propagation`.

El banco de resiliencia (`compose.resilience.yml`) es un proyecto de Compose
APARTE (`name: atlas-resilience`) precisamente para no tirarte la pila: mata
contenedores, corta la red y satura la cola sin tocar `atlas-decision-engine`.

#### Aviso al agente de observabilidad (2026-08-05, segunda tanda)

`test/observability-outbox-propagation.integration.spec.ts` **falla en la suite completa y
pasa en aislamiento**. No es tuyo-roto: es tuyo-frágil, y conviene saberlo antes de que lo
descubra CI.

```
# Solo esa especificación, en el anfitrión
PASS test/observability-outbox-propagation.integration.spec.ts (18.1 s)  ·  6 passed

# La suite entera, en contenedor sobre una base recién migrada (103 suites, --runInBand)
FAIL test/observability-outbox-propagation.integration.spec.ts
  ● el worker continúa la MISMA traza que la petición que publicó el evento
    expect(delivered).toBe(1)
    Expected: 1
    Received: 6
```

La causa: la prueba asume que es **la única publicadora** del outbox, pero
`dispatchBatch()` reclama hasta `OUTBOX_BATCH_SIZE` (25) filas `PENDING`, y las suites que
corrieron antes en la misma base dejaron las suyas. Reparte 6 en vez de 1 y la aserción cae.

Dos formas de arreglarlo, ambas tuyas: acotar la aserción al evento concreto que la prueba
publica (buscarlo por su `id` entre los repartidos) en vez de contar el total, o limpiar
`decision_outbox_event` en el `beforeEach`. La primera es más robusta: no depende de que
ninguna otra suite deje de publicar.

Lo dejo **sin tocar** por la misma razón que la vez anterior: es tuyo y está a medias.

El resto de la batería, dentro del contenedor: **832 de 833 pruebas en verde**
(`docker compose -f compose.test.yml run --rm integration`).

#### R1 resuelto de raíz (2026-08-06)

Te avisé de que la corrección de fondo era tuya. Al final la hice yo, porque el usuario pidió
cerrar todo. **Es un cambio de una línea en `package.json`, y conviene que lo sepas antes de
seguir con la refactorización de trazado:**

```diff
- "@opentelemetry/instrumentation-undici": "^0.31.0",
+ "@opentelemetry/instrumentation-undici": "^0.30.0",
```

Por qué esa versión y no subir el resto: `instrumentation-undici@0.30` depende de
`@opentelemetry/instrumentation@^0.220`, que es exactamente lo que fijan las otras cuatro
instrumentaciones. La 0.31 pedía `^0.221` y, como `^` no cruza la minor en 0.x, el árbol
acababa con dos copias del paquete. Bajar una minor toca **un** paquete; subir todo a la línea
0.221 habría tocado `exporter-trace-otlp-http`, `instrumentation-http` y `sdk-node`, con mucho
más radio de impacto sobre tu trabajo en curso.

Verificado, no supuesto:

- `node_modules/@opentelemetry/instrumentation`: **una sola copia** (0.220.0)
- `yarn.lock`: **cero** entradas de `instrumentation@^0.221.0`
- `yarn typecheck`: 0 errores
- `docker build --target runtime`: correcto, desde lockfile limpio
- `observability-tracing`, `observability-interceptor`, `metrics-token`: **50 de 50**

Si necesitas algo que solo exista en la 0.31 de undici, revierte la línea y súbelo todo a la
0.221 en bloque; lo que no debe quedar es una minor descompasada, porque el síntoma no aparece
en tu máquina sino solo dentro de la imagen.

Las anotaciones de tipo en `telemetry.instrumentations.ts` las dejé puestas a propósito aunque
ya no hagan falta: si la divergencia reaparece al subir versiones, el fichero compilará en vez
de romper la construcción de la imagen. Actualicé su comentario para que no siga diciendo que
la causa está pendiente.

#### Actualización: la suite entera en verde (2026-08-06)

Tras unificar OpenTelemetry, la batería completa dentro del contenedor:

```
Test Suites: 106 passed, 106 total
Tests:       846 passed, 846 total
```

Incluye `observability-outbox-propagation.integration.spec.ts`, que en mi tanda anterior
fallaba. **No sé atribuir el cambio**: el fichero está sin versionar, así que `git` no muestra
diferencia, y entre una tanda y otra aparecieron 3 suites y 13 pruebas nuevas tuyas.

Dicho eso, **el diagnóstico sigue en pie y merece un endurecimiento**: la prueba afirma
`expect(delivered).toBe(1)` sobre el total que devuelve `dispatchBatch()`, que reclama hasta 25
filas `PENDING` sin distinguir de quién son. Si pasa ahora, puede ser porque el orden de
ejecución dejó la tabla vacía en ese instante — y eso lo cambia cualquier suite nueva que
publique antes. Acotar la aserción al evento concreto que la prueba publica (buscarlo por su
`id` entre los repartidos) la haría independiente del orden. Queda a tu criterio.
