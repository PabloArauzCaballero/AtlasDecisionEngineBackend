# Veintitrés cédulas auténticas, y la diferencia entre no leer y acusar

El worker de identidad se midió contra [cinco cédulas reales](identidad-cinco-cedulas-reales.md) y
arregló ocho defectos concretos. Ahora se ha medido contra **veintitrés**, con un corpus de
conocimiento delante —la especificación documental, la MRZ del ICAO, la taxonomía de ataques de
presentación y una política de producción explícita— y lo que ha aparecido no es un noveno defecto:
es un patrón que atravesaba el worker entero.

**El worker no distinguía «no lo pude leer» de «no está».**

Las dos cosas salían por el mismo sitio y con el mismo peso. Un dígito de control que el reconocedor
devolvió como `?` contaba igual que un dígito de control que no cuadra. Una plantilla cuyos rótulos
no se leyeron porque la foto mide 800 píxeles contaba igual que una plantilla a la que le faltan
rótulos. Y las dos, sumadas, mandaban a una persona casi la mitad de los documentos legítimos.

## La medición, antes y después

Las veintitrés carpetas contienen documentos **auténticos**. Eso convierte cualquier señal levantada
sobre ellas en un error medible, y el resumen de `yarn diagnosticar:carnets <carpeta>` en la única
tasa de falsa acusación que este worker puede tener hoy.

|                                       | antes        | después          |
| ------------------------------------- | ------------ | ---------------- |
| Sale limpio (`CLEAR`)                 | 12/23 (52 %) | **21/23 (91 %)** |
| Va a la cola humana (`REVIEW`)        | 11/23 (48 %) | **2/23 (9 %)**   |
| Acusado de fraude (`FRAUD_SUSPECTED`) | 0/23         | 0/23             |
| MRZ con algún control «fallido»       | 6/23 (26 %)  | **0/23**         |
| Los cuatro campos del expediente      | 17/23        | 17/23            |
| Clasificadas como cédula boliviana    | 19/23        | 19/23            |

Lo que **no** cambió es tan importante como lo que cambió: los mismos diecisiete expedientes
completos y las mismas diecinueve cédulas reconocidas. No se ha aflojado la lectura; se ha dejado de
acusar por lo que la lectura no alcanzó.

Las dos que siguen yendo a revisión lo hacen por lo que de verdad les pasa: son capturas de 2.204 y
2.030 píxeles donde el microtexto del guilloché domina el reconocimiento y la cobertura del catálogo
se queda en 0,33 y 0,36. Ahí no hay nada que un umbral pueda arreglar — hay que mirar la imagen.

## Los cuatro cambios

### 1. Un dígito de control que no se lee es NO EVALUABLE

`core/parsers/mrz-td1.ts` publicaba `checks` en dos estados y ahora lo hace en tres: cuadra, no
cuadra y **no se pudo comprobar**. El tercero se declara cuando el dígito no es un dígito, cuando el
renglón lleva caracteres fuera del alfabeto de la MRZ, o cuando el renglón llegó corto y hubo que
rellenarlo —un control calculado sobre caracteres que pusimos nosotros no dice nada del documento—.

Medido sobre las veintitrés: **cuatro** traían el dígito compuesto ilegible. Estos son sus segundos
renglones, tal como los devolvió el reconocedor:

```
0503132F3103234BOL<<<<<<<<<<<?
9712054M3008144B0L<<<<<<<<<<<?
6605278F4911254BO0L<<<<<<<<<<<c
0201058m3012176BO0OL<<<<<< <<6
```

Un `?`, otro `?`, una `c` minúscula y un renglón con un espacio dentro. Ninguno de los cuatro
documentos estaba manipulado; a ninguno de los cuatro se le podía comprobar ese dígito. El corpus lo
dice en una línea: «campo no leído es NO_EVALUABLE, no FALSO».

### 2. La alineación de la MRZ se elige por la norma, no por un acierto de azar

El analizador prueba varias alineaciones del renglón —el reconocedor le cuelga glifos por delante— y
se quedaba con la que más controles validara. Un control es **un dígito**: acertarlo por casualidad
pasa una vez de cada diez, y cuando pasaba, ganaba una alineación corrida. Sobre la MRZ sintética de
las pruebas eso publicaba `OLI` como estado emisor y dejaba el dígito de control del número sobre un
relleno.

Ahora las alineaciones con **cabecera válida** —tipo de documento `A`, `C` o `I` y emisor de tres
letras, que es lo que fija el ICAO— se prueban primero y, si hay alguna, ninguna otra compite. Cuando
ninguna la tiene, se prueban todas, como antes.

### 3. Una plantilla que no se pudo leer no es una plantilla incompleta

La cobertura de plantilla mide qué rótulos del catálogo aparecen en el texto reconocido. Depende de
dos cosas: de que el documento los lleve **y** de que la foto tenga resolución para leerlos.

La mediana del lado largo de estas veintitrés fotos es **796 px**. La conversión del corpus dice que
una tarjeta de 85 mm a los 300 ppp que recomienda el reconocedor son 1.004 px, y la medición propia
sobre una cédula auténtica dice esto:

