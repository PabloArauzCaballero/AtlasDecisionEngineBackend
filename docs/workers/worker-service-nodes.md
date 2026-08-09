# Nodos que llaman a un servicio de worker

Un algoritmo de decisión puede **llamar** a los servicios de los workers absorbidos
([ADR-0026](../adr/ADR-0026-additional-workers-integration.md)) y quedarse con lo que
devuelven en forma de variables. La llamada es una acción más del algoritmo, como calcular
un campo o ejecutar un sub-árbol: el nodo invoca el servicio durante la decisión, espera la
respuesta y la guarda en **variables intermedias** que a partir de ahí razona el motor.

Lo que un nodo `WORKER` **no** hace es escribir en el contrato de salida. Todo lo que trae
un servicio entra al motor por la puerta de las variables, con su tipo declarado, su
autorización de escritura y su política de traza. Publicarlo al consumidor exige, como
siempre, un campo del contrato de salida que lo mapee explícitamente.

## Servicios disponibles

| Servicio            | Operación   | Argumentos                       | Respuesta                                                             |
| ------------------- | ----------- | -------------------------------- | --------------------------------------------------------------------- |
| `bank-statement`    | `normalize` | `documentBase64`, `fileName`     | Contrato normalizado del extracto (`NormalizedBankStatement`)          |
| `semantic-analysis` | `classify`  | `text`                           | `status`, `categoryCode`, `confidence`, `entities`, `matches`, …       |

El catálogo es cerrado y se comprueba **al validar el grafo**: un nodo que nombra un
servicio u operación inexistente impide aprobar el artefacto, en vez de abortar la primera
decisión que lo alcance. El catálogo vive en
[graph-worker.validator.ts](../../src/modules/graph/validators/graph-worker.validator.ts)
(`WORKER_SERVICE_OPERATIONS`) y la ejecución real en
[worker-service-invoker.service.ts](../../src/modules/workers/worker-service-invoker.service.ts).

Un servicio sólo se puede invocar si el despliegue lo declara disponible, con la **misma
bandera** que publica el catálogo `GET /v1/workers` (`BANK_STATEMENT_WORKER_ENABLED`,
`SEMANTIC_ANALYSIS_WORKER_ENABLED` + `SEMANTIC_ANALYSIS_PROVIDER`). Si la interfaz dice que
la capacidad no está, un algoritmo tampoco puede usarla por detrás. La bandera gobierna la
capacidad, no el proceso: una réplica de API con el trabajo de fondo apagado
(`WORKER_ROLE=api`) sigue atendiendo estas llamadas.

## Configuración del nodo

```jsonc
{
  "service": "bank-statement",
  "operation": "normalize",
  "arguments": {
    "documentBase64": { "source": "VARIABLE", "path": "extracto_pdf_base64" },
    "fileName": { "source": "LITERAL", "value": "extracto.pdf" }
  },
  "onError": "CONTINUE",
  "timeoutMs": 30000,
  "outputs": [
    { "intermediateCode": "ext_estado_llamada", "path": "call.status", "defaultValue": "FAILED" },
    { "intermediateCode": "ext_total_creditos", "path": "result.totals.credit", "defaultValue": 0 },
    { "intermediateCode": "ext_movimientos", "path": "result.transactions.length", "defaultValue": 0 }
  ]
}
```

### `arguments`

Cada argumento declara de dónde sale su valor, con los mismos orígenes que ya usan las
asignaciones de intermedias y las entradas de un campo calculado:

| `source`       | Qué lee                                                     |
| -------------- | ------------------------------------------------------------ |
| `VARIABLE`     | Una variable del contrato de entrada (`path`)                 |
| `INTERMEDIATE` | Una variable intermedia por su código (`path`, sin prefijo)   |
| `LITERAL`      | El `value` tal cual                                           |
| `EXPRESSION`   | El resultado de evaluar `expression`                          |
| `TEMPLATE`     | `value` con las plantillas `{{ … }}` renderizadas             |

El validador comprueba que un argumento `VARIABLE` nombre una **entrada declarada** del
artefacto, y que un argumento `INTERMEDIATE` lea una intermedia cuyo productor domine a
este nodo en el grafo.

### `outputs`

Cada proyección lleva un trozo de la respuesta a una variable intermedia declarada por el
grafo, cuyo `producerNodeKey` debe ser este nodo.

Las rutas se resuelven sobre un sobre de dos raíces:

- `result.*` — la respuesta del servicio. Las rutas son propiedades normales, así que
  `result.transactions.length` cuenta los movimientos sin necesidad de una operación
  especial.
- `call.*` — metadatos de la llamada: `status`
  (`SUCCEEDED` | `SUCCEEDED_WITH_WARNINGS` | `FAILED`), `errorCode`, `durationMs` y
  `warningCount`.

Están separados a propósito: un servicio que devuelva su propio campo `status` no puede
tapar el estado real de la llamada, que suele ser justo el dato del que cuelga la rama de
contingencia.

Con `source: "EXPRESSION"` la proyección puede combinar la respuesta con el resto del
contexto del grafo (`{ "op": "div", "left": { "var": "result.totals.credit" }, "right": { "var": "cuota" } }`).

`defaultValue` se usa cuando la ruta no resuelve o vale `null`.

### `onError`

| Valor      | Comportamiento                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------------ |
| `FAIL`     | Un fallo del servicio aborta la decisión y la propaga como error de la petición. Es el valor por defecto. |
| `CONTINUE` | Se escriben los valores por defecto declarados y el grafo sigue. `call.status` vale `FAILED` y `call.errorCode` trae el código, para que una rama pueda desviarse explícitamente. |

