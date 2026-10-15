/*
 * `C\.?\s?[I1L]\.?` y no `C\.?\s?I\.?`: es la unica tolerancia que se le
 * anade al anclaje absorbido, y responde a la confusion mas comun del OCR sobre
 * una cedula —la I mayuscula leida como 1 o como l minuscula—. Medido dentro
 * del contenedor: Tesseract devuelve `C.1. 1234567 SC` sobre una tarjeta
 * perfectamente legible, y sin esta tolerancia el numero se pierde y la
 * verificacion termina en revision manual por «campos ausentes».
 *
 * Es coherente con el propio analizador, que ya tolera distancia de edicion en
 * los nombres de mes por exactamente el mismo motivo.
 */
/*
 * `N[O°º*"'”’~^]` y no sólo `N[O°º]`: el ordinal volado de `N°` es el glifo más
 * pequeño del anverso y el reconocedor lo confunde con casi cualquier cosa.
 * Medido sobre una cédula boliviana real, el número más grande de la tarjeta
 * —`N° 7689658`, impreso en negro y a buen cuerpo— volvía como `N* 7689658`, y
 * sin esta tolerancia el ancla no casaba: el número IMPRESO se perdía, se
 * resolvía sólo por la MRZ y, al no coincidir el impreso con ella, el analizador
 * levantaba `DOCUMENT_MRZ_MISMATCH` —una marca de documento compuesto— sobre una
 * cédula auténtica cuyas dos caras dicen exactamente lo mismo.
 */
/*
 * `(?![\d-])` era `(?![\d-])`, y el guion de ese conjunto costaba un número entero.
 *
 * Estaba ahí para no morder el número de control, que lleva sufijo. El precio:
 * cualquier signo que el reconocedor cuelgue detrás del número IMPRESO mata el
 * anclaje, porque la expresión retrocede dígito a dígito y todas las
 * alternativas terminan mirando el mismo carácter. Medido sobre una cédula
 * boliviana auténtica del formato anterior, el anverso volvió como
 * `No-4521966-— 8 santa Gruz -—/AN`: el número estaba, el ancla `No` estaba, y
 * la única razón de que el expediente saliera sin número de documento era el
 * guion que el borde de la tarjeta deja pegado detrás.
 *
 * Ahora el sufijo se CAPTURA en vez de rechazarse —un complemento (`-1A`) es
 * parte legítima del número en el formato anterior— y lo que excluye el número
 * de control es su propia forma, que es donde siempre debió estar.
 *
 * `(?![0-9A-Z])` cierra el candidato en un límite de palabra, y hace falta
 * porque la clase que admite las confusiones de glifo incluye letras: sobre
 * `No. 4521966 de Santa Cruz`, sin este remate la expresión se llevaba la `D` de
 * `de` —que la reparación convierte en un cero— y el expediente guardaba
 * `45219660`, un número de ocho cifras con la forma correcta y **una cifra que no
 * existe**. Un número inventado con pinta de leído es peor que ninguno.
 *
 * Y los EXTREMOS tienen que ser dígitos de verdad: la reparación de glifos vale
 * dentro del número, no en sus puntas. Medido sobre una cédula auténtica, el
 * domicilio del reverso —`C. LOS ALAMOS NRO 3170 B, LOS G`— casaba con el ancla
 * `NRO`, se llevaba `3170 B`, la `B` se reparaba a `8` y el resultado, `31708`,
 * tenía cinco cifras y por tanto la forma de un número de cédula válido. Ese
 * número entraba en el expediente y, al no coincidir con el de la MRZ, la cédula
 * salía marcada con `DOCUMENT_MRZ_MISMATCH`: acusada de ser un documento
 * compuesto por el número de su propia calle.
 */
