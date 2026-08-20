## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:

- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

## Contratos de variables (§1–§4)

- Tipos canónicos y compatibilidad: `src/common/contracts/data-types.ts`.
- Restricciones configurables y su evaluación autoritativa:
  `src/common/contracts/constraint-engine.ts`. **Ninguna validación vive solo en el
  frontend**: el motor reevalúa siempre antes de ejecutar.
- Variables intermedias (`INTERMEDIATE`): tabla propia `decision_intermediate_variable`,
  ámbito por ejecución en `src/modules/graph/intermediate-scope.ts`, validación estática
  por dominancia en `validators/graph-intermediate.validator.ts`.
  Se referencian como `intermediate.<code>`; nunca cuelgan del catálogo global.
- Contrato de salida explícito: `decision_output_contract_field` +
  `validators/graph-output-contract.validator.ts`. La salida final no se infiere del
  último nodo.
- Manual: `docs/variable-contracts.md`. Decisiones: `docs/adr/ADR-0011-contract-extensions.md`.

## El circuito de la decisión: sujeto, crédito y desenlace

El motor sabía decidir y sabía gobernarse. No sabía **quién** tenía delante ni **si acertaba**,
y las dos cosas estaban conectadas: `subjectReference` era opcional, así que las tablas que ya
existían para medir el acierto (`decision_outcome_observation`, `decision_monitoring_attribute`,
desde `20260808140000_model_monitoring`) no tenían a quién atribuir nada y estaban vacías.

- **La exigencia de sujeto es una POLÍTICA, no un interruptor** —
  `src/modules/runtime/subject-policy.ts`. `REQUIRED` rechaza con 400
  `SUBJECT_REFERENCE_REQUIRED`; `WARN` ejecuta y cuenta la ausencia; `NOT_APPLICABLE` exige
  justificación escrita en la versión. Una versión puede ENDURECER la política de su ambiente,
  nunca relajarla: lo contrario sería una puerta trasera abierta por quien publica el artefacto
  y no por quien gobierna el ambiente. Se comprueba **antes** de resolver variables y de
  ejecutar, porque es el único punto donde el sistema todavía puede negarse a escribir evidencia
  irreparable — el HMAC es de una vía y el sujeto NO se puede añadir después.
- **La política viaja con el despliegue** (`ResolvedDeployment.subjectPolicy`), no se consulta
  aparte: es un dato del binding y una consulta más en el camino caliente se paga en cada
  decisión del día. Ojo con la caché de 60 s: `deserialize` exige `subjectPolicy` y `riskDomain`
  a propósito, porque una entrada escrita por la versión anterior del servicio no los lleva y
  serviría la exigencia como `undefined` justo después de cada despliegue.
- **Las ventanas de observación se materializan AL DECIDIR**
  (`src/modules/runtime/outcome-windows.ts`, 30/60/90/180/360 días, configurables por
  `OUTCOME_WINDOW_DAYS`). Es lo que le da DENOMINADOR a la cobertura: antes existía el numerador
  —las observaciones cargadas— y nada contra qué dividirlo, así que «este mes no falló ningún
  crédito» y «nadie cargó los desenlaces» se leían igual, cero filas. Sólo se programan para
  `riskDomain = CREDIT_ORIGINATION` y sólo con sujeto; una ventana que nadie puede cerrar llena
  la cola de trabajo imposible y hace que se ignore entera.
- **El sujeto se resuelve con `INSERT … ON CONFLICT`**, no con `prisma.upsert`
  (`execution-writer.service.ts`). El `upsert` son dos sentencias: dos decisiones simultáneas del
  mismo solicitante hacen que la perdedora reciba P2002 y **aborte la transacción**, tirando una
  decisión ya calculada por un choque de contabilidad.
