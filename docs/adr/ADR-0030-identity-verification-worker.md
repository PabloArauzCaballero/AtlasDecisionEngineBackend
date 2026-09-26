# ADR-0030: Integración del worker de verificación de identidad

## Estado

Aceptado — 2026-08-09

## Contexto

Llega un tercer worker como repositorio independiente,
`identity-verification-worker-nestjs` (v1.1 «hardened r2»), con el mismo encargo
que los dos de [ADR-0026](./ADR-0026-additional-workers-integration.md):
absorberlo como capacidad adicional del producto sin reemplazar ni romper lo
existente.

Compara la foto de un documento de identidad con una selfie y decide si son la
misma persona. Su valor está en el núcleo, no en la infraestructura:

- `IdentityDecisionEngine` — dominio puro, sin decoradores, sin E/S y sin reloj
  propio. Ordena rechazos incondicionales, señales de revisión y comparación
  biométrica de modo que un no-parecido claro siga siendo rechazo aunque haya
  avisos de calidad.
- `BoliviaCiDocumentParser` — lee la cédula boliviana por sus anclajes reales
  (`No <número>`, `A: <nombre>`, `Nacido el`, `Válida hasta`), distingue el
  número de la cédula del número de control de impresión y normaliza fechas
  escritas con letra.
- Medida de calidad de imagen, umbrales acoplados y catálogo de errores con
  categoría (`VALIDATION`, `PROVIDER_UNAVAILABLE`, `TRANSIENT`…).

Y trae, como el worker A de ADR-0026, infraestructura propia que el motor ya
tiene: pg-boss, Sequelize con seis migraciones, almacén de objetos (sistema de
archivos o S3), su propio esquema de entorno, su propio trazador y su propio
registro de métricas.

## Fuerzas y restricciones

- Lo prohibido sigue siendo lo mismo: duplicar infraestructura, un segundo
  sistema de seguimiento de jobs, otra tecnología de colas, otro ORM.
- El núcleo funcional no se reescribe: se adaptan los bordes.
- El worker debe quedar independiente de los otros dos: tabla propia, cola
  propia, configuración propia, pruebas propias.
- El motor no tiene proveedor biométrico ni credenciales de AWS.
- **Este worker decide sobre la identidad de una persona.** Un umbral inventado
  no es un detalle de configuración: es una calibración que nadie firmó.

## Decisión

### El protocolo de captura se colapsa a una ejecución

El paquete original expone un recurso REST de varios pasos —crear verificación,
subir documento, subir selfie— encadenado con cuatro trabajos de pg-boss y
puntos de control entre ellos. Esa forma existe porque su cliente es una captura
móvil: la persona fotografía el documento y la selfie llega minutos después.

Aquí las dos imágenes llegan **juntas** en una sola petición, así que el estado
intermedio no lo puede observar nadie: encadenar cuatro trabajos añadiría tres
viajes a la base y tres estados que ninguna pantalla enseña. Se conserva íntegro
el ORDEN y el contenido de cada etapa —normalizar, medir, OCR, clasificar,
analizar, recortar el rostro, prueba de vida, comparar, decidir— en
`IdentityPipelineService`, y el motor de decisión que las cierra.

Consecuencia aceptada: la máquina de estados de `IdentityVerification` (catorce
estados, con transiciones y plazos de captura) **no se absorbe**. Describe un
protocolo que esta integración no ofrece. Volver a ofrecerlo es añadir etapas al
pipeline, no recuperar la entidad.

### Una tabla, con el mismo ciclo de vida que los otros dos workers

`decision_identity_verification_run`, con RLS forzada y la misma forma de
ejecución (estado, progreso, lease, intentos, correlación, portador de traza).
Las imágenes viven en columnas `Bytes` y **se borran en la misma actualización
que cierra la ejecución**, igual que el PDF del worker de extractos: lo que se
conserva es la decisión y su evidencia, no la cara ni la cédula de nadie.

El número de documento se enmascara **en el motor**, al construir el resultado,
no al pintarlo: la fila se lee desde más sitios que la pantalla.

### Un veredicto negativo no es una ejecución fallida

`NOT_VERIFIED` termina como `SUCCEEDED_WITH_WARNINGS`. El worker hizo su
trabajo; marcarlo `FAILED` confundiría «el rostro no coincide» con «el proveedor
se cayó» en el panel de incidencias, que son dos cosas que se atienden distinto.
`FAILED` queda para los fallos del pipeline.

