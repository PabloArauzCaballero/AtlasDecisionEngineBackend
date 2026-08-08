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
| `GET`  | `/v1/workers/:code/metrics?windowHours=`     | Salud: reparto por estado, latencia, cola, incidencias |
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

### Métricas: por qué las calcula el motor

`GET /v1/workers/:code/metrics` publica lo que hace falta para decidir si se
puede contar con un worker: reparto por estado, percentiles de proceso y de
espera, profundidad de la cola y fallos **agrupados por causa**, sobre una
ventana en horas (7 días por omisión, 30 de techo).

Se calcula en PostgreSQL —`percentile_cont` y un `DISTINCT ON` sobre el índice
`(tenant_id, queued_at)` que las dos tablas ya tienen— y no en el cliente. Antes
lo derivaba el portal desde una página de ejecuciones, y eso tiene dos defectos
que no son de estilo: el percentil describía **las filas que cupieron en la
página**, no la ventana, así que cambiaba con el tamaño de página; y cualquier
segundo cliente tendría que reimplementar la misma aritmética, con dos pantallas
dando cifras distintas del mismo worker.

Lo que devuelve son contadores y tiempos: ni texto analizado, ni nombre de
archivo, ni resultado. Por eso puede servirse a los mismos roles de lectura sin
ampliar el acceso a los datos procesados. Un hueco (`null`) significa «en la
ventana no hubo de qué medirlo», nunca cero: un `0 %` de éxito afirmaría que
todo falló.

## 5. Permisos

Rol nuevo no; se reutilizan los existentes. Regla de mínimo privilegio y
denegación por defecto, validada en el backend con `@Roles`, nunca ocultando
botones.

| Acción                      | Roles                                              |
| --------------------------- | -------------------------------------------------- |
| Ver el catálogo de workers   | `RISK_ANALYST` `FRAUD_ANALYST` `QA_ANALYST` `OPERATIONS` `COMPLIANCE` `AUDITOR` |
| Ver la salud de un worker    | mismos que ver el catálogo — son contadores y tiempos, no datos procesados |
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
SEMANTIC_ANALYSIS_PROVIDER=            # openai | transformer; vacío ⇒ worker no se registra
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

### Encender el worker semántico con el clasificador de transformers

El worker semántico **no genera texto: clasifica**. Asigna la descripción de un
movimiento bancario —«PAGO ALQUILER DEPARTAMENTO JULIO»— a una hoja de un árbol
de categorías de gasto e ingreso. Para eso no hace falta un modelo que escriba;
basta un codificador que proyecte el texto y las sondas del catálogo al mismo
espacio y los compare.

`TransformerSemanticProvider` hace exactamente eso, y toda su decisión cabe en
tres números por categoría:

| Magnitud | De dónde sale |
| --- | --- |
| Parecido positivo | Mejor coseno contra el enunciado y los ejemplos de la categoría |
| Contradicción | Mejor coseno contra sus contraejemplos; si gana, la categoría se descarta |
| Confianza | Interpolación lineal del parecido entre `SIMILARITY_FLOOR` y `SIMILARITY_CEILING` |

La confianza **no se normaliza entre candidatos**. Un softmax repartiría siempre
el total entre los presentes, de modo que un texto que no encaja en ninguna
categoría produciría igualmente una ganadora con confianza alta, y dos categorías
realmente empatadas dejarían de estarlo. Con la escala absoluta, «ninguna encaja»
sale como confianza baja —que el motor traduce a `UNKNOWN`— y un empate sigue
siendo un empate, que es lo que `SEMANTIC_AMBIGUITY_MARGIN` sabe leer.

Los niveles no cambian de modelo, cambian de profundidad: `FAST` compara contra
el enunciado de cada categoría, y `DEEP` añade cada ejemplo y cada contraejemplo.
Los contraejemplos entran sólo en `DEEP` a propósito: una contradicción es
concluyente para el motor de decisión, y emitirla desde el nivel barato cerraría
el análisis sin darle ocasión de escalar.

El servidor vive en `docker-compose.yml` bajo el **perfil `transformer`**, así que
no arranca con un `docker compose up` normal:

```bash
docker compose --profile transformer up -d transformer
```

Las variables del proveedor se declaran en el compose **sin valor por defecto**.
No es un descuido: cada adaptador tiene sus propios valores por omisión —un
modelo de OpenAI y un codificador de Hugging Face no son intercambiables— y una
cadena vacía no activa el valor por defecto del esquema, lo rompe. Definirlas en
`.env` es lo que las enciende.

```env
SEMANTIC_ANALYSIS_WORKER_ENABLED=true
SEMANTIC_ANALYSIS_PROVIDER=transformer
TRANSFORMER_BASE_URL=http://transformer:80   # nombre del servicio, no localhost
SEMANTIC_TRANSFORMER_MODEL=intfloat/multilingual-e5-small
SEMANTIC_TRANSFORMER_BATCH_SIZE=32
SEMANTIC_TRANSFORMER_QUERY_PREFIX="query: "
SEMANTIC_TRANSFORMER_PASSAGE_PREFIX="passage: "
SEMANTIC_TRANSFORMER_SIMILARITY_FLOOR=0.78
SEMANTIC_TRANSFORMER_SIMILARITY_CEILING=0.92
```