- **`src/modules/outcome-ingestion/`** es la tubería que faltaba: alta de créditos
  (`POST /v1/outcomes/facilities`, que toma el sujeto de la decisión de origen y rechaza si no
  lo hay), carga de desenlaces por referencia de crédito con `dryRun` obligatorio en la interfaz,
  cola de ventanas vencidas y matriz de cosechas. El análisis agrupa por CRÉDITO y no por
  decisión: contando decisiones, quien más veces fue evaluado pesa más en la tasa de malos.
- **Observado ≠ inferido.** `inference_method` nulo significa observado. Un desenlace inferido
  sobre un rechazado (`reject inference`) mezclado con los observados calibra el modelo contra
  la población que ya se aprobó y lo hace parecer perfecto; se guardan juntos y se cuentan
  aparte.
- **`GET /v1/model-monitoring/coverage`** mide si el circuito está VIVO, y publica
  `atlas_subject_coverage_ratio` y `atlas_outcome_coverage_ratio`. Los ratios llegan con su
  denominador: un 100 % sobre tres decisiones no es una noticia.

## Vigilancia continua, y la métrica que vigila a la vigilancia

- **`MonitoringEvaluatorService`** (`JobName.MonitoringEvaluation`, cada 6 h) mide las versiones
  con despliegue **activo en un ambiente de producción**, guarda cada medición en
  `monitoring_evaluation` con su umbral y su veredicto, y publica
  `MONITORING_BREACH_DETECTED` por el outbox que ya alimenta `Notification`. Sólo producción: una
  alarma por la población de un sandbox enseña a ignorar el color.
- **`MONITORING_FRESHNESS_HOURS` se emite SIEMPRE**, incluso cuando no hay ninguna otra medición
  posible, y ahí está su razón de ser: es la única fila que puede aparecer en una versión sin
  datos. Una vigilancia detenida deja el tablero en verde enseñando la última foto buena, que es
  indistinguible de que todo vaya bien. Más de 48 h sin medir es `BREACH` por derecho propio.
- **Los umbrales viven en un solo sitio** (`monitoring-thresholds.ts`) con su justificación. Ojo a
  la DIRECCIÓN: en PSI y Hosmer-Lemeshow lo malo es un valor alto; en impacto adverso, AUC, KS y
  cobertura lo malo es un valor BAJO. Es el error fácil de este módulo.
- **Con muestra por debajo del mínimo el veredicto es `OK`, no `WATCH`.** Deliberado y discutible:
  un rojo sobre doce casos entrena a quien lo lee a ignorar el color. El tamaño de muestra viaja
  en la fila para que la pantalla pueda decir «sin datos suficientes» sin que sea una alarma.
- **`discrimination.ts` calcula el AUC por Mann-Whitney con rangos medios**, no integrando la
  curva: en crédito los puntajes son enteros y hay muchos empates, que la integración por
  trapecios reparte mal y devuelve un número optimista. Sin una de las dos clases devuelve `null`
  y no 0,5 — una cartera joven sin ningún malo no es un modelo que no distingue nada.

## Lo que hace que la vigilancia no sea decorativa

Cuatro piezas existían y no las llamaba nadie. Es la misma enfermedad que originó todo este
trabajo, una capa más adentro: capacidad construida, correcta y sin efecto.

- **`BaselineCaptureService` corre al PROMOVER**, desde `DeploymentService.deploy`, y no en un
  barrido posterior: un barrido tomaría la muestra ya contaminada con las primeras ejecuciones de
  la versión nueva, que es medir la deriva contra sí misma. Es best-effort — perder la línea base
  se arregla recapturándola; abortar un despliegue porque falló un histograma sería absurdo. Y
  `skipDuplicates` protege la referencia original: recapturar no puede pisarla.
- **`bucketOfValue` es UNA sola función** (`monitoring-analytics.ts`). Tuvo tres copias, y basta
  con que dos se separen para que el PSI compare dos alfabetos que no se solapan y salga altísimo
  siempre — una alarma permanente, que es la forma más rápida de que nadie mire.
