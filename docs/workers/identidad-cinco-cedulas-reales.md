# Lo que enseñaron cinco cédulas bolivianas auténticas

El 6 de septiembre de 2026 el worker de identidad se midió por primera vez contra un **corpus** de
documentos reales: cinco cédulas, anverso y reverso de cada una, dos del formato anterior y tres del
DS 4924 de 2023. Hasta entonces sólo se había probado contra [una sola foto
real](identidad-fraude-documental.md) y contra los ejemplares que el propio código dibuja.

Cinco no es un corpus grande. Es suficiente para lo que hizo: **ninguno de los defectos que
aparecieron era estadístico**. Todos eran errores concretos —un ancla mal escrita, un rótulo anclado
al principio del renglón, una regla de desempate al revés— que la tarjeta sintética no podía
producir porque está dibujada con tipografía limpia, ya viene encuadrada y no tiene fondo.

## El punto de partida

| | Nº de documento | Nombre | Desenlace |
| --- | --- | --- | --- |
| 1 (anterior, sobre papel cuadriculado) | ausente | ausente | **rechazada**: «no es un documento de identidad» |
| 2 (DS 4924) | correcto | `” .UISPE MAMANI` | marcada como documento compuesto |
| 3 (DS 4924, caducidad indefinida) | ausente | `e QUISPE MAMANI` | caducidad **inventada** + documento compuesto |
| 4 (anterior) | correcto | ausente | sin caducidad |
| 5 (DS 4924) | correcto | correcto | correcta |

Dos de cinco sin número, tres de cinco con el nombre roto, una rechazada entera y una con una
caducidad que la tarjeta no dice.

## El punto de llegada

Cinco de cinco números, cuatro de cinco nombres —el quinto tiene el reverso ilegible en la propia
fotografía—, las cinco clasificadas como cédula boliviana y **ninguna marcada como documento
compuesto**. Cuatro salen `CLEAR` del análisis de fraude y la quinta va a revisión por lo que de
verdad le pasa: es una captura de pantalla de 586×364 y su cobertura del catálogo queda por debajo
del mínimo.

## Los ocho defectos, y por qué ninguno se veía antes

### 1. El encuadre no encuadraba — `core/adapters/document-framing.ts`

`sharp.trim()` recorta el borde **uniforme** a partir del color de las esquinas. Sobre lo que la
gente fotografía no dispara: recortó algo en dos de diez imágenes. La peor era una cédula que ocupa
el 40 % de un encuadre vertical sobre **papel cuadriculado**, un fondo que no es uniforme, así que
el reconocedor leía la hoja entera y la clasificación salía `UNKNOWN`.

El detector nuevo no busca bordes —la cuadrícula tiene más bordes que la cédula— sino **densidad de
píxeles que no pertenecen al fondo**, medida por bloques de 8×8. Las líneas de una cuadrícula son
finas y aisladas y dejan el bloque al 10-15 %; el texto y el retrato de una cédula lo dejan al
50-90 %. El color del fondo sale de la mediana de las cuatro franjas del borde y la tolerancia, del
percentil 85 de lo que hay en ese mismo borde: si el borde de la foto es cuadrícula, la cuadrícula
es fondo por construcción.

Tres guardas lo mantienen honesto, y las tres vienen de un fallo que llegó a producirse:

- **Los huecos interiores se cierran** antes de buscar tramos. Una tarjeta no es densa de manera
  uniforme —la banda de la firma, el fondo liso de la mitad inferior— y sin esto el tramo más largo
  era la mitad SUPERIOR de la tarjeta: el recorte se llevaba por delante el número.
- **Gana el tramo de más energía, no el más largo.** Una sombra dura o el borde de la mesa dejan
  tramos largos y flojos que podían ganarle a la tarjeta.
- **Dentro tiene que ser tres veces más denso que fuera.** Cuando el documento ya llena el encuadre,
  el color «del fondo» sale de la propia tarjeta y el perfil devuelve un trozo arbitrario del
  interior; medido, eso recortaba a la mitad y la cobertura caía a cero.

Efecto medido sobre el corpus: cobertura del catálogo 0,299 → 0,455 en la peor, 0,580 → 0,852 en la
mejor.

### 2. Los rótulos del nombre estaban anclados a `^`

`NOMBRES` y `APELLIDOS` son los únicos rótulos que van pegados al retrato, así que el reconocedor
mete delante los glifos que cree ver en la foto: `Z NOMBRES:`, `= APELLIDOS:`, `5 ; APELLIDOS`.
Ninguno empieza por su propia palabra. Y como las dos tienen **siete** caracteres, están por debajo
del mínimo de ocho del cotejo tolerante: no había segunda oportunidad. Los rótulos de fecha ya
toleraban un prefijo desde siempre; ésta era la asimetría.