### Los umbrales no tienen valor por omisión

`IDENTITY_MATCH_THRESHOLD` e `IDENTITY_REVIEW_THRESHOLD` son opcionales y
acoplados: o están los dos o no está ninguno. Sin ellos el motor de decisión
devuelve `REVIEW_REQUIRED` con `THRESHOLD_PROFILE_MISSING`.

Es la decisión del paquete original y se conserva tal cual. Un umbral por
omisión decidiría sobre la identidad de una persona con una cifra que nadie midió
contra un corpus etiquetado, y lo haría en silencio. Que haya que declararlos
—junto al nombre del perfil del que salieron— convierte esa calibración en algo
que alguien firmó. El catálogo publica `limits.thresholdProfile` para que la
pantalla lo pueda avisar **antes** de que alguien mande una foto.

### La lectura y la biometría son REALES, locales y sin red

Al principio los dos eran simulados, y eso escondía un agujero: el OCR devolvía
siempre la misma cédula boliviana pasara lo que pasara en la imagen, así que una
**foto cualquiera terminaba VERIFICADA**. El pipeline funcionaba y la
comprobación no comprobaba nada.

La lectura pasa a ser real y local: Tesseract sobre WebAssembly
(`TesseractOcrAdapter`), con los datos del idioma como paquete de npm
(`@tesseract.js-data/spa`). Sin credenciales, sin CDN y **sin abrir una sola
conexión de red** — que es lo que corresponde a un proceso que maneja la cédula
de una persona. Medido: una tarjeta legible tarda ~700 ms con confianza 95; una
imagen sin letras, ~90 ms y cadena vacía.

Eso es lo que convierte «¿esto es un documento?» en una pregunta contestable, y
lo que hace posible la regla de la sección siguiente.

La **biometría** también es real, y por la misma vía. Estuvo simulada un tiempo
—los adaptadores de AWS del paquete original exigen tres SDK y credenciales que
este despliegue no tiene— y mientras lo estuvo, un «VERIFICADO» sólo podía
afirmar que se había leído un documento válido: el comparador devolvía un
parecido fijo elegido por el nombre del escenario.

Hoy la sirve `@vladmandic/human` sobre WebAssembly, en este mismo proceso:
detección (`blazeface`), malla facial, **descriptor de 1024 dimensiones**
(`faceres`) para comparar 1:1, `antispoof` y `liveness`. Las cinco redes vienen
dentro del paquete —10,4 MB de pesos— y se leen del disco. Igual que la lectura:
sin credenciales, **sin red** y sin coste por verificación, que es lo que permite
desplegarlo igual en una máquina de desarrollo y en el servidor.

Tres detalles del arranque (`core/adapters/human-runtime.ts`) que no son
opcionales:

- El binario de WebAssembly se lee del disco. Por omisión Human apunta a un CDN,
  y un worker que descarga su motor al arrancar falla justo cuando la red del
  despliegue está cerrada, que es como debe estar.
- Los modelos también, con un lector propio registrado en tfjs bajo `disco://`:
  el `fetch` de Node **no admite `file://`**, y sin ese lector los pesos no cargan
  y `detect()` devuelve cero rostros sin decir por qué. Por eso el arranque falla
  si no carga los cinco: un motor a medias no da error, da «no había nadie en la
  foto».
- No se usa `@tensorflow/tfjs-node`: exige compilar un binario nativo que no se
  construye en esta máquina ni en una imagen sin cadena de compilación. El
  backend WASM se comporta igual en Windows y dentro del contenedor.

El parecido se mide como **coseno sobre el descriptor**, no con la función de
parecido que trae Human: aquélla redondea a dos decimales y aplasta justo el
tramo que decide. Medido, dos personas distintas daban 0,99 y la misma persona
1,00; el coseno separa esos mismos casos en 0,88 y 0,94.

El catálogo sigue publicando quién decidió cada cosa (`limits.ocrProvider`,
`limits.faceProvider`, `limits.livenessProvider`). Mientras la comparación estuvo
simulada, esa línea era lo único que impedía leer el veredicto como una
verificación completa; ahora hace falta por lo contrario: para poder demostrar
que un «VERIFICADO» afirma también que las dos caras son de la misma persona.

### Los umbrales se MIDEN, y el perfil dice sobre qué población