| lado largo del OCR     | 600   | 900   | 1200  | 1600  |
| ---------------------- | ----- | ----- | ----- | ----- |
| cobertura del catálogo | 0,216 | 0,463 | 0,515 | 0,664 |

Con el umbral de cobertura en 0,40, un documento legítimo a 600 px da 0,216 —acusación garantizada— y
a 900 px deja seis centésimas de margen que cualquier reflejo se come. Por debajo de **1.000 px**
(`LADO_LARGO_MINIMO_LEGIBLE`), la cobertura se declara NO EVALUABLE: no puntúa riesgo, se registra
como prueba ausente y, en modo estricto, escala — que es lo que el corpus llama
`RECAPTURE_OR_REVIEW`. Dieciséis de las veintitrés caen ahí, y a esas dieciséis lo que corresponde
pedirles es otra foto, no una explicación.

### 4. Tres reglas que acusaban sin poder demostrarlo

`core/forensics/template-conformance.ts` devuelve ahora dos listas: **incoherencias**, que suman
riesgo, y **observaciones**, que se registran y no suman. Tres reglas se movieron a la segunda:

- **El formato del número de cédula.** Se exigían cinco a ocho dígitos sin cero inicial. El corpus
  fue a buscar la gramática del SEGIP y devolvió longitud mínima, longitud máxima y política de
  ceros iniciales en `null`, con la instrucción de conservar los ceros y no rechazar por una longitud
  que nadie ha confirmado. Del complemento resolvió además una contradicción del encargo: el
  Servicio de Impuestos Nacionales lo publica como **alfanumérico**, no como dos letras.
- **La nacionalidad de la MRZ.** Ni la nacionalidad ni el estado emisor están cubiertos por ningún
  dígito de control —el corpus los enumera entre los campos no protegidos— y un titular extranjero
  con cédula boliviana tiene legítimamente otra nacionalidad. Acusaba a dos de veintitrés.
- **El lugar de nacimiento.** Una persona nacida fuera de Bolivia es una persona nacida fuera de
  Bolivia. Acusaba a una.

Ninguna de las tres desaparece del expediente: quien revisa sigue viéndolas, y ve también por qué no
cuentan.

## La prueba de vida ya no rechaza sola

Los cortes 0,55 y 0,35 venían del encargo. El corpus los devuelve con una etiqueta inequívoca
—`NO_USAR_COMO_RECHAZO_AUTOMATICO`, población «ninguna calibración real declarada»— y su política de
producción deja los dos umbrales del PAD en `null` con `auto_reject_fraud_enabled: false`.

El motor de decisión ya exigía un perfil calibrado para el cotejo facial
(`THRESHOLD_PROFILE_MISSING`). Ahora exige lo mismo para la vida: con
`IDENTITY_LIVENESS_PROFILE_VERSION` en `unconfigured` —que es lo que hay— una prueba de vida fallida
termina en `REVIEW_REQUIRED` con `LIVENESS_PROFILE_UNCALIBRATED` en vez de en `NOT_VERIFIED`.

**No es un aflojamiento.** Un ataque de presentación sigue sin aprobarse nunca; lo que cambia es
quién firma el «no». Sin una población de ataques y de genuinos no hay APCER ni BPCER que enseñar en
una reclamación, y un rechazo que no se puede defender es peor que una cola.

## Lo que el corpus dice que una sola foto no puede hacer

Está enumerado y viaja al código (`IMPOSIBLE_CON_UN_SOLO_FOTOGRAMA`): medir pulso, observar un
parpadeo como evento, probar micromovimiento, observar paralaje, verificar una secuencia
reto-respuesta, demostrar sincronización con iluminación activa. No es una limitación del worker: un
fotograma no contiene tiempo. Las catorce señales estáticas que sí caben en una imagen llegan las
catorce con la misma acción de producción —evidencia auxiliar o revisión, **nunca rechazo duro**— y
con la misma nota: no existe tasa publicada transferible a este dominio.

## Cómo se vuelve a medir

```bash
yarn diagnosticar:carnets ~/Desktop/carnets                 # resumen por consola
yarn diagnosticar:carnets ~/Desktop/carnets --json /tmp/m.json
yarn diagnosticar:carnets ~/Desktop/carnets --texto         # además, el texto reconocido
```

El script no escribe nada dentro del directorio de entrada y no deja rastro en el repositorio. El
texto reconocido lleva nombre, domicilio y número de documento de personas reales, así que sólo se
imprime con `--texto`.

Las pruebas que fijan todo esto están en `test/corpus-identidad-regresion.spec.ts`. El corpus del que
salen vive en `corpus/corpus-identidad-bo.json`, con su procedencia explicada en `corpus/README.md`, y
se convierte en TypeScript con `yarn corpus:generar` — ver
[los dos corpus de referencia](corpus-extractos-bolivia.md#los-dos-corpus-viven-en-el-repositorio).