export const DOCUMENT_NUMBER_ANCHOR =
  /(?:^|\s)(?:N\s?[O°º*"'”’~^]\.?|NRO\.?|NUM(?:ERO)?\.?|C\.?\s?[I1L]\.?|N[?¿])\s*[:#.-]?\s*(\d[0-9OQDILSBZGT \u00b7.]{3,12}\d)(?![0-9A-Z])/;
/*
 * El número de CONTROL de impresión, que no es el de la cédula y se le parece.
 *
 * El patrón era `^(\d{5,10})\s+\d{2}\s?-\s?\d{2}$` — dígitos seguidos y sufijo
 * de dos cifras. Sobre la tarjeta real no casa nunca: el reverso del formato
 * anterior lo imprime **con los dígitos separados y con letra en el sufijo**
 * —medido: `3 468 674 08-L3`— así que el renglón entero se colaba como
 * candidato a número de cédula por la vía de los dígitos sueltos.
 *
 * Se acepta ahora la separación por espacios y el sufijo alfanumérico, y se
 * exige que sea el renglón COMPLETO: es lo que distingue el número de control
 * —que va solo, al pie— de un número de cédula rodeado de su rótulo.
 */
export const CONTROL_NUMBER_LINE = /^([\d ]{5,14})\s+[0-9A-Z]{2}\s?[-–]\s?[0-9A-Z]{2}$/;
export const STANDALONE_NUMBER_LINE = /^(\d{5,10})$/;
/*
 * `(?:^|\s)A` y no `^A`: el ancla del nombre del formato anterior es la letra
 * MÁS PEQUEÑA con la que se puede anclar nada, y por delante de ella el
 * reconocedor deja el borde de la tarjeta y los restos del sello. Medido sobre
 * cinco cédulas bolivianas auténticas, ni una sola línea de valor empezaba
 * limpia: `r - ANA LUCIA QUISPE MAMANI`, `e QUISPE MAMANI`, `S ANA LUCIA. $`.
 */
export const NAME_ANCHOR = /(?:^|\s)A\s*[:;.,]\s*(.+)$/;
export const BIRTH_ANCHOR = /(?:^|\s)NACID[OA]\s+EL\s+(.+)$/;
export const EXPIRY_ANCHOR = /(?:^|\s)VALID[AO]\s+HASTA(?:\s+EL)?\s*[:.]?\s*(.+)$/;
/*
 * El formato ANTERIOR no dice «válida hasta»: dice `Emitida el <fecha>` y
 * `Expira el <fecha>`, las dos en su propia línea y con el valor DETRÁS del
 * rótulo. No estaban, y su ausencia costaba la caducidad entera de esa
 * generación: medido sobre una cédula de 2023, el anverso imprime `Expira el 22
 * de Mayo de 2028`, se lee, y el expediente salía con `DOCUMENT_EXPIRY_NOT_FOUND`.
 */
export const EXPIRA_ANCHOR = /(?:^|\s)EXPIRA\s*(?:EL)?\s*[:.]?\s*(.+)$/;
export const EMITIDA_ANCHOR = /(?:^|\s)EMITID[AO]\s*(?:EL)?\s*[:.]?\s*(.+)$/;
export const PLACE_ANCHOR = /(?:^|\s)EN\s+(.{4,})$/;
// --- Formato vigente: los rótulos SON los anclajes ------------------------
/*
 * SIN `^`, y es el arreglo que más nombres recupera.
 *
 * Los rótulos del nombre son los únicos del anverso que van PEGADOS AL RETRATO,
 * y el reconocedor mete delante de ellos los glifos que cree ver en la foto.
 * Medido sobre cinco cédulas auténticas, el rótulo llegó como `Z NOMBRES:`,
 * `= APELLIDOS:` y `5 ; APELLIDOS` — ninguno empieza por su propia palabra, así
 * que ninguno casaba, y como `NOMBRES` y `APELLIDOS` tienen SIETE caracteres
 * están por debajo del mínimo del cotejo tolerante (ocho): no había segunda
 * oportunidad. El nombre se perdía entero en cédulas perfectamente legibles.
 *
 * Los rótulos de fecha ya toleraban un prefijo desde siempre
 * (`(?:^|\s)FECHA\s+DE\s+…`); esto es la misma tolerancia donde más falta hacía.
 */
export const LABEL_NOMBRES = /(?:^|\s)NOMBRES\s*[:.]?\s*(.*)$/;
export const LABEL_APELLIDOS = /(?:^|\s)APELLIDOS\s*[:.]?\s*(.*)$/;
export const LABEL_NACIMIENTO = /(?:^|\s)FECHA\s+DE\s+NACIMIENTO\s*[:.]?\s*(.*)$/;
export const LABEL_EXPIRACION =
  /(?:^|\s)FECHA\s+DE\s+(?:EXPIRACION|VENCIMIENTO|CADUCIDAD)\s*[:.]?\s*(.*)$/;
export const LABEL_EMISION = /(?:^|\s)FECHA\s+DE\s+EMISION\s*[:.]?\s*(.*)$/;
export const LABEL_LUGAR = /(?:^|\s)LUGAR\s+DE\s+NACIMIENTO\s*[:.]?\s*(.*)$/;
/**
 * Las mismas etiquetas, escritas como el TEXTO que la tarjeta imprime, para
 * cotejarlas con tolerancia cuando su expresión regular no encuentra nada.
 *
 * Es la misma corrección que en el catálogo y por el mismo motivo medido: los
 * rótulos de la cédula van en gris a cuerpo pequeño y el reconocedor los
 * devuelve mutilados. Sobre una cédula real, `FECHA DE EMISIÓN` volvió como
 * `FECHA DI EMIBION` y `FECHA DE EXPIRACIÓN` como `rca DE FAPIRACIÓN`: ninguna
 * de las dos casaba, así que la fecha de emisión salía vacía del expediente aun
 * estando impresa, legible y CORRECTAMENTE LEÍDA en el renglón de debajo.
 *
 * Sólo se cotean con tolerancia los rótulos de ocho caracteres o más y con una
 * edición por cada cinco (`approximate-match.ts`); los cortos siguen siendo
 * exactos.
 */
export const GRAFIAS_NOMBRES = ['NOMBRES'];
export const GRAFIAS_APELLIDOS = ['APELLIDOS'];
export const GRAFIAS_NACIMIENTO = ['FECHA DE NACIMIENTO'];
/*
 * `VENCIMIENTO` y `CADUCIDAD` sueltas están FUERA, y la ausencia está medida.
 *
 * `VENCIMIENTO` y `NACIMIENTO` comparten ocho de sus once caracteres finales, o
 * sea que caen dentro de la tolerancia una de la otra. Sobre una cédula real
 * pasó exactamente eso: la grafía de la caducidad casó con el renglón `FECHA DE
 * NACIMIENTO` y se llevó la fecha de debajo, así que el documento salía con la
 * fecha de nacimiento puesta como fecha de expiración —y como la MRZ decía otra
 * cosa, con `DOCUMENT_MRZ_MISMATCH`, una marca de documento compuesto sobre una
 * cédula auténtica cuyas dos caras coinciden—.
 *
 * Se conservan las formas LARGAS, que llevan `FECHA DE` delante y por tanto más
 * material que distinguir, y `EXPIRACION`, que no se parece a ningún otro rótulo
 * de la tarjeta. Las dos palabras sueltas siguen cubiertas por la expresión
 * regular exacta, que es la comprobación correcta cuando el rótulo se lee bien.
 */
export const GRAFIAS_EXPIRACION = ['FECHA DE EXPIRACION', 'EXPIRACION'];
export const GRAFIAS_EMISION = ['FECHA DE EMISION', 'FECHA DE EXPEDICION'];
/*
 * Los rótulos del formato ANTERIOR, que llevan el valor DETRÁS en la misma
 * línea, cotejados con tolerancia.
 *
 * Van aparte de las grafías de arriba porque se usan de otra manera: aquéllas
 * sólo sirven para señalar el renglón y leer el de DEBAJO —que es donde la
 * cédula vigente imprime sus valores—, y éstas necesitan saber dónde ACABA el
 * rótulo para quedarse con el resto de la línea. Eso es lo que hace
 * `valorTrasEtiqueta`.
 *
 * Las dos miden diez y nueve caracteres plegados, o sea que entran en el cotejo
 * tolerante (mínimo ocho) con una y dos ediciones. Y hacen falta: medido sobre
 * una cédula de 2023, `Expira el` volvió del reconocedor como `Exirael` —sin la
 * `p` y sin espacios— y ninguna expresión regular lo alcanza.
 */
export const GRAFIAS_EXPIRA_INLINE = ['EXPIRA EL'];
export const GRAFIAS_EMITIDA_INLINE = ['EMITIDA EL'];
export const GRAFIAS_LUGAR = ['LUGAR DE NACIMIENTO'];

/**
 * Rótulos que, si aparecen LITERALMENTE en un renglón, impiden que ese renglón
 * se le adjudique a otro campo por parecido.
 *
 * Es la segunda mitad de la corrección anterior y la que la hace general. La
 * primera quita una colisión concreta; ésta impide la clase entera: un renglón
 * que dice `NACIMIENTO` sin lugar a dudas no es el rótulo de la caducidad, por
 * mucho que se le parezca. Y al revés.
 */
export const EXCLUSIONES: Readonly<Record<string, RegExp>> = {
  NACIMIENTO: /\b(?:EXPIRACION|VENCIMIENTO|CADUCIDAD|EMISION|EXPEDICION)\b/,
  EXPIRACION: /\bNACIMIENTO\b/,
  EMISION: /\bNACIMIENTO\b/,
};

/**
 * Un renglón que es sólo un rótulo. Sirve para no tomar el rótulo siguiente
 * como si fuera el valor del anterior cuando el valor no se pudo leer.
 */
export const ES_ROTULO =
  /^(NOMBRES|APELLIDOS|SERIE|SECCION|FECHA\s+DE\s+\w+|LUGAR\s+DE\s+NACIMIENTO|DOMICILIO|PROFESION|ESTADO\s+CIVIL|GRUPO\s+SANGUINEO|NACIONALIDAD)\s*[:.]?\s*$/;
/**
 * El texto que la tarjeta imprime cuando NO caduca.
 *
 * No es un caso raro ni un defecto de lectura: el SEGIP emite cédulas de validez
 * indefinida en las dos generaciones —el formato anterior imprime `Válida hasta
 * el INDEFINIDO` y el vigente `FECHA DE EXPIRACIÓN: INDEFINIDO`— y dos de las
 * cinco cédulas auténticas medidas son así.
 *
 * Reconocerlo importa por dos motivos, los dos medidos:
 *
 * 1. **La caducidad dejaba de faltar y pasaba a ser FALSA.** El renglón del
 *    formato vigente lleva las dos fechas juntas —`25/11/2024   INDEFINIDO`— y
 *    la regla «de las fechas del renglón, la caducidad es la ÚLTIMA» devolvía la
 *    de EMISIÓN, porque es la única que hay. El expediente salía con una cédula
 *    vigente marcada como caducada en 2024.
 * 2. **Levantaba `DOCUMENT_MRZ_MISMATCH`**, que es una marca de documento
 *    compuesto, sobre una cédula auténtica: la MRZ codifica lo indefinido con
 *    una fecha centinela lejana —medido, `491125`, o sea 2049— porque la norma
 *    ICAO exige seis dígitos ahí y no admite «indefinido». Impreso y MRZ decían
 *    cosas distintas y las dos eran correctas.
 */
export const CADUCIDAD_INDEFINIDA = /INDEFINID[OA]|SIN\s*VENCIMIENTO|PERMANENTE/;

export const SERIE_ANCHOR = /(?:^|\s)SERIE\s*[:.]?\s*(\d{2,8})/;
export const SECTION_ANCHOR = /(?:^|\s)SECCION\s*[:.]?\s*(\d{2,8})/;
/*
 * Líneas que llevan dígitos pero nunca el número de cédula. `NOMBRES` entra en
 * la lista por una razón sutil: empieza por `NO`, que es justamente el anclaje
 * del número, y en el formato vigente va seguida del nombre — pero si el OCR
 * pega dos renglones, `NOMBRES: MARIA ... 1234567` daría un número falso.
 */
export const NUMBER_NOISE = /SERIE|SECCION|LOT|BARCODE|DOMICILIO|NOMBRES|APELLIDOS|N\.\s*\d/;