### 3. El ruido entraba por la cabeza y sólo se limpiaba la cola

`” .UISPE MAMANI`, `e QUISPE MAMANI`, `S ANA LUCIA. $`, `5 ANA LUCIA >= |`. Esos glifos viajaban
al expediente **como parte del nombre de una persona**.

### 4. Media identidad impresa descartaba la MRZ entera

Bastaba con que UNA de las dos mitades impresas pareciera un nombre para quedarse con las dos y no
volver a mirar la MRZ. Nombres y apellidos se leen de dos sitios distintos de la tarjeta: que uno
falle no dice nada del otro. Ahora cada mitad se resuelve por separado, y **lo impreso gana sólo si
es lo mismo o más que la MRZ, nunca menos** — la razón por la que lo impreso mandaba es la
truncatura a treinta caracteres de la norma ICAO, y esa razón sólo se aplica cuando lo impreso
CONTIENE lo de la MRZ.

### 5. El formato anterior no tenía ni caducidad ni nombre

Esa generación imprime `Emitida el <fecha>` y `Expira el <fecha>` con el valor DETRÁS del rótulo, y
no estaban en el analizador. El reconocedor además los mutila (`Exirael`), así que hizo falta que el
cotejo aproximado devolviera **posiciones** —`valorTrasEtiqueta` en `approximate-match.ts`— para
poder cortar el valor. Y el nombre vive en el reverso tras una `A:`, el glifo más pequeño con el que
se puede anclar un campo y el primero que se pierde: se recupera por la estructura de la tarjeta, el
renglón que va justo encima de `Nacido el`, marcado como suposición.

### 6. `INDEFINIDO` producía una caducidad falsa

Dos de las cinco cédulas no caducan. El renglón del formato vigente lleva las dos fechas juntas
—`25/11/2024   INDEFINIDO`— y la regla «la caducidad es la última fecha del renglón» devolvía la de
EMISIÓN: una cédula vigente salía caducada en el año de su emisión. Y encima marcada
`DOCUMENT_MRZ_MISMATCH`, porque la MRZ codifica lo indefinido con una fecha centinela lejana (la
norma ICAO exige seis dígitos y no admite «indefinido»). Hoy hay un aviso propio,
`DOCUMENT_EXPIRY_INDEFINITE`, que es lo que la tarjeta dice.

### 7. El número: tres formas de perderlo y una de inventarlo

- **El guion del borde.** `No-4521966-—` no casaba: el remate `(?![\d-])` hacía que la expresión
  retrocediera dígito a dígito y todas las alternativas terminaran mirando el mismo carácter.
- **La MRZ corrida.** El primer renglón llegó con dos caracteres de basura delante
  (`LEI<BOL4521966…`) y las únicas variantes eran «tal cual» y «sin el primer carácter». El número
  era legible y su dígito de control cuadra en cuanto el renglón se alinea. Ahora se prueban
  recortes de hasta cuatro, y los de más de uno sólo cuentan como seguros si la cabeza resultante
  tiene la forma que la norma exige: tipo de documento y estado emisor.
- **La serie y la sección.** Tienen cinco dígitos, o sea la forma de un número de cédula corto.
  Cuando el reconocedor se come su rótulo, la vía de los dígitos sueltos los adjudicaba.
- **El número de la calle.** `C. LOS ALAMOS NRO 3170 B` casaba con el ancla `NRO`, la `B` se reparaba
  a `8` y el resultado, `31708`, tenía la forma correcta. Ese número entraba en el expediente y, al
  no coincidir con el de la MRZ, la cédula salía **acusada de ser un documento compuesto por el
  número de su propia calle**. La reparación de glifos ahora vale dentro del número, no en sus
  puntas.

### 8. Dos falsas acusaciones de fraude

- **`DOCUMENT_MRZ_MISMATCH` por una cifra.** Un falsificador no se equivoca en un dígito: copia una
  plantilla y escribe datos que no cuadran con nada. Una cifra de diferencia contra una MRZ cuyos
  dígitos de control cuadran es una mala lectura. Y cuando lo único que discrepa son las FECHAS, el
  aviso es otro —`DOCUMENT_MRZ_DATE_MISMATCH`— porque el número y el nombre identifican a la
  persona y las fechas van en el cuerpo más pequeño del anverso sobre guilloché.
- **`MRZ_NATIONALITY_NOT_BOL` por un glifo.** Ni la nacionalidad ni el estado emisor están cubiertos
  por ningún dígito de control, así que los dos se leen mal con la misma facilidad; un glifo de más
  hizo que la nacionalidad saliera `BOO` mientras el emisor decía `BOL` sin dudar. Ahora tienen que
  fallar los dos: quien reetiqueta la plantilla de otro país deja los dos campos del país de origen,
  mientras que el reconocedor se equivoca en uno cada vez.