- **`DecisionGuardService` se llama desde el camino de decisión.** Límites de exposición y licitud
  vigente ANTES de resolver variables; rango de las salidas económicas DESPUÉS de ejecutar,
  porque el valor lo produce un script y al compilar sólo existe la promesa. Ese segundo control
  no lanza: tirar una decisión ya calculada castigaría al solicitante por un defecto del
  artefacto. Deja constancia, y el gate de promoción es quien atajaba eso.
- **El gate económico bloquea al promover a PRODUCCIÓN**, no al compilar: en sandbox se
  experimenta, y exigir el contrato completo para probar una idea sólo conseguiría que se probara
  en producción. La salida legítima no es una casilla «saltar comprobación» sino declarar
  `decisionKind` de verdad — que queda en el esquema, en la auditoría y en la pantalla.
- **`GET /v1/model-monitoring/cutoff-analysis` y `/ab`** son las dos conversaciones que el negocio
  no podía tener. Las dos con intervalo de confianza: sin él, dos puntos porcentuales sobre
  cuarenta casos se leen como una diferencia. El A/B compara por DESENLACE y no por volumen —
  repartir 90/10 y concluir que el champion gana porque tiene nueve veces más decisiones es el
  error que un experimento existe para impedir.

## De cuándo era el dato (`freshness.ts`)

- `freshnessSlaSeconds` estaba en el esquema desde el primer día y **no se imponía en ninguna
  parte**. Ahora `FreshnessPolicy` por dependencia decide: `REJECT` (400 `VARIABLE_STALE`),
  `DEGRADE` (ejecuta, marca `decision_execution.degraded_inputs` y la fila de la variable) o
  `IGNORE`. `DEGRADE` por omisión: subir todo a `REJECT` de golpe rompería decisiones vivas.
- **Un dato SIN fecha declarada no se considera viejo**, y un `slaSeconds <= 0` tampoco impone
  nada. Las dos son decisiones de compatibilidad: la mayoría de integraciones no mandan
  `observedAt` todavía y tratarlas como infinitamente viejas convertiría el estreno del control
  en una caída general. Lo que sí queda es `age_seconds` nulo, y eso es medible.
- **Una fecha en el FUTURO se descarta.** Un reloj adelantado en el origen daría antigüedad
  negativa y con ella un dato eternamente fresco: justo el fallo que el control existe para
  impedir, y silencioso. Un minuto de tolerancia por desfase normal entre máquinas.

## Gobierno del riesgo (`src/modules/risk-governance/`)

Lo que condiciona una decisión sin tomarla. Cinco cosas y un rasgo común: son las que se saltan
cuando hay prisa.

- **`OutputSemanticRole` en el contrato de salida.** Que el rol sea declarado y no una convención
  de nombre permite validar el rango —una PD de 4,2 es un defecto, no un valor—, que la
  calibración sepa qué columna mirar, y que `reviewEconomicContract` exija PD a un artefacto de
  originación. El techo de `PRICED_RATE` en 10 no es una opinión sobre usura: distingue `0,28` de
  `28` mal escrito, que multiplica por cien el precio de una cartera.
- **Calibración ≠ discriminación**, y se confunden. Un modelo puede ordenar perfectamente y estar
  descalibrado por un factor de tres; mientras la decisión sea sí/no da igual, y en cuanto la PD
  entra en el precio el error se vuelve dinero que además cuadra. `CalibrationService` calcula
  sobre desenlaces **observados, nunca inferidos**, y guarda la curva decil a decil porque el
  Hosmer-Lemeshow dice que el ajuste es malo y no DÓNDE.
- **Los límites de cartera comparan el valor PROYECTADO**, no el actual. Comparar el actual deja
  pasar siempre la operación que rompe el límite —el saldo estaba por debajo justo antes de
  concederla—, que es lo que convierte un límite de concentración en decorativo. `enforced: false`
  mide y avisa sin rechazar: así se estrena un límite sin parar la originación el primer día.