!!! warning "Los umbrales pertenecen al modelo, no al dominio"
    Son valores de coseno. Los de arriba están medidos sobre la familia e5, cuyos
    textos **sin relación alguna** rondan 0,70: por eso el suelo está en 0,78 y no
    en 0,5. Cambiar de modelo mueve la escala entera, así que hay que volver a
    medirlos contra un conjunto de evaluación en lugar de heredarlos. Los
    prefijos son igual de específicos: e5 se entrenó con `query:`/`passage:` y
    pierde precisión sin ellos; BGE y la mayoría los quieren **vacíos**.

`SEMANTIC_TRANSFORMER_BATCH_SIZE` debe ser menor o igual que el
`--max-client-batch-size` del servidor, que rechaza el lote entero al superarlo.
El adaptador traduce ese `413` a un mensaje que lo dice, porque de otro modo se
lee como «el texto era demasiado largo».

#### Lo que cuesta

Un codificador pequeño sobre CPU resuelve el lote entero de un análisis —el texto
más todas las sondas— en cientos de milisegundos, con **una sola llamada de red
por nivel**. Eso cambia tres cosas respecto del adaptador generativo:

- No hace falta tocar `SEMANTIC_ANALYSIS_LEASE_SECONDS` ni el presupuesto: el
  peor caso del proveedor es su propio timeout, un orden de magnitud por debajo
  del presupuesto de cualquier análisis. Por eso el clasificador no pasa por
  `assertProviderTimeoutFitsAnalysis`, que existe para el proveedor generativo,
  cuyo peor caso se multiplica por los intentos.
- `SEMANTIC_ANALYSIS_CANDIDATE_LIMIT` deja de ser el ajuste crítico: cada
  candidato añade sus sondas al lote, y el coste es lineal y barato. Cabe más
  recall que con un modelo generativo.
- El adaptador **no reintenta**. Ante un servidor propio no hay cuota ni
  congestión que justifique insistir, y la cola ya reintenta el trabajo entero.

Lo que se pierde con el cambio, dicho sin rodeos: el juicio sobre matices que el
catálogo no anticipó. Un codificador sólo sabe de parecido con lo que alguien
escribió en las sondas, así que una categoría con dos ejemplos pobres clasifica
peor de lo que lo haría un modelo generativo. **El remedio es el catálogo, no el
modelo** — y por eso los contraejemplos del árbol sembrado no son adorno: son lo
que separa «pago cuota préstamo vivienda» de «alquiler».

### Cómo probarlo sin ningún modelo

`SEMANTIC_ANALYSIS_PROVIDER` vacío deja el worker sin registrar y el catálogo lo
declara no disponible, así que la cadena entera —cola, lease, presupuesto,
clasificación, persistencia y portal— se queda sin forma de ejercitarse en un
puesto de trabajo: OpenAI cuesta dinero y manda el texto a un tercero, y el
clasificador de transformers exige levantar el servidor de inferencia y descargar
el modelo.

[`scripts/semantic-local-provider.mjs`](../../scripts/semantic-local-provider.mjs)
habla el mismo dialecto que el adaptador de OpenAI (`POST /v1/responses` con la
salida estructurada en `output_text`) pero **no es un modelo**: puntúa por
solapamiento de vocabulario entre el texto y cada categoría candidata, de forma
determinista. Sirve para comprobar el cableado; lo único que queda fuera de la
prueba es el juicio del modelo.

```bash
node scripts/semantic-local-provider.mjs           # deja este proceso vivo

# en el motor (API y worker):
SEMANTIC_ANALYSIS_WORKER_ENABLED=true
SEMANTIC_ANALYSIS_PROVIDER=openai
OPENAI_BASE_URL=http://host.docker.internal:4310/v1
OPENAI_API_KEY=proveedor-local-sin-credencial
SEMANTIC_FAST_MODEL=local-fast
SEMANTIC_DEEP_MODEL=local-deep

node scripts/smoke-semantic.mjs                    # recorre la cadena por HTTP
```

El smoke no falla si el worker está apagado: lo dice y termina. Apagado es una
configuración legítima, no un defecto.

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

## 11. Uso desde el motor de decisión

Los dos workers exponen además su núcleo al motor: un nodo `WORKER` del grafo puede
**llamarlos** durante una decisión y quedarse con lo que devuelven en variables intermedias.
Ese camino es síncrono y no pasa por la cola; el de este documento —encolar, reclamar,
reintentar— sigue siendo el de las conversiones que se piden por HTTP y que nadie está
esperando en línea. Conviven porque comparten el núcleo del worker, que no sabe de ninguno
de los dos.

Detalle en [Nodos que llaman a un servicio de worker](worker-service-nodes.md) y decisión en
[ADR-0028](../adr/ADR-0028-worker-service-nodes.md).
