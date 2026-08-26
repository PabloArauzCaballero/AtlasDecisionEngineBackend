# Fraude documental: ¿es un carnet AUTÉNTICO?

El worker de identidad sabía contestar dos preguntas y le faltaba la tercera.

| Pregunta | Quién la contesta | Desde |
| --- | --- | --- |
| ¿Hay un documento de identidad delante? | `core/engine/identity-evidence.ts` | la puerta de documentos |
| ¿Cuál es? | `HeuristicDocumentClassifierAdapter` | siempre |
| **¿Es AUTÉNTICO?** | `core/forensics/` | **esto** |

La tercera es la única que separa el fraude, y es la que las dos primeras aprueban con holgura:
**el texto de una falsificación es el de un documento auténtico, porque se copió de uno**. Una
cédula descargada de internet, impresa y fotografiada contiene «CÉDULA DE IDENTIDAD», lleva un
retrato y tiene la proporción de una tarjeta. La puerta de evidencia la deja pasar, el clasificador
la nombra BOLIVIA_CI, y hasta ahora eso bastaba para llegar a la comparación biométrica y salir
VERIFICADA.

## Las tres pruebas

Ninguna decide sola. Se funden en `identity-fraud.scorer.ts` y se cortan por dos umbrales, igual que
la puerta de documentos: rechazar y preguntar no son lo mismo, y hacen falta dos fronteras para
poder distinguirlos.

### 1. La plantilla del catálogo — `template-conformance.ts`

Contrasta lo leído con **cómo debería verse un carnet boliviano**, escrito como dato en
`core/catalog/bolivia-ci.catalog.ts`: los rótulos que el SEGIP imprime, en qué cara van, el formato
del número, los departamentos de expedición y la MRZ TD1 del reverso. Las fuentes de cada dato están
anotadas una a una en la constante `FUENTES` del propio catálogo.

**Las dos generaciones conviven y las dos son válidas.** El DS 4924 (1 de noviembre de 2023)
rediseñó la tarjeta y le añadió MRZ; las anteriores siguen vigentes hasta caducar. La conformidad se
mide contra CADA plantilla y se queda con la mejor: exigir la plantilla nueva a una cédula legítima
de 2021 la declararía falsa, que es el peor error posible de este módulo — un falso positivo aquí le
cierra el producto a alguien que no hizo nada mal y no tiene forma de arreglarlo.

Además busca **incoherencias**, que son la parte que un falsificador no puede arreglar mirando la
tarjeta: la MRZ que valida su dígito de control y aun así no coincide con el anverso, la caducidad
anterior al nacimiento, una vigencia de setenta años, un lugar de nacimiento que no está en Bolivia.
Nada de esto se ve mirando; todo se comprueba calculando.

Y **marcas de falsificación** literales: `SPECIMEN`, texto de relleno de una plantilla, la marca de
agua de un banco de imágenes. Éstas no suman con las demás — son el propio documento declarando que
no es un documento — y por sí solas cruzan el umbral alto.

### 2. El clasificador por transformers — `identity-semantic.classifier.ts`

Los anclajes del catálogo buscan literales, y eso es exacto y frágil a la vez: el reconocedor
devuelve `SERVIClO GENFRAL` sobre una tarjeta legítima y el anclaje falla, mientras que un
falsificador que copie el rótulo letra a letra lo pasa. **La parte fácil de falsificar es justo la
que la expresión regular mide bien.**

El codificador mide otra cosa: si el CONJUNTO del texto se parece a cómo se lee una cédula boliviana
—y si se parece MÁS a eso que a un pasaporte, a una licencia, a un documento de otro país o a una
plantilla de internet—. Reutiliza el mismo `TransformerEmbeddingProvider` que el worker semántico
(el servidor TEI de `TRANSFORMER_BASE_URL`), con las doce sondas del catálogo cacheadas: el coste
por verificación es **un** vector.

El número que hace el trabajo es el **margen** entre la mejor sonda positiva y la mejor negativa.
Todos los documentos oficiales se parecen entre sí, así que un coseno alto contra «cédula boliviana»
no dice nada si el coseno contra «documento de otro país sudamericano» es igual de alto.

Es un CODIFICADOR y no un modelo generativo: mide, no obedece. El texto analizado lo eligió quien
sube la foto —basta imprimir una frase en una tarjeta— y con un modelo generativo eso sería un canal
de instrucciones dentro del dato.

### 3. La física de la imagen — `image-tamper.analyzer.ts`