Un umbral es una promesa sobre errores —«por encima de esto acepto, y con ello
acepto una de cada mil caras ajenas»— y esa promesa sólo se sostiene sobre una
medición. `scripts/calibrar-identidad.mjs` construye las dos distribuciones que
la sostienen: parecidos entre tomas de la misma persona y entre personas
distintas. De ahí salen los dos cortes, y entre ellos queda la franja que va a
una persona. Si al medir no queda franja, el comando falla en vez de emitir un
par imposible.

Sobre la población sintética de `fixtures/identity-faces.ts` —60 personas, tres
tomas de cada una, 156 parejas genuinas y 13 374 impostoras—:

| | mín | p05 | mediana | p95 | máx |
| --- | --- | --- | --- | --- | --- |
| genuinas | 0,6884 | 0,8315 | 0,9281 | 0,9703 | 0,9789 |
| impostoras | 0,1654 | 0,3753 | 0,5919 | 0,7781 | 0,9206 |

`IDENTITY_MATCH_THRESHOLD=0.8824`, `IDENTITY_REVIEW_THRESHOLD=0.7789`, perfil
`sintetico-60x3-fmr1e-3-fnmr1e-2`. Sobre ese corpus aprueba automáticamente el
84,0 % de las genuinas, manda a revisión el 15,4 %, rechaza el 0,6 % y deja pasar
14 de 13 374 impostoras (0,105 %).

**Los rostros son dibujados, no fotografías de nadie.** Con biometría real las
imágenes de prueba necesitan caras de verdad, y la salida obvia sería versionar
fotos de personas: no se hace, porque un rostro que entra al historial de git ya
no sale, y este worker existe justamente para proteger ese dato. La consecuencia
honesta es que **este perfil no predice la tasa de error sobre personas reales**
—una población dibujada no cubre el espacio de rasgos que cubren las caras—, así
que se llama `sintetico-…` y el esquema de entorno lo **rechaza en producción**.
Para producción se recalibra con el mismo comando apuntado a un corpus real, que
nunca se versiona.

### Las dos caras se preparan IGUAL antes de compararse

Durante mucho tiempo no. El retrato del documento entraba recortado al rostro y
remuestreado a 480 px; la selfie entraba ENTERA. El descriptor sí ve esa
diferencia, y lo que costaba está medido comparando **el mismo rostro consigo
mismo** por los dos caminos sobre el retrato de una cédula real: **0,9157**. No
es la distancia entre dos personas —son los mismos píxeles— y el umbral de
aprobación del perfil de laboratorio está en 0,8824. El preprocesado se comía
casi todo el margen antes de que la comparación empezara.

Y lo grave no era la media sino la INESTABILIDAD. Midiendo el mismo rostro contra
escenas donde ocupa distinta parte del encuadre:

| Rostro en el encuadre | Selfie entera (antes) | Recortada (ahora) |
| --------------------- | --------------------- | ----------------- |
| muy ceñida            | 0,9913                | 0,9692            |
| primer plano          | 0,9782                | 0,9655            |
| medio cuerpo          | 0,9842                | 0,9671            |
| brazo extendido       | 0,9454                | 0,9589            |
| de lejos              | 0,9027                | 0,9762            |

El recorte simétrico cuesta unas centésimas en los encuadres cerrados y a cambio
**reduce la dispersión cinco veces** (0,089 → 0,017) y sube el peor caso de 0,903
a 0,959. Un umbral sólo significa algo si la cifra que corta no depende de lo
lejos que la persona sostuviera el teléfono.

**Excepción medida:** si la caja del rostro toca el borde del encuadre, no se
recorta. Con la cara cortada por el marco el margen no cabe, `crop` lo acota
contra los límites y entrega medio rostro ampliado; medido, el parecido caía de
0,7971 con la imagen entera a 0,6245 con el recorte. Ahí el contexto de alrededor
es justo lo que le falta al recorte, así que se compara con la imagen entera.

`FACE_CROP_LONG_EDGE` se queda en 480: el barrido 480 / 960 dio 0,9656 contra
0,9693 de media y 0,9230 contra 0,9205 en el peor caso — un empate, y un empate
no justifica un cambio.

### La selfie también se endereza