## Una comprobación que se probó y se RETIRÓ

Un corte por **vigencia no estándar**: el SEGIP expide cinco o diez años, así que un documento con
siete es sospechoso. La idea es buena y el dato no da para sostenerla. La caducidad suele venir de
la MRZ y trae dígito de control; la **emisión no está en la MRZ** y sólo existe impresa, en el
cuerpo más pequeño del anverso. La vigencia se calcularía restando un dato demostrado menos uno no
demostrado — y sobre las cinco cédulas la comprobación acusó a una, cuyo anverso imprime `23/06/2025`
y el reconocedor devolvió `23/08/2019`.

Queda escrito en el código, junto al sitio donde iría, para que no se vuelva a proponer sin resolver
antes de dónde sale la fecha de emisión.

## La selfie: lo que el antispoof no miraba

La prueba de vida existía, corría y estaba encendida en producción, y era **una**: las dos redes del
motor biométrico contestando «¿esto es un rostro delante de la cámara?». Contra el ataque más barato
del flujo, eso no dice nada.

El ataque es **subir como selfie la misma foto del carnet**. No hace falta parecerse al titular ni
tener la tarjeta: basta con tener su foto. Y contra el flujo que había no fallaba, **ganaba**: dos
recortes del mismo retrato son el parecido perfecto, o sea la puntuación más alta que este worker
puede dar. El antispoof no lo tapa, porque el retrato de un carnet es una fotografía de estudio de
una cara, no una pantalla.

`core/forensics/selfie-liveness.ts` añade tres comprobaciones:

| Señal | Qué cubre |
| --- | --- |
| `SELFIE_IS_DOCUMENT_IMAGE` | La selfie ES el documento. Corta la ejecución: no tiene lectura inocente. Se compara sobre los buffers ya normalizados, así que cambiar metadatos EXIF no la esquiva. |
| `SELFIE_MATCHES_DOCUMENT_TOO_EXACTLY` | Parecido ≥ 0,97. Cubre al que recorta el retrato o refotografía la pantalla: archivos distintos, contenido igual. Un par legítimo mide 0,66-0,92 en este repositorio, porque el retrato va tras el plastificado. |
| `SELFIE_REPHOTOGRAPH_SUSPECTED` | La rejilla de una pantalla o el marco negro de un dispositivo en la SELFIE. Es la misma forense que ya se le hacía al documento; que no se le aplicara a la otra imagen era una asimetría sin motivo. |

Las dos últimas **escalan a revisión** por la misma puerta que `MULTIPLE_FACES`, y tienen que
hacerlo: son la única clase de señal del worker que el motor de decisión ve al revés. Un parecido de
0,98 le llega como la mejor comparación posible y cierra un `VERIFIED` él solo.

## Cómo repetir la medición

```
yarn ts-node scripts/diagnosticar-carnets.ts <directorio>
```

Cada subdirectorio es una persona con sus dos caras; empareja por contenido y no por nombre de
archivo, porque las fotos llegan de mensajería con nombres que no dicen qué cara son. Publica el
encuadre, la cobertura del catálogo, la clasificación, los campos, los avisos y el veredicto de
fraude de cada una.

**No copia, no mueve y no escribe nada dentro del directorio de entrada, y no deja rastro en el
repositorio.** El directorio va FUERA del repositorio, y cuando termines, borra las fotos: **no hay
ni habrá imágenes de cédulas reales aquí**. Lo que sí queda versionado es la FORMA de las lecturas
degradadas, con datos inventados y dígitos de control recalculados, en
[`test/identity-degraded-ocr.spec.ts`](https://github.com/PabloArauzCaballero/AtlasDecisionEngineBackend/blob/main/test/identity-degraded-ocr.spec.ts) — y ésa es la
batería que hay que ampliar cuando aparezca otra cédula que falle.

## Dónde se mira

- Encuadre: `core/adapters/document-framing.ts`, aplicado desde `SharpImageAdapter.frame`.
- Analizador: `core/parsers/bolivia-ci-document.parser.ts` y `core/parsers/mrz-td1.ts`.
- Cotejo con posiciones: `core/catalog/approximate-match.ts`.
- Vida de la selfie: `core/forensics/selfie-liveness.ts`, desde `identity-pipeline.service.ts`.
- Pruebas: [`test/identity-degraded-ocr.spec.ts`](https://github.com/PabloArauzCaballero/AtlasDecisionEngineBackend/blob/main/test/identity-degraded-ocr.spec.ts) y
  [`test/identity-framing-and-liveness.spec.ts`](https://github.com/PabloArauzCaballero/AtlasDecisionEngineBackend/blob/main/test/identity-framing-and-liveness.spec.ts).