El fraude más barato que existe consiste en **no tener la tarjeta**: se descarga la foto de una
cédula ajena, se abre en una pantalla y se fotografía. El texto es impecable. Lo que cambia son los
píxeles:

| Señal | Qué mide | Peso |
| --- | --- | --- |
| `SCREEN_REPHOTOGRAPH_SUSPECTED` | Periodicidad de período corto: la rejilla de un panel LCD | 0,35 |
| `RECOMPRESSION_PATCHWORK` / `_RESIDUAL_OUTLIER` | Bloques con otro historial de cuantización | 0,25 |
| `NOISE_DISCONTINUITY` | Dos regímenes de grano de sensor en una superficie plana | 0,25 |
| `UNIFORM_DARK_BORDER` | El marco negro de otro dispositivo o del visor | 0,20 |

**Los cortes NO están calibrados contra fotos reales de cédulas reales**, y no lo estarán en este
repositorio: una cédula de verdad es el dato con el que se suplanta a una persona. Están medidos
contra la cédula sintética de `fixtures/` y contra imágenes que no son documentos. Con esa
incertidumbre, los pesos están puestos para que la recompresión sola **no llegue** al umbral de
revisión (0,3) —tiene una explicación inocente frecuentísima: la aplicación de mensajería por la que
mucha gente se manda su propia foto— y para que **ninguna** señal de píxeles alcance sola el umbral
de sospecha (0,6).

Sobre una entrada FABRICADA por el catálogo de escenarios, este análisis **no se ejecuta**: una
tarjeta que dibujamos no pasó por ningún sensor, así que medirle la física no mide manipulación
—mide que es sintética, cosa que ya sabemos— y convertiría cada prueba en una sospecha.

## Dónde están puestos los cortes, y por qué ahí

Medido con `yarn ts-node scripts/medir-fraude-identidad.ts` sobre los nueve escenarios del catálogo,
el 26 de agosto de 2026, con el codificador declarado ausente (las dos familias deterministas):

| escenario | cobertura | generación | riesgo | veredicto |
| --- | --- | --- | --- | --- |
| `identidad-aprobada` | 0,953 | PRE_2023 | 0,25 | CLEAR |
| `identidad-revision` | 0,953 | PRE_2023 | 0,25 | CLEAR |
| `identidad-rechazada` | 0,953 | PRE_2023 | 0,25 | CLEAR |
| `identidad-caducada` | 0,953 | PRE_2023 | 0,25 | CLEAR |
| `identidad-sin-retrato` | 0,953 | PRE_2023 | 0,00 | CLEAR |
| `identidad-sobre-escritorio` | 0,953 | PRE_2023 | 0,00 | CLEAR |
| `identidad-ilegible` | 1,000 | DS_4924_2023 | 0,25 | CLEAR |
| **`imagen-cualquiera`** | **0,000** | — | **0,73** | REVIEW\* |
| **`identidad-foto-mala`** | **0,000** | — | **0,73** | REVIEW\* |

\* Toparía en `FRAUD_SUSPECTED` de no ser una entrada fabricada por el catálogo; ver más arriba.

Lo que importa de esta tabla no es ninguna fila: es el **hueco**. Todo lo que es una cédula cae en
`[0,00 · 0,25]` y todo lo que no lo es cae en `0,73`. Los dos cortes —0,3 y 0,6— están puestos
dentro de ese hueco y no pegados a ninguno de los dos lados, que es la única posición que sobrevive
a que la población se mueva un poco.

Tres lecturas más que esta tabla deja claras:

- **Un documento CADUCADO o RECHAZADO puntúa igual que uno aprobado.** Correcto: la autenticidad y
  la vigencia son preguntas distintas, y quien decide la segunda es el motor de decisión. Que este
  análisis las confundiera haría que un carnet legítimo vencido se leyera como falsificado.
- **La cédula fotografiada sobre un escritorio da riesgo 0.** Es el escenario con más ruido de fondo
  del catálogo, y aun así el recorte previo deja al analizador viendo la tarjeta.
- **La cédula ilegible cubre la plantilla ENTERA.** No es un fallo: su reverso se lee perfectamente
  y lo que está borroso es el anverso. Lo que decide sobre ella no es este análisis sino la lectura
  de campos, que es la que sabe que faltan el número y el nombre.

**Esta medición NO calibra el análisis de píxeles.** Los escenarios son imágenes que dibujamos, así
que sobre ellos ese análisis ni siquiera se ejecuta en el pipeline. Lo que la tabla demuestra es que
la conformidad con el catálogo separa limpio, y que los cortes no están puestos a ojo.