- **`segment` usa la cadena vacía como «toda la cartera», nunca `NULL`.** Con nulos, cualquier
  lectura por clave del límite global genera `segment = NULL`, que en SQL no es cierto nunca: el
  `upsert` no encontraba la fila que sí existía y chocaba contra su propia clave única. Está
  corregido en `20260812020000_segment_sentinel_not_null`, con el porqué escrito ahí.
- **`SubjectConsent` distingue cuatro motivos de invalidez** (`MISSING`, `REVOKED`, `EXPIRED`,
  `NOT_YET_GRANTED`) en vez de devolver un booleano: quien atiende necesita saber si lo renueva,
  si tiene que pedirlo o si ya no puede volver a pedirlo igual. **La ausencia de constancia no es
  una autorización.**
- **Reidentificar cuesta dos personas.** `canApproveReidentification` rechaza que quien pide
  apruebe; sin esa regla, «dos autorizaciones» es la misma persona pulsando otro botón. Y el
  expediente del modelo rechaza que la validación independiente la firme quien creó la versión.
- **Vencer el expediente NO bloquea la ejecución.** Cortar el crédito de una financiera por un
  papel vencido es peor que el papel vencido: se marca, se ve, y no se puede ignorar en silencio.

## El triage de extractos: rechazar no es lo mismo que preguntar

Manual: [docs/workers/bank-statement-triage.md](docs/workers/bank-statement-triage.md).

El worker tenía UN desenlace para todo lo que no producía movimientos —`FAILED`—, así que al
querer derivar los casos ambiguos a una persona no había dónde separar el contrato que nadie
debió subir del extracto con el encabezado ilegible. Los dos caían en la misma cola, y una cola
de revisión con facturas dentro deja de revisarse: cuesta dinero, esconde los casos que sí
importan y hace imposible medir si el motor mejora.

- **Tres desenlaces, no dos** (`core/engine/document-triage.ts`): por encima de `accept` se
  procesa, en la franja intermedia se PREGUNTA (`PENDING_REVIEW`), y por debajo de `review` se
  RECHAZA (`PDF_INVALID`, terminal y **fuera de la cola**). Los tres umbrales se leen del
  entorno (`BANK_STATEMENT_DOCUMENT_*_CONFIDENCE`) porque son lo primero que hay que recalibrar
  con documentos reales. `normalizeThresholds` ordena el par: un `accept` por debajo del
  `review` dejaría la franja de duda VACÍA y todo dudoso se rechazaría en silencio.
- **Dos confianzas y no una.** `confidence` mide la EXTRACCIÓN, `document_type_confidence` la
  CLASIFICACIÓN. Colapsarlas hacía que «99 % de que es un extracto, 60 % de algunos
  movimientos» —revisión de extracción— y «2 % de que sea un extracto» —rechazo— se leyeran
  igual.
- **Estado y motivo son dos columnas.** El estado dice DÓNDE está el caso; el motivo, QUÉ hay
  que resolver. Con un solo campo habría que inventar un estado por causa y migrar el enum del
  ciclo de vida entero cada vez que aparece una nueva. Dos CHECK en la base lo sostienen: hay
  dos caminos que escriben aquí y sólo uno es el sospechoso habitual.
- **`statement-outcome.ts` es el único sitio donde se decide el desenlace.** Es una regla de
  negocio, no un detalle de ejecución: repartida en `catch` no había forma de responder «¿por
  qué acabó esto en la cola?» sin leer el worker entero. Y sin motivo declarado un código
  revisable FALLA en vez de encolarse: un pendiente mal clasificado no lo detecta nadie porque
  la lista sigue pintándose igual.
- **Un PDF ilegible se RECHAZA, no se encola.** Es la corrección menos obvia y la que más cola
  ahorra: mandarlo a revisión pone delante de una persona un archivo que tampoco ella puede
  abrir, y el trabajo que mueve el caso sólo puede hacerlo quien lo subió.