El documento tenía búsqueda de orientación desde el principio y la selfie no
tenía ninguna, aunque las dos salen de la misma cámara del mismo teléfono.
Medido con el detector de este worker sobre un rostro que a 0° puntúa 1,000:
girado 90°, 180° o 270° devuelve **cero rostros** en los tres casos. Una selfie
tumbada no producía un parecido bajo — producía `IDENTITY_FACE_NOT_FOUND`, un
fallo duro, sobre una foto en la que la cara está perfectamente visible.

Se prueban los tres giros y gana el de **mayor puntuación del detector**, no el
primero que encuentre una cara: pararse en el primer acierto elegía el giro que
deja el rostro boca abajo —el detector todavía encuentra algo ahí— y el parecido
salía 0,3259 en vez de 0,7970. Es el mismo criterio con el que se endereza el
documento. Queda constancia en `SELFIE_REORIENTED`.

### El rostro se ALINEA antes de describirlo

`detector.rotation` estaba apagado. Encenderlo hace que Human alinee la cara con
la malla facial antes de pasarla al descriptor, y es lo único de todo lo que se
probó que **mejora las dos poblaciones a la vez** — que es el listón que tiene
que pasar cualquier cambio aquí, porque subir el parecido de un par genuino es
trivial (basta acercar todos los rostros entre sí) y es también exactamente cómo
se cuela un impostor.

| `rotation` | Par real documento↔selfie | Genuinas p05 | Impostoras p99 | d'    |
| ---------- | ------------------------- | ------------ | -------------- | ----- |
| `false`    | 0,6606                    | 0,8315       | 0,8572         | 3,299 |
| `true`     | **0,6930**                | **0,8436**   | **0,8460**     | **3,395** |

Las genuinas suben, las impostoras bajan y la separación mejora. Cuesta 16 ms por
imagen (72 → 88) sobre una verificación de ~3,6 s. Como efecto secundario, el
antispoof sobre una selfie real subió de 0,610 a 0,750.