## Los tres desenlaces

- **`CLEAR`** — se comporta como una cédula auténtica.
- **`REVIEW`** — hay algo y no basta. Va a una persona, con la lista de qué saltó. Es el desenlace
  por omisión de todo lo que el fusor no sepa clasificar.
- **`FRAUD_SUSPECTED`** — la evidencia se acumuló por encima del umbral alto. **Nunca es un rechazo
  automático**: acusar a alguien de falsificar un documento es una decisión con consecuencias
  legales y la firma una persona. Lo que este veredicto garantiza es que el caso no puede terminar
  en aprobación automática, y que llega a la cola con prioridad 10 y SLA de 60 minutos en vez de
  50/240.

El veredicto entra al `IdentityDecisionEngine` por la misma puerta que `MULTIPLE_FACES`: escala un
`VERIFIED` a `REVIEW_REQUIRED` y **nunca suaviza un rechazo** — que el carnet sea legítimo no
convierte en la misma persona a las dos caras que se compararon.

## Una prueba que FALTA no es una prueba superada

Es la regla que gobierna `IDENTITY_FRAUD_STRICT`. Si el servidor de embeddings no contestó, o si el
análisis de píxeles no pudo correr, el documento no queda «sin señales negativas»: queda **sin
medir**. En estricto eso escala a revisión humana.

Sin esa regla, el flujo sigue funcionando, los casos siguen saliendo VERIFICADOS y lo único que ha
pasado es que el servidor de embeddings lleva tres días caído y desde entonces nadie comprueba nada.
El esquema de entorno **lo exige en producción** por eso mismo.

## Configuración

| Variable | Por omisión | Qué mueve |
| --- | --- | --- |
| `IDENTITY_FRAUD_DETECTION_ENABLED` | `true` | Apagarlo deja el worker como estaba. Obligatorio en producción. |
| `IDENTITY_FRAUD_STRICT` | `false` | Una prueba ausente escala el caso. **Obligatorio en producción.** |
| `IDENTITY_FRAUD_TEMPLATE_COVERAGE_MIN` | `0.55` | Cobertura mínima de la plantilla del catálogo. |
| `IDENTITY_FRAUD_REVIEW_RISK` | `0.3` | A partir de aquí, a una persona. |
| `IDENTITY_FRAUD_SUSPICION_RISK` | `0.6` | A partir de aquí, sospecha de fraude. |
| `IDENTITY_FRAUD_SEMANTIC_FLOOR` | `0.8` | Suelo de coseno. **Propiedad del modelo servido**: al cambiar de familia hay que volver a medirlo. |
| `IDENTITY_FRAUD_SEMANTIC_MARGIN` | `0.015` | Margen mínimo sobre los contraejemplos. |

El codificador se toma de la configuración del worker semántico (`TRANSFORMER_BASE_URL`,
`SEMANTIC_TRANSFORMER_MODEL`, prefijos y reintentos): es el mismo servidor y no tiene sentido
mantener dos.

## Qué sale al resultado

`IdentityVerificationOutcome.fraud` lleva el veredicto, el riesgo, los motivos, **las pruebas que no
se pudieron ejecutar** y el desglose por familia. Es lo que convierte «sospecha de fraude» en algo
revisable: quien abre el caso tiene que poder ver QUÉ saltó, porque su trabajo es contradecir a la
máquina cuando la máquina se equivoca, y un número suelto no se puede contradecir.

Al artefacto suben sólo dos escalares —`result.fraudVerdict` y `result.fraudRisk`—. El desglose se
queda en `result_json` de la ejecución del worker, que es donde el portal lo lee: publicarlo como
variable lo metería en la traza de la ejecución, que se conserva años.

## Dónde se mira

- Motor: `src/modules/workers/identity-verification/core/catalog/` y `core/forensics/`.
- Pruebas: [`test/identity-fraud-forensics.spec.ts`](../../test/identity-fraud-forensics.spec.ts)
  (política completa, sin imágenes y sin red) y `test/identity-verification-pipeline.spec.ts`
  (los escenarios del catálogo, de punta a punta).
- Artefacto: `src/modules/seeding/data/identity-mobile.graph.ts`, versión 1.2.0.
- Pantalla de revisión: `AtlasDecisionEngineFrontend`, `ManualReviewDetailPage` y `CaseImagesPanel`.