- **El documento se conserva mientras el caso está abierto.** La regla de privacidad —borrar el
  PDF al cerrar la ejecución— sigue intacta porque un caso en revisión NO está cerrado. Sin
  eso, la cola ofrecería «reprocesar» sobre una fila sin documento.
- **`PDF_INVALID` y `PENDING_REVIEW` entran en `statusMix` pero NO en la tasa de acierto.** Un
  rechazo es el worker acertando y un pendiente todavía no tiene desenlace; contarlos en el
  ratio castigaría al motor por acertar o afirmaría lo que no se sabe. Sin salir en el reparto,
  en cambio, un worker que derive el 40 % publicaba un 100 % de acierto sobre una cola
  creciendo.
- **`PDF_INVALID` es reintentable al volver a subir el archivo**, por lo mismo que `FAILED`: un
  rechazo es el veredicto del clasificador de ese día, y si no lo fuera ninguna recalibración
  alcanzaría jamás a los documentos que la motivaron.

## Campos calculados, librerías y QA Lab (§5–§10)

- `src/modules/calculated-fields/` — catálogo cerrado de operaciones visuales, guardián
  de código (máximo 3 líneas ejecutables) y contrato de retorno obligatorio.
- `src/modules/libraries/` — registro de librerías. Una fila solo puede HABILITAR un
  prelude ya presente en `library-preludes.ts`; nunca aportar código.
- `src/modules/qa-lab/` — generación masiva guiada por contrato, determinista por semilla,
  con reducción de contraejemplos. Faker y fast-check son dependencias de DESARROLLO y
  solo se usan en `test/`.
- Manual: `docs/calculated-fields.md`.

## Generador documental (`src/pdf-worker/`)

Plataforma documental interna: un artefacto entrega datos estructurados y recibe un PDF
maquetado. Manual: `docs/pdf-worker/README.md`; integración: `docs/pdf-worker/integracion.md`;
evidencia visual real: `docs/pdf-worker/evidencia/`.

- **No importa NADA de `common/` ni de `modules/`.** La única dependencia es la línea de
  `app.module.ts` que lo monta; `src/pdf-worker.ts` lo arranca como proceso suelto y el
  `Dockerfile` tiene una etapa `pdf-worker` propia (Chromium pesa ~450 MiB y no debe entrar en
  la imagen de la API). Lo verifica `test/pdf-architecture.spec.ts`, que también fija que sólo
  el adaptador de renderizado importa Playwright y sólo el de plantillas importa Handlebars.
- **Su entorno NO pasa por `validateEnvironment`.** `envSchema` es un `z.object` y descarta las
  claves que no declara: todas las `PDF_*` sobrevivirían a la validación y desaparecerían del
  `ConfigService`. Las valida `pdf-worker/infrastructure/config/pdf-worker.env.ts` leyendo
  `process.env`, que es además lo que permite arrancarlo sin el motor.
- **Añadir un documento es una carpeta y una línea** en `templates/template-catalog.ts`. El
  motor central no cambia. Una versión nueva es una carpeta nueva: registrar dos veces
  `id@version` falla, porque un informe archivado declara con qué template salió.
- **Nunca declare `@page { margin }` en un CSS de plantilla.** En Chromium el margen del CSS
  gana sobre el de la API, el cuerpo pasa a ocupar la hoja entera y el membrete y el pie se
  pintan encima del texto. No lo detecta ninguna prueba —el HTML es correcto y el PDF tiene su
  firma, su tamaño y sus páginas—; se ve abriendo el documento, y por eso existe
  `yarn pdf:evidencia`.
- `yarn pdf:preview <templateId>` para iterar una maqueta sin levantar el motor.
  `yarn pdf:visual:baseline` compara la huella del HTML compuesto (cubre plantillas, parciales,
  estilos y marca; NO cubre que otra versión de Chromium pagine distinto).