Se descartó, en cambio, **normalizar la iluminación de los recortes**: sube el
par real en las 11 configuraciones probadas (+0,03 a +0,05) pero degrada la
separación sobre la población con impostores (d' 3,412 → 3,014) y pierde
detecciones. Un cambio que mejora el único par genuino disponible y empeora lo
único con impostores medibles es una apuesta, no una mejora.

### Los umbrales de laboratorio se retiran del compose

`docker-compose.yml` inyectaba 0,8824 y 0,7789 por omisión. Medido con una cédula
boliviana auténtica y una selfie real de su titular, la misma persona puntúa
**0,693**: por debajo del corte de aceptación y también por debajo del de
RECHAZO. El motor no dudaba de un solicitante legítimo — lo declaraba impostor
(`FACE_NO_MATCH`), que es el peor error de este módulo y el único que quien lo
sufre no puede arreglar de ninguna manera.

Las dos claves quedan **sin valor** en el compose: se toman del entorno de la
máquina si están puestas y quedan AUSENTES si no. Sin ellas el motor devuelve
`REVIEW_REQUIRED` con `THRESHOLD_PROFILE_MISSING` y el caso llega a una persona
con su cifra delante:

| Configuración | Veredicto sobre un par genuino real |
| --- | --- |
| umbrales de laboratorio | `NOT_VERIFIED` · `FACE_NO_MATCH` |
| sin umbrales | `REVIEW_REQUIRED` · `THRESHOLD_PROFILE_MISSING` |

No se ponen otros cortes «provisionales» porque no hay con qué medirlos: bajar el
de aceptación hasta 0,69 aprobaría también a los impostores, cuyo percentil 99 en
la población medible está en 0,846.

**Ojo con el vacío**: `IDENTITY_MATCH_THRESHOLD=` (cadena vacía) se convierte en
0 por la coerción de zod. La regla de orden lo atrapa —el de revisión tendría que
ser menor que 0, imposible con `.min(0)`— así que la aplicación no arranca en vez
de aprobar a cualquiera. Aun así, la forma correcta es AUSENTE, no vacío.

### Calibrar con las parejas del tipo correcto

`scripts/calibrar-identidad.mjs` emparejaba varias tomas de la misma persona:
selfie contra selfie. Ese no es el contraste que este worker hace. La comparación
real es **retrato impreso de un carnet contra selfie viva**, y son dos dominios:
el retrato va tras un plastificado que lo lava, le mete velo de color y le come
contraste. Calibrar selfie↔selfie da un corte alto y perfectamente inútil.

El modo nuevo:

```
yarn build                       # el comando mide con el motor COMPILADO
node scripts/calibrar-identidad.mjs --documento-selfie <corpus>
```

En la carpeta de cada persona, el archivo que empieza por `doc`, `carnet` o
`cedula` es su documento y el resto son sus selfies. Las parejas genuinas son
documento↔selfie de la misma persona; las impostoras, documento de una contra
selfies de las demás — sin simetrizar, porque el flujo nunca compara dos selfies
ni dos carnets. Y en los dos modos los rostros se **recortan como los recorta el
pipeline**: un umbral medido sobre imágenes enteras no aplica a un motor que
compara recortes.

### Un umbral no medido lo dice el propio veredicto

El perfil `sintetico-…` decidía en silencio fuera de producción: quien leía un
`AMBIGUOUS_MATCH` no tenía cómo saber que la cifra que lo produjo se calibró
contra rostros dibujados. Ahora la ejecución lleva `THRESHOLD_PROFILE_UNMEASURED`
cuando el perfil no está medido contra personas. Es una marca, no una escalada:
escalar por esto mandaría a revisión toda verificación de todo entorno no
calibrado, que es lo mismo que apagar el worker.

Para depurar un caso concreto —la única forma, porque el motor borra las imágenes
al cerrar la ejecución— existe `scripts/medir-parecido-identidad.ts`, que recorre
el mismo camino que el pipeline y publica cada paso con su número:

```
yarn ts-node scripts/medir-parecido-identidad.ts <documento> <selfie>
```

### La prueba de vida es pasiva, y sobre una entrada fabricada NO se ejecuta

`antispoof` y `liveness` se combinan con el **mínimo** de las dos, no con la
media: responden a ataques distintos —una pantalla y una máscara impresa— y una
media deja que una señal convencida tape a la otra. Por encima de
`IDENTITY_LIVENESS_PASS_SCORE` se da por superada, por debajo de
`IDENTITY_LIVENESS_FAIL_SCORE` se rechaza, y en medio queda NO CONCLUYENTE, que
va a revisión humana. La franja del medio existe a propósito: una prueba pasiva
sobre una imagen fija acierta mucho y no siempre.

Detecta la foto de una foto y la pantalla, que es el ataque corriente. **No**
sustituye a un desafío activo —girar la cabeza, parpadear— frente a un atacante
decidido, y por eso el resultado sale con su cifra a la vista.

Sobre los rostros dibujados de los escenarios el antispoof puntúa entre 0,44 y
0,67: ni convencido ni en contra, que es lo que debe responder ante un dibujo. Se
intentó subirlo con viñeta, luz lateral, nitidez y recorte cerrado, y no se
mueve. Bajar el listón para que pasaran habría debilitado la defensa contra la
foto impresa —el ataque que este control existe para parar—, así que la salida
fue la contraria: sobre una entrada que **fabricó el motor** la prueba de vida no
se ejecuta, y el resultado lo dice (`NOT_RUN`, proveedor `entrada-generada`,
marca de riesgo `GENERATED_INPUT_NO_LIVENESS`).

No es una puerta trasera: lo pone el servidor a partir de que la ejecución
naciera del catálogo, nunca quien sube un archivo, y los escenarios están
apagados en producción. La **comparación biométrica** de un escenario es real y
completa; esto sólo afecta a la prueba de vida, que sobre una imagen fabricada no
tiene nada que medir.

### El documento se recorta del fondo antes de leerlo

Una foto de una cédula sobre un escritorio trae mesa, sombras y a veces otros
papeles: el documento es minoría en el encuadre y todo lo demás entra al
reconocedor. Antes de leer se recorta el borde uniforme (`sharp.trim`).

Dos guardas lo hacen seguro, porque un recorte que se coma el número es peor que
no recortar: si sobrevive menos de la cuarta parte del área se descarta el
recorte, y si la imagen recortada no llega a clasificarse, se vuelve a leer la
ENTERA antes de rechazar nada. El peor caso del encuadre es una lectura más
lenta, nunca un rechazo.

Medido con el escenario `identidad-sobre-escritorio`: sobrevive el 32 % de la
foto y el documento se lee completo. El resultado publica `framing`, porque ante
una lectura pobre la primera pregunta es «¿se recortó?».

### Se leen los DOS formatos de cédula, y la MRZ manda

El analizador absorbido estaba escrito para el formato ANTERIOR, sin etiquetas
(`A: <nombre>`, `Nacido el`, `Válida hasta el`). La cédula vigente no lleva
ninguno de esos anclajes: lleva campos ROTULADOS (`NOMBRES`, `APELLIDOS`,
`FECHA DE NACIMIENTO`, `FECHA DE EXPIRACION`, `N°`) y, en el reverso, una MRZ
TD1. Sobre una cédula actual, el analizador original sólo habría sacado el
número: todo lo demás habría salido «campo ausente» y la verificación habría
terminado en revisión manual sin que nada estuviera mal.

Se añaden los anclajes del formato vigente **sin quitar los del anterior**: los
dos circulan.

Tres cosas que costó descubrir y que valen para cualquier documento real, no
sólo para los escenarios:

- **El rótulo va ENCIMA del valor**, no delante. El reconocedor devuelve
  `NOMBRES` y `MARIA RENEE` como dos renglones, así que buscar
  `NOMBRES: <algo>` en una sola línea no encuentra nada.
- **Emisión y expiración se imprimen en la misma fila.** Quedarse con la primera
  fecha del renglón daba la de emisión como caducidad y **declaraba caducado un
  documento vigente**. Se resuelve con un hecho del documento —la emisión es
  anterior a la expiración— y no con posiciones de píxeles.
- **La MRZ manda para el número y las fechas, pero NO para el nombre.** Su
  tercer renglón tiene treinta caracteres contados y la norma manda truncar:
  `RODRIGUEZ<GONZALEZ<<MARIA<RENE` pierde la última letra. Un dato con dígito de
  control es más fiable sólo mientras está entero.

Lo que aporta la MRZ es lo que ninguna otra parte del documento tiene: **dígitos
de control**. Un campo cuyo dígito no cuadra se descarta en vez de publicarse —
vale más no saber el número que saberlo mal cuando lo que se decide es la
identidad de alguien—. Y cuando el anverso y la MRZ discrepan, se avisa
(`DOCUMENT_MRZ_MISMATCH`): dos caras que no dicen lo mismo son la firma de un
documento compuesto, no un problema de lectura.

### Una imagen que no es un documento no produce veredicto

Si el clasificador no reconoce un documento de identidad, el pipeline lanza
`IDENTITY_DOCUMENT_UNSUPPORTED` y corta **antes** de comparar rostros.

Es la diferencia entre «no puedo afirmar que seáis la misma persona» y «lo que
me diste no es un documento». Sin la guarda, una foto cualquiera recorría el
camino entero —el analizador genérico devuelve dos campos derivados y ninguno
obligatorio— y salía por la puerta de la revisión manual, cargándole a una
persona una cola de fotos que no son documentos.

La regla es del PIPELINE, no del proveedor: con un lector real detrás sigue
diciendo lo mismo, y por eso el rechazo no depende de qué OCR esté configurado.

Se distinguen dos casos porque no se arreglan igual: «no se leyó ni una letra»
—foto movida, a contraluz, se cura repitiéndola— y «hay texto pero no es un
documento soportado». El mensaje lo dice.

Y su contrario también está fijado: un documento que SÍ se reconoce como cédula
pero del que no se pueden leer los campos va a **revisión manual**, no a error.
El escenario `identidad-ilegible` existe para que ese límite no se mueva sin que
alguien lo note.

### Apagar la prueba de vida sigue siendo posible, y sigue costando

Viene ENCENDIDA por omisión desde que es real. Se puede apagar
(`IDENTITY_LIVENESS_ENABLED=false`), y entonces el adaptador deshabilitado
devuelve `NOT_RUN` —señal ausente, **no** éxito—; pero sin ella una foto impresa
del documento junto a una foto impresa de su titular pasa una comparación 1:1.
Por eso apagarla en producción obliga a declarar
`IDENTITY_ACCEPT_NO_LIVENESS_RISK`: convierte un descuido de configuración en una
decisión que alguien firma.

### Lo que no puede salir a producción

Al absorber el paquete se perdieron sus guardas de producción, y esa pérdida era
silenciosa: un despliegue que sólo encendiera el worker habría decidido sobre la
identidad de personas reales sin prueba de vida y sin decir contra qué
calibración decidió. Se restauran en el esquema de entorno,
donde fallan al ARRANCAR y con un mensaje legible, no en la primera
verificación:

| Con el worker encendido en producción | Por qué |
| --- | --- |
| `IDENTITY_THRESHOLD_PROFILE_VERSION=sintetico-…` | El corte se midió sobre rostros dibujados: no predice la tasa de falsas aceptaciones sobre personas |
| `IDENTITY_THRESHOLD_PROFILE_VERSION=unconfigured` | El veredicto no diría contra qué se decidió |
| Sin prueba de vida y sin `IDENTITY_ACCEPT_NO_LIVENESS_RISK` | Apagarla es legítimo; hacerlo sin que nadie lo decida, no |

Con el worker APAGADO no se exige ninguna: el precio se paga al encenderlo, no
en cada despliegue del motor.

Aparte, y en cualquier entorno, el esquema rechaza un par de umbrales a medias o
invertido, y encender la prueba de vida con el proveedor en `disabled`. No son
configuraciones incompletas: son contradicciones, y fallan donde se pueden leer.

## Consecuencias

- El motor gana peso en `node_modules`, y se acepta a sabiendas: es el precio de
  que la verificación sea real en vez de una promesa, y de que no haya factura
  por verificación ni dependencia de un proveedor externo.
  - `sharp` (medir resolución, exposición, contraste y nitidez, recortar el
    retrato y componer los escenarios — la que el paquete original ya usaba).
  - `tesseract.js` con sus datos de idioma, ~32 MB.
  - `@vladmandic/human` con sus cinco redes, ~44 MB, más `@tensorflow/tfjs-core`,
    `tfjs-converter` y `tfjs-backend-wasm`. Todo JS y WebAssembly: **ningún
    binario nativo que compilar**, que es lo que hace que la misma instalación
    sirva en Windows y en la imagen de despliegue.
- Verificar cuesta segundos, no milisegundos. La batería del pipeline pasó de
  ~180 s a ~600 s al dejar de ser simulada, porque ahora cada caso detecta,
  describe y compara rostros de verdad. Es tiempo de CPU en el worker, que ya era
  asíncrono y con reserva por ejecución.
- La primera verificación tras arrancar paga la carga de los modelos (10,4 MB de
  pesos, ~300 ms desde disco). Se cargan una sola vez por proceso.
- Las imágenes del motor instalan `fonts-dejavu-core`. `sharp` compone los
  escenarios con fontconfig y, sin una sola fuente, el texto se dibuja vacío: la
  tarjeta sale en blanco y el escenario falla por «no se pudo leer», que parece
  un fallo del lector y es una fuente que falta.
- Se tocó UNA línea del analizador absorbido: el anclaje del número de cédula
  tolera ahora `C.1.`/`C.l.` además de `C.I.`. No es un capricho — Tesseract
  devuelve `C.1.` sobre una tarjeta perfectamente legible, y el analizador ya
  toleraba distancia de edición en los nombres de mes por el mismo motivo.
- Los tres workers comparten catálogo, mapeador de ejecuciones y servicio de
  métricas. Eso es deliberado —es lo único que comparten— y es también la
  superficie de regresión: `e2e/portal-real-identidad.spec.ts` del portal
  ejercita el worker de extractos entero por ese motivo.
- El código de la máquina de estados y el modelo de artefactos del paquete
  original quedan fuera. Si mañana hace falta captura en varios pasos, se
  recupera de su repositorio; no se ha perdido.

## Cómo se comprobó

- `test/identity-verification-pipeline.spec.ts` — el pipeline entero, con
  `sharp` y el OCR REALES sobre imágenes generadas, un caso por desenlace del
  motor de decisión, la prueba de que una foto cualquiera se rechaza y la de que
  sin umbrales todo va a revisión.
- `test/identity-mrz-td1.spec.ts` — la MRZ sin OCR de por medio: los dígitos de
  control, el relleno que el reconocedor se come, las confusiones de OCR-B y el
  siglo de las fechas.
- `test/identity-verification-env.spec.ts` — las guardas de producción.
- `test/identity-verification-input.spec.ts` — el borde: bytes mágicos, tipo
  declarado que miente, techo de tamaño, nombre con ruta.
- `scripts/smoke-identity.mjs` (`yarn smoke:identity`) — el camino completo por
  HTTP contra una instancia viva: API acepta → fila encolada → `pg_notify` →
  worker reclama → pipeline → veredicto consultable.
- En el portal, `e2e/portal-real-identidad.spec.ts` con sesión real y rol
  `RISK_ANALYST` —el mínimo que el worker exige—, incluida la subida de dos
  imágenes propias por `multipart/form-data`.