Con `CONTINUE`, el validador **exige** `defaultValue` en todas las proyecciones: un nodo
que promete continuar sin decir con qué valores dejaría la primera lectura posterior
reventando por un motivo que ya no menciona al servicio. También emite el aviso
`WORKER_CALL_CONTINUES_ON_ERROR` para que la revisión compruebe que las ramas posteriores
contemplan el caso.

## Traza y observabilidad

- Cada llamada queda en la evaluación del nodo (`evaluation.worker`), que se persiste en
  `decision_execution_step.evaluation_result_json`: servicio, operación, estado, duración,
  avisos, intermedias escritas y, si falló, el código de error. Nunca la respuesta cruda.
- El resultado del motor expone además `workerCalls`, con la misma información en orden.
- Métricas: `atlas_worker_node_calls_total{service,operation,outcome}` y
  `atlas_worker_node_call_duration_ms{service,operation}`.

## Consideraciones

- **La llamada está dentro de la decisión.** Convertir un PDF o clasificar un texto es
  trabajo real, y su duración se suma a la latencia de la petición. Por eso el nodo puede
  declarar `timeoutMs`, que el invocador recorta al máximo configurado del servicio
  (`BANK_STATEMENT_TIMEOUT_MS`, con un techo absoluto de 120 s).
- **Una decisión con nodos `WORKER` no es reproducible por sí sola.** Reejecutar el mismo
  artefacto con la misma entrada vuelve a llamar al servicio, y su respuesta puede cambiar
  (otra versión del analizador, otro modelo). La evidencia de lo que se decidió está en la
  ejecución persistida, no en la posibilidad de repetirla.
- **El documento no se conserva.** El extracto viaja como variable de entrada marcada
  `sensitive`, así que el motor guarda su HMAC y no su contenido, y la traza de cada nodo
  lo publica como nulo. La validación que se le aplica es la misma que a una subida por
  HTTP: tamaño, firma real del contenido y nombre seguro.
- **Los workers siguen teniendo su cola.** Las conversiones que se piden por HTTP y que
  nadie está esperando en línea siguen pasando por `POST /v1/workers/…`, con su fila, su
  reclamo atómico y sus reintentos. Ambos usos conviven porque comparten el núcleo del
  worker, que no sabe de ninguno de los dos.

## Demo ejecutable

`EXTRACTO_CAPACIDAD_PAGO` — «Capacidad de pago verificada por extracto bancario». Se siembra
con el resto de datos de demostración y queda activo en DEV.

```txt
START → ANALIZAR_EXTRACTO (WORKER) → DERIVAR_CAPACIDAD → EVALUAR → 4 resultados
```

- El grafo puro está en
  [`statement-worker-demo.graph.ts`](../../src/modules/seeding/data/statement-worker-demo.graph.ts)
  y su siembra en
  [`statement-worker-demo.seed.ts`](../../src/modules/seeding/data/statement-worker-demo.seed.ts).
- `test/statement-worker-demo-seed.spec.ts` lo ejecuta contra el motor real y comprueba las
  cuatro ramas.

## Pruebas

| Prueba                                     | Qué cubre                                                                     |
| ------------------------------------------ | ------------------------------------------------------------------------------ |
| `test/worker-node.spec.ts`                 | Mecánica del nodo en el motor: argumentos, proyecciones, `onError`, traza        |
| `test/graph-worker-validator.spec.ts`      | Reglas estáticas del nodo                                                       |
| `test/worker-service-invoker.spec.ts`      | Guardas del invocador: qué rechaza antes de gastar una conversión               |
| `test/statement-worker-demo-seed.spec.ts`  | El demo sembrado, ejecutado con el motor real                                   |
| `test/e2e/worker-service-nodes.e2e-spec.ts`| Autoría, validación, gobierno, despliegue y decisión por HTTP con un PDF real   |

Dos avisos al ejecutarlas:

- Van con `yarn test` / `yarn test:e2e`, no con `npx jest` a pelo. El lanzador del
  repositorio añade `--experimental-vm-modules`, que `pdfjs-dist` necesita; sin él toda
  lectura de PDF falla con `PDF_EXTRACTION_FAILED`, que parece un fallo del motor y no lo es.
- El e2e encola una corrida de pruebas. Un worker de fondo ya en marcha con una imagen
  **anterior** a esta capacidad puede reclamarla y ejecutarla con un motor que no conoce el
  nodo `WORKER`: el nodo no escribe nada y el caso falla sin decir por qué. Reconstruya la
  imagen o pare ese worker mientras corre el e2e.
- En la suite unitaria sólo `bank-statement-fixtures.spec.ts` lee PDF. Dos suites del mismo
  proceso consumiendo `pdfjs-dist` —ESM puro, evaluado en la VM de módulos de Jest— se
  pisan, y la segunda falla con `PDF_EXTRACTION_FAILED` de forma intermitente. La conversión
  desde un nodo se cubre en el e2e, que corre en su propio proceso.

Para tomar una decisión de verdad con un extracto en PDF:

```bash
BANK_STATEMENT_WORKER_ENABLED=true \
npx ts-node --transpile-only prisma/dev-seeds/seed-statement-worker-decision.ts \
  --pdf prisma/fixtures/extracto-qa-bank.pdf --cuota 3500
```

El script levanta el contexto real de la aplicación, siembra el artefacto si falta y
ejecuta la decisión por el mismo camino que una petición HTTP —resolución de variables,
motor, llamada real al servicio de extractos, persistencia y auditoría—, imprimiendo
después la llamada tal como quedó registrada en la traza.
