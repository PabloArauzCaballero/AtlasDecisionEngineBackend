import { Injectable } from '@nestjs/common';
import { IdentityDocumentType } from '../domain/identity-enums';
import type { ExtractedField } from '../domain/extracted-identity.types';
import type { DocumentOcrResult } from '../ports/identity.ports';
import type { DocumentParser, DocumentParserInput, ParsedDocument } from './document-parser';
import { parseMrzTd1, type MrzTd1 } from './mrz-td1';
import { parseSpanishDate } from './spanish-date';
import { collapseWhitespace, normalizeForMatch, toLines } from './text-normalization';
import { casarGrafias, plegarParaCotejo, valorTrasEtiqueta } from '../catalog/approximate-match';
import { NOMBRES_DE_DEPARTAMENTO, esNumeroDeCedulaValido } from '../catalog/bolivia-ci.catalog';

/**
 * Analizador de la cédula de identidad boliviana (tarjeta ID-1, dos caras).
 * **Absorbido sin cambios**: es el conocimiento de dominio del paquete original.
 *
 * Lee los DOS formatos que hay hoy en circulación, porque los dos se presentan:
 *
 * **Formato anterior** — sin etiquetas. Sus anclajes son la propia redacción:
 *
 *   anverso  `No <número>`, `Válida hasta el <fecha>`, `serie`, `sección`
 *   reverso  `A: <nombre completo>`, `Nacido el <fecha>`, `En <lugar>`
 *
 * **Formato vigente** — campos rotulados y MRZ. Aquí los anclajes son las
 * propias etiquetas, y el reverso trae la zona de lectura mecánica:
 *
 *   anverso  `NOMBRES:`, `APELLIDOS:`, `FECHA DE NACIMIENTO:`,
 *            `FECHA DE EXPIRACIÓN:`, `N° <número>`, `SERIE:`, `SECCIÓN:`
 *   reverso  `LUGAR DE NACIMIENTO:`, `DOMICILIO:`, MRZ TD1 de tres renglones
 *
 * **La MRZ manda cuando sus dígitos de control cuadran.** No es una preferencia
 * estética: la MRZ existe para que la lea una máquina y trae con qué comprobar
 * que se leyó bien, mientras que el texto impreso sólo se puede leer y confiar.
 * Cuando las dos fuentes discrepan, gana la que puede demostrarse.
 *
 * Las dos caras imprimen además un segundo número de siete dígitos (el de
 * control de impresión) que no debe confundirse con el de la cédula; en el
 * anverso va seguido de un sufijo `NN-NN`, que es lo que permite excluirlo.
 */

interface SourceLine {
  text: string;
  normalized: string;
  confidence: number | null;
}

interface Extraction {
  value: string;
  confidence: number | null;
}

/** Códigos de aviso que este analizador puede levantar. */
export const BOLIVIA_CI_WARNINGS = {
  documentNumberNotFound: 'DOCUMENT_NUMBER_NOT_FOUND',
  nameNotFound: 'NAME_NOT_FOUND',
  dateOfBirthNotFound: 'DATE_OF_BIRTH_NOT_FOUND',
  expiryNotFound: 'DOCUMENT_EXPIRY_NOT_FOUND',
  unparsableDateOfBirth: 'DATE_OF_BIRTH_UNPARSABLE',
  unparsableExpiry: 'DOCUMENT_EXPIRY_UNPARSABLE',
  nameSplitHeuristic: 'NAME_SPLIT_HEURISTIC',
  /** El anverso y la MRZ del reverso no dicen lo mismo. */
  mrzMismatch: 'DOCUMENT_MRZ_MISMATCH',
  /** El nombre impreso y el de la MRZ no son el mismo nombre. */
  nameMrzMismatch: 'NAME_MRZ_MISMATCH',
  /** El rótulo del nombre se leyó, pero lo que había debajo no era un nombre. */
  printedNameUnusable: 'PRINTED_NAME_UNUSABLE',
  /** La MRZ se leyó, pero su control compuesto no cuadra. */
  mrzCheckFailed: 'DOCUMENT_MRZ_CHECK_FAILED',
  /**
   * Las FECHAS impresas no coinciden con las de la MRZ, pero el número y el
   * nombre sí.
   *
   * Es deliberadamente un aviso distinto de `DOCUMENT_MRZ_MISMATCH`, y la
   * diferencia es de qué acusa cada uno. El número y el nombre identifican a la
   * persona: que el anverso y el reverso digan personas distintas es un montaje.
   * Las fechas, en cambio, van en el cuerpo más pequeño del anverso y sobre el
   * guilloché, que es donde el reconocedor falla — medido sobre una cédula
   * auténtica, `13/01/2031` volvió como `13/04/2034`.
   *
   * Un falsificador que acierte el número y el nombre y falle las dos fechas no
   * existe; un OCR que haga eso es lo normal. Mantenerlos bajo la misma marca
   * hacía que una cédula legítima llegara al análisis de fraude con la señal más
   * grave que este analizador puede levantar.
   */
  mrzDateMismatch: 'DOCUMENT_MRZ_DATE_MISMATCH',
  /**
   * La tarjeta declara que NO caduca. No es un campo ausente ni un fallo de
   * lectura: es lo que el SEGIP imprime, y sin distinguirlo el expediente
   * quedaba igual que el de una cédula cuya caducidad no se pudo leer.
   */
  expiryIndefinite: 'DOCUMENT_EXPIRY_INDEFINITE',
} as const;

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
const DOCUMENT_NUMBER_ANCHOR =
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
const CONTROL_NUMBER_LINE = /^([\d ]{5,14})\s+[0-9A-Z]{2}\s?[-–]\s?[0-9A-Z]{2}$/;
const STANDALONE_NUMBER_LINE = /^(\d{5,10})$/;

/**
 * Deshace las confusiones de glifo en algo que YA es casi todo dígitos.
 *
 * Es la misma tabla que usa la MRZ y por la misma razón —la `O` y el `0`, la `T`
 * y el `7` son el mismo trazo a poca resolución— pero aquí no hay una norma que
 * garantice que la posición sea numérica, así que la garantía la pone el
 * CONTEXTO: sólo se repara lo que va detrás del ancla `N°`/`No`/`C.I.`, que es
 * el único sitio del anverso donde la tarjeta imprime un número de cédula.
 *
 * Y aun así se exige que la MAYORÍA de los caracteres ya fueran dígitos. Sin esa
 * condición, `No SOLTERO` se convertiría en un número: reparar un texto que no
 * era un número no lo corrige, lo inventa.
 */
function repararDigitos(bruto: string): string | null {
  const limpio = bruto.replace(/[\s\u00b7.]/g, '');
  if (limpio.length === 0) return null;
  const yaDigitos = (limpio.match(/\d/g) ?? []).length;
  if (yaDigitos * 2 < limpio.length) return null;
  const reparado = [...limpio]
    .map((caracter) => CONFUSIONES_A_DIGITO[caracter] ?? caracter)
    .join('');
  return /^\d+$/.test(reparado) ? reparado : null;
}

/** Las confusiones que un reconocedor comete sobre cifras impresas grandes. */
const CONFUSIONES_A_DIGITO: Record<string, string> = {
  O: '0',
  Q: '0',
  D: '0',
  I: '1',
  L: '1',
  S: '5',
  B: '8',
  Z: '2',
  G: '6',
  T: '7',
};
/*
 * `(?:^|\s)A` y no `^A`: el ancla del nombre del formato anterior es la letra
 * MÁS PEQUEÑA con la que se puede anclar nada, y por delante de ella el
 * reconocedor deja el borde de la tarjeta y los restos del sello. Medido sobre
 * cinco cédulas bolivianas auténticas, ni una sola línea de valor empezaba
 * limpia: `r - ANA LUCIA QUISPE MAMANI`, `e QUISPE MAMANI`, `S ANA LUCIA. $`.
 */
const NAME_ANCHOR = /(?:^|\s)A\s*[:;.,]\s*(.+)$/;
const BIRTH_ANCHOR = /(?:^|\s)NACID[OA]\s+EL\s+(.+)$/;
const EXPIRY_ANCHOR = /(?:^|\s)VALID[AO]\s+HASTA(?:\s+EL)?\s*[:.]?\s*(.+)$/;
/*
 * El formato ANTERIOR no dice «válida hasta»: dice `Emitida el <fecha>` y
 * `Expira el <fecha>`, las dos en su propia línea y con el valor DETRÁS del
 * rótulo. No estaban, y su ausencia costaba la caducidad entera de esa
 * generación: medido sobre una cédula de 2023, el anverso imprime `Expira el 22
 * de Mayo de 2028`, se lee, y el expediente salía con `DOCUMENT_EXPIRY_NOT_FOUND`.
 */
const EXPIRA_ANCHOR = /(?:^|\s)EXPIRA\s*(?:EL)?\s*[:.]?\s*(.+)$/;
const EMITIDA_ANCHOR = /(?:^|\s)EMITID[AO]\s*(?:EL)?\s*[:.]?\s*(.+)$/;
const PLACE_ANCHOR = /(?:^|\s)EN\s+(.{4,})$/;
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
const LABEL_NOMBRES = /(?:^|\s)NOMBRES\s*[:.]?\s*(.*)$/;
const LABEL_APELLIDOS = /(?:^|\s)APELLIDOS\s*[:.]?\s*(.*)$/;
const LABEL_NACIMIENTO = /(?:^|\s)FECHA\s+DE\s+NACIMIENTO\s*[:.]?\s*(.*)$/;
const LABEL_EXPIRACION =
  /(?:^|\s)FECHA\s+DE\s+(?:EXPIRACION|VENCIMIENTO|CADUCIDAD)\s*[:.]?\s*(.*)$/;
const LABEL_EMISION = /(?:^|\s)FECHA\s+DE\s+EMISION\s*[:.]?\s*(.*)$/;
const LABEL_LUGAR = /(?:^|\s)LUGAR\s+DE\s+NACIMIENTO\s*[:.]?\s*(.*)$/;

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
const GRAFIAS_NOMBRES = ['NOMBRES'];
const GRAFIAS_APELLIDOS = ['APELLIDOS'];
const GRAFIAS_NACIMIENTO = ['FECHA DE NACIMIENTO'];
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
const GRAFIAS_EXPIRACION = ['FECHA DE EXPIRACION', 'EXPIRACION'];
const GRAFIAS_EMISION = ['FECHA DE EMISION', 'FECHA DE EXPEDICION'];
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
const GRAFIAS_EXPIRA_INLINE = ['EXPIRA EL'];
const GRAFIAS_EMITIDA_INLINE = ['EMITIDA EL'];
const GRAFIAS_LUGAR = ['LUGAR DE NACIMIENTO'];

/**
 * Rótulos que, si aparecen LITERALMENTE en un renglón, impiden que ese renglón
 * se le adjudique a otro campo por parecido.
 *
 * Es la segunda mitad de la corrección anterior y la que la hace general. La
 * primera quita una colisión concreta; ésta impide la clase entera: un renglón
 * que dice `NACIMIENTO` sin lugar a dudas no es el rótulo de la caducidad, por
 * mucho que se le parezca. Y al revés.
 */
const EXCLUSIONES: Readonly<Record<string, RegExp>> = {
  NACIMIENTO: /\b(?:EXPIRACION|VENCIMIENTO|CADUCIDAD|EMISION|EXPEDICION)\b/,
  EXPIRACION: /\bNACIMIENTO\b/,
  EMISION: /\bNACIMIENTO\b/,
};

/**
 * Un renglón que es sólo un rótulo. Sirve para no tomar el rótulo siguiente
 * como si fuera el valor del anterior cuando el valor no se pudo leer.
 */
const ES_ROTULO =
  /^(NOMBRES|APELLIDOS|SERIE|SECCION|FECHA\s+DE\s+\w+|LUGAR\s+DE\s+NACIMIENTO|DOMICILIO|PROFESION|ESTADO\s+CIVIL|GRUPO\s+SANGUINEO|NACIONALIDAD)\s*[:.]?\s*$/;

/**
 * ¿Lo que acompaña al rótulo en su línea parece un valor, o es ruido?
 *
 * El retrato del titular va al lado de los rótulos, y el reconocedor mete en el
 * mismo renglón los glifos que cree ver dentro de la foto. Sobre una cédula
 * perfectamente legible devolvió `NOMBRES í Y`, y tomarlo por bueno producía el
 * nombre «I Y RODRIGUEZ GONZALEZ»: un dato inventado con toda la pinta de uno
 * leído, que es la peor clase de dato en un expediente de identidad.
 *
 * El criterio es una TIRA SEGUIDA de al menos tres caracteres alfanuméricos.
 * Una palabra la tiene; una fecha la tiene en su año. El ruido del reconocedor
 * llega en letras sueltas separadas por espacios, y no la tiene. Cuando no la
 * hay se sigue mirando el renglón de debajo, que es donde vive el valor.
 */
function pareceValor(texto: string): boolean {
  return /[\p{L}\p{N}]{3,}/u.test(texto);
}

/**
 * Quita la COLA de ruido que el retrato deja pegada al valor.
 *
 * El mismo fenómeno que arriba, un renglón más abajo: el valor está donde debe
 * —`MARIA RENEE`— pero el reconocedor le añade lo que cree ver en la cara que
 * tiene al lado, y devuelve `MARIA RENEE Oo o |`. Sin esto, el nombre completo
 * salía «MARIA RENEE Oo o | RODRIGUEZ GONZALEZ».
 *
 * Se recorta sólo por el FINAL y sólo mientras el último trozo sea corto: un
 * nombre castellano no termina en una palabra de dos letras, pero sí puede
 * llevarlas en medio —«JOSE DE LA CRUZ»—, así que quitarlas donde quiera que
 * aparecieran sí rompería nombres de verdad.
 *
 * Se intentó resolver antes, filtrando por la confianza que da el reconocedor
 * palabra a palabra, y NO sirve: medido sobre esa tarjeta, esos glifos llegan
 * con 60, 83 y 94 —está seguro de lo que ve— mientras que el `N°` que precede al
 * número llega con 28. El corte tiraba un anclaje bueno y dejaba pasar el ruido.
 */
/**
 * ¿Esto puede ser el nombre de una persona?
 *
 * Flojo a propósito: tres letras o más en total y al menos una palabra de dos,
 * sin cifras. Un apellido puede ser prácticamente cualquier cosa, así que lo
 * único que se descarta es lo que NO puede serlo — los glifos sueltos que el
 * reconocedor saca del retrato (`í Y`, `CMI`, `Priti`) y las tiras con números.
 */
function pareceNombre(valor: string | null | undefined): boolean {
  if (!valor) return false;
  const texto = valor.trim();
  if (/\d/u.test(texto)) return false;
  const letras = (texto.match(/\p{L}/gu) ?? []).length;
  if (letras < 3) return false;
  return texto.split(/\s+/).some((palabra) => (palabra.match(/\p{L}/gu) ?? []).length >= 2);
}

/**
 * ¿Estos dos textos nombran a la misma persona?
 *
 * La MRZ trunca a treinta caracteres y sustituye los espacios por `<`, así que
 * la comparación tiene que ser por PREFIJO sobre las letras sueltas: el impreso
 * `MARIA RENEE` y el de la MRZ `MARIA<RENE` son el mismo nombre, y exigir
 * igualdad exacta convertiría la norma de la ICAO en una discrepancia.
 */
/** ¿Contiene el primero al segundo desde el principio, ya plegados a letras? */
function empiezaPor(largo: string, corto: string): boolean {
  const a = plegarNombre(largo);
  const b = plegarNombre(corto);
  return a.length > 0 && b.length > 0 && a.startsWith(b);
}

function plegarNombre(valor: string): string {
  return valor
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toUpperCase()
    .replace(/[^A-Z]/gu, '');
}

function mismoNombre(izquierda: string, derecha: string): boolean {
  const plegar = (valor: string): string =>
    valor
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/gu, '')
      .toUpperCase()
      .replace(/[^A-Z]/gu, '');
  const a = plegar(izquierda);
  const b = plegar(derecha);
  if (!a || !b) return true;
  if (a.startsWith(b) || b.startsWith(a)) return true;
  /*
   * Y una edición por cada ocho caracteres, que es lo que separa un nombre MAL
   * LEÍDO de un nombre DISTINTO.
   *
   * El prefijo solo no bastaba, y el fallo está medido sobre una cédula
   * boliviana auténtica: el rótulo de los apellidos va pegado al retrato, el
   * reconocedor se comió la primera letra y devolvió `UISPE MAMANI` donde la
   * MRZ dice `QUISPE MAMANI`. Ninguno de los dos es prefijo del otro —la
   * diferencia está al principio— así que la cédula levantaba
   * `NAME_MRZ_MISMATCH`, que es una marca de documento compuesto.
   *
   * Un carácter sobre dieciséis no es otra persona: es el mismo nombre con una
   * letra perdida. Dos apellidos distintos difieren en mucho más que eso, y la
   * tolerancia es la misma proporción que el catálogo ya aplica a sus rótulos.
   */
  const tolerancia = Math.max(1, Math.floor(Math.max(a.length, b.length) / 8));
  return distanciaDeEdicion(a, b, tolerancia) <= tolerancia;
}

/**
 * Distancia de Levenshtein con corte: en cuanto la fila entera se pasa del tope
 * no hay continuación que baje de ahí, porque cada paso sólo suma.
 */
function distanciaDeEdicion(a: string, b: string, tope: number): number {
  if (Math.abs(a.length - b.length) > tope) return tope + 1;
  let previa = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const actual = new Array<number>(b.length + 1);
    actual[0] = i;
    let minimo = i;
    for (let j = 1; j <= b.length; j += 1) {
      const valor = Math.min(
        (previa[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
        (previa[j] ?? 0) + 1,
        (actual[j - 1] ?? 0) + 1,
      );
      actual[j] = valor;
      if (valor < minimo) minimo = valor;
    }
    if (minimo > tope) return tope + 1;
    previa = actual;
  }
  return previa[b.length] ?? tope + 1;
}

function sinColaDeRuido(texto: string): string {
  const trozos = texto.split(/\s+/).filter(Boolean);
  while (trozos.length > 1 && !/[\p{L}\p{N}]{3,}/u.test(trozos[trozos.length - 1] ?? '')) {
    trozos.pop();
  }
  return trozos.join(' ');
}

/**
 * Y la CABEZA, que es por donde entra el ruido de verdad.
 *
 * `sinColaDeRuido` recortaba sólo por el final, y la medición sobre cinco
 * cédulas bolivianas auténticas dice que el ruido llega sobre todo por DELANTE:
 * el valor está impreso a la derecha del retrato, y a la izquierda del renglón
 * quedan el borde de la tarjeta, el número vertical en rojo y los restos del
 * sello. Lo que devolvió el reconocedor, literal:
 *
 *   `” .UISPE MAMANI`     `e QUISPE MAMANI`     `S ANA LUCIA. $`
 *   `5 ANA LUCIA >= |`     `r - ANA LUCIA QUISPE MAMANI`
 *
 * Sin este recorte, esos glifos viajaban al expediente COMO PARTE DEL NOMBRE de
 * una persona, y además rompían el cotejo con la MRZ —`” .UISPE MAMANI` no es
 * prefijo de `QUISPE MAMANI`— así que una cédula auténtica levantaba
 * `NAME_MRZ_MISMATCH`, que es una marca de documento compuesto.
 *
 * El criterio es simétrico al de la cola y por lo mismo: se quitan los trozos
 * iniciales que no lleven una tira seguida de tres alfanuméricos. Un nombre
 * castellano no EMPIEZA por una palabra de dos letras —«DE LA CRUZ» va en medio—
 * y el ruido del reconocedor llega justamente así, en glifos sueltos.
 */
function sinCabezaDeRuido(texto: string): string {
  const trozos = texto.split(/\s+/).filter(Boolean);
  while (trozos.length > 1 && !/[\p{L}\p{N}]{3,}/u.test(trozos[0] ?? '')) {
    trozos.shift();
  }
  return trozos.join(' ');
}

/**
 * Las dos puntas, más los signos que cuelgan de los extremos.
 *
 * Los signos se quitan aparte de los trozos porque van PEGADOS a la palabra y no
 * sueltos: `ANA LUCIA. $` pierde el `$` como trozo y la `.` como signo, y `.UISPE`
 * conserva su cuerpo. Sólo se tocan los extremos —un `D'ANDREA` o un `PEREZ-GIL`
 * llevan el signo en medio y son nombres de verdad—.
 */
function limpiarValor(texto: string): string {
  return sinCabezaDeRuido(sinColaDeRuido(texto))
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .replace(/[^\p{L}\p{N}]+$/u, '')
    .trim();
}

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
const CADUCIDAD_INDEFINIDA = /INDEFINID[OA]|SIN\s*VENCIMIENTO|PERMANENTE/;

const SERIE_ANCHOR = /(?:^|\s)SERIE\s*[:.]?\s*(\d{2,8})/;
const SECTION_ANCHOR = /(?:^|\s)SECCION\s*[:.]?\s*(\d{2,8})/;
/*
 * Líneas que llevan dígitos pero nunca el número de cédula. `NOMBRES` entra en
 * la lista por una razón sutil: empieza por `NO`, que es justamente el anclaje
 * del número, y en el formato vigente va seguida del nombre — pero si el OCR
 * pega dos renglones, `NOMBRES: MARIA ... 1234567` daría un número falso.
 */
const NUMBER_NOISE = /SERIE|SECCION|LOT|BARCODE|DOMICILIO|NOMBRES|APELLIDOS|N\.\s*\d/;

@Injectable()
export class BoliviaCiDocumentParser implements DocumentParser {
  supports(context: { type: IdentityDocumentType; country: string }): boolean {
    return (
      context.type === IdentityDocumentType.BOLIVIA_CI && context.country.toUpperCase() === 'BO'
    );
  }

  async parse(input: DocumentParserInput): Promise<ParsedDocument> {
    const lines = this.sourceLines(input.ocr);
    const warnings: string[] = [];

    // La MRZ primero: si valida, es la fuente que se puede demostrar.
    const mrz = parseMrzTd1(input.ocr.rawText);

    // Impreso: se buscan los anclajes de los DOS formatos y gana el que aparezca.
    const documentNumber = this.documentNumber(lines);
    const nombres = this.labelled(lines, LABEL_NOMBRES, GRAFIAS_NOMBRES);
    const apellidos = this.labelled(lines, LABEL_APELLIDOS, GRAFIAS_APELLIDOS);
    const fullName = this.fullName(lines) ?? this.nombrePorVecindad(lines);
    const birth =
      this.labelled(lines, LABEL_NACIMIENTO, GRAFIAS_NACIMIENTO, EXCLUSIONES.NACIMIENTO) ??
      this.anchored(lines, BIRTH_ANCHOR);
    const expiry =
      this.labelled(lines, LABEL_EXPIRACION, GRAFIAS_EXPIRACION, EXCLUSIONES.EXPIRACION) ??
      this.anchored(lines, EXPIRY_ANCHOR) ??
      /*
       * `Expira el <fecha>` — el rótulo del formato ANTERIOR, que no estaba.
       * Va el último de los tres porque es el más laxo: `EXPIRA` es una palabra
       * corriente y los dos anclajes de arriba nombran el campo sin ambigüedad.
       */
      this.anchored(lines, EXPIRA_ANCHOR) ??
      this.anchoredTolerante(lines, GRAFIAS_EXPIRA_INLINE);
    const issue =
      this.labelled(lines, LABEL_EMISION, GRAFIAS_EMISION, EXCLUSIONES.EMISION) ??
      this.anchored(lines, EMITIDA_ANCHOR) ??
      this.anchoredTolerante(lines, GRAFIAS_EMITIDA_INLINE);

    /*
     * ¿Dice la tarjeta que NO caduca?
     *
     * Se mira en el renglón de la caducidad y, si no hubo renglón, en el texto
     * entero: el formato anterior lo imprime como `Válida hasta el INDEFINIDO`
     * —dos renglones a veces— y el vigente como el valor del campo. Se comprueba
     * ANTES de intentar leer una fecha, porque el renglón del formato vigente
     * trae las dos fechas juntas y la regla «la caducidad es la última fecha del
     * renglón» devuelve la de EMISIÓN cuando la de caducidad no es una fecha.
     */
    const caducidadIndefinida = expiry
      ? CADUCIDAD_INDEFINIDA.test(normalizeForMatch(expiry.value))
      : lines.some((line) => CADUCIDAD_INDEFINIDA.test(line.normalized));
    const placeOfBirth =
      this.labelled(lines, LABEL_LUGAR, GRAFIAS_LUGAR) ??
      this.placeOfBirth(lines) ??
      this.placeOfBirthPorDepartamento(lines);

    const dateOfBirth = this.normalizedDate(birth);
    // La ÚLTIMA de las fechas del renglón: la emisión va antes que la expiración.
    // Salvo que la tarjeta diga que no caduca: entonces la única fecha del
    // renglón es la de EMISIÓN, y tomarla como caducidad declara caducado en
    // 2024 un documento que no vence nunca.
    const expirationDate = caducidadIndefinida ? null : this.normalizedDate(expiry, 'ultima');

    /*
     * Resolución de cada campo: MRZ validada > texto impreso.
     *
     * Y cuando las dos existen y NO coinciden, se avisa. Un anverso y un
     * reverso que no dicen lo mismo es la firma de un documento compuesto, no
     * un problema de lectura, y esconderlo detrás de «la MRZ manda» sería
     * quedarse con el dato bueno y tirar la señal.
     */
    const numero = this.preferir(mrz?.documentNumber ?? null, documentNumber?.value ?? null);
    const nacimiento = this.preferir(mrz?.birthDate ?? null, dateOfBirth?.value ?? null);
    const caducidad = this.preferir(mrz?.expirationDate ?? null, expirationDate?.value ?? null);
    /*
     * La caducidad indefinida NO cuenta como discrepancia con la MRZ.
     *
     * La norma ICAO exige seis dígitos en el campo de caducidad y no admite
     * «indefinido», así que el SEGIP codifica lo indefinido con una fecha
     * centinela lejana: medido sobre una cédula auténtica cuyo anverso imprime
     * `FECHA DE EXPIRACIÓN: INDEFINIDO`, su MRZ dice `491125`, o sea 2049. El
     * impreso y la MRZ dicen cosas distintas y las DOS son correctas — no es un
     * documento compuesto, es cómo se escribe «no caduca» en una zona de lectura
     * mecánica. Sin esta excepción, la cédula salía marcada con
     * `DOCUMENT_MRZ_MISMATCH`, que es una señal de fraude.
     */
    /*
     * El número discrepa → documento compuesto. Sólo las fechas → mala lectura.
     *
     * Ver `mrzDateMismatch`: son dos acusaciones distintas y antes compartían
     * marca, así que una cédula auténtica con una fecha mal leída llegaba al
     * análisis de fraude con la señal de montaje.
     */
    const fechasDiscrepan = nacimiento.discrepa || (caducidad.discrepa && !caducidadIndefinida);
    if (numero.discrepa) warnings.push(BOLIVIA_CI_WARNINGS.mrzMismatch);
    else if (fechasDiscrepan) warnings.push(BOLIVIA_CI_WARNINGS.mrzDateMismatch);
    if (mrz && !mrz.checks.composite) warnings.push(BOLIVIA_CI_WARNINGS.mrzCheckFailed);

    /*
     * El nombre sale, por este orden, de: la MRZ, los rótulos del formato
     * vigente, o el corte por convención del formato anterior. Sólo el último
     * es una suposición, y sólo ése levanta el aviso.
     */
    const partes = this.resolverNombre(mrz, nombres, apellidos, fullName);
    if (partes.heuristico) warnings.push(BOLIVIA_CI_WARNINGS.nameSplitHeuristic);
    if (partes.rotuloIlegible) warnings.push(BOLIVIA_CI_WARNINGS.printedNameUnusable);
    if (partes.discrepaConMrz) warnings.push(BOLIVIA_CI_WARNINGS.nameMrzMismatch);

    if (!numero.valor) warnings.push(BOLIVIA_CI_WARNINGS.documentNumberNotFound);
    if (!partes.firstNames && !partes.lastNames && !partes.fullName) {
      warnings.push(BOLIVIA_CI_WARNINGS.nameNotFound);
    }
    if (!birth && !mrz?.birthDate) warnings.push(BOLIVIA_CI_WARNINGS.dateOfBirthNotFound);
    else if (!nacimiento.valor) warnings.push(BOLIVIA_CI_WARNINGS.unparsableDateOfBirth);
    if (caducidadIndefinida) warnings.push(BOLIVIA_CI_WARNINGS.expiryIndefinite);
    else if (!expiry && !mrz?.expirationDate) warnings.push(BOLIVIA_CI_WARNINGS.expiryNotFound);
    else if (!caducidad.valor) warnings.push(BOLIVIA_CI_WARNINGS.unparsableExpiry);

    const desdeMrz = (usada: boolean): ExtractedField<string>['source'] => (usada ? 'MRZ' : 'OCR');

    return {
      fields: {
        documentType: this.field('BOLIVIA_CI', 1, 'DERIVED'),
        documentNumber: this.field(
          numero.valor,
          documentNumber?.confidence ?? null,
          desdeMrz(numero.deMrz),
        ),
        fullName: this.field(partes.fullName, fullName?.confidence ?? null),
        firstNames: this.field(
          partes.firstNames,
          fullName?.confidence ?? null,
          partes.heuristico ? 'DERIVED' : desdeMrz(partes.deMrz),
        ),
        lastNames: this.field(
          partes.lastNames,
          fullName?.confidence ?? null,
          partes.heuristico ? 'DERIVED' : desdeMrz(partes.deMrz),
        ),
        dateOfBirth: this.field(
          nacimiento.valor,
          birth?.confidence ?? null,
          desdeMrz(nacimiento.deMrz),
        ),
        expirationDate: this.field(
          caducidad.valor,
          expiry?.confidence ?? null,
          desdeMrz(caducidad.deMrz),
        ),
        // Y la PRIMERA para la emisión, por el mismo motivo al revés.
        issueDate: this.field(
          this.normalizedDate(issue, 'primera')?.value ?? null,
          issue?.confidence ?? null,
        ),
        placeOfBirth: this.field(placeOfBirth?.value ?? null, placeOfBirth?.confidence ?? null),
        ...(mrz?.sex ? { sex: this.field(mrz.sex, 1, 'MRZ') } : {}),
        /*
         * La NACIONALIDAD de la MRZ no la cubre ningún dígito de control.
         *
         * El compuesto de una TD1 abarca el número, las dos fechas y sus
         * controles —posiciones 5-30 del primer renglón y 0-7, 8-15 y 18-29 del
         * segundo—, y la nacionalidad vive en 15-18: fuera. Marcarla «MRZ» hacía
         * que la pantalla la enseñara como VERIFICADA, y se vio en una captura
         * diciendo «B0L» con un cero: un dato mal leído, presentado como
         * comprobado. Se declara DEDUCIDA, que es lo que es.
         *
         * Y se prefiere el estado emisor cuando sí cuadra el compuesto: para una
         * cédula boliviana la nacionalidad se implica del emisor con más
         * seguridad que de tres letras sueltas sin verificar.
         */
        /*
         * Ya no se exige el control COMPUESTO para decir «BOLIVIANA».
         *
         * La condición era `checks.composite && issuingState === 'BOL'`, y sobre
         * una cédula real el compuesto falla con facilidad —basta un glifo de
         * más al principio de un renglón— así que el campo caía al código crudo
         * de la MRZ y la pantalla enseñaba cosas como `B0L`. Exigir un control
         * que no cubre este campo para decidir este campo nunca tuvo sentido: el
         * compuesto abarca el número y las dos fechas, y la nacionalidad vive
         * fuera de su alcance.
         *
         * Basta con que ALGUNO de los dos códigos de la MRZ diga BOL —ya
         * normalizados a letras, que es lo que la norma garantiza que son—. Y
         * sigue siendo DERIVED: es una deducción del emisor, no un dato leído.
         */
        nationality: this.field(
          mrz?.nationality === 'BOL' || mrz?.issuingState === 'BOL'
            ? 'BOLIVIANA'
            : (mrz?.nationality ?? 'BOLIVIANA'),
          1,
          'DERIVED',
        ),
        country: this.field('BO', 1, 'DERIVED'),
      },
      warnings,
    };
  }

  /**
   * Elige entre lo que dice la MRZ y lo que dice el texto impreso.
   *
   * `discrepa` sólo es cierto cuando las DOS fuentes tienen valor y no
   * coinciden: que falte una no es una contradicción, es una cara que no se
   * fotografió.
   */
  private preferir(
    deMrz: string | null,
    impreso: string | null,
  ): { valor: string | null; deMrz: boolean; discrepa: boolean } {
    /*
     * UNA cifra de diferencia no es una discrepancia: es una mala lectura.
     *
     * La marca `DOCUMENT_MRZ_MISMATCH` significa «el anverso y el reverso
     * pertenecen a documentos distintos», que es la firma de un montaje. Un
     * montaje no se equivoca en un dígito: copia una plantilla y escribe datos
     * que no cuadran con nada. Lo que sí se equivoca en un dígito es el
     * reconocedor sobre el texto impreso, y sobre una cédula boliviana auténtica
     * pasó: el anverso imprime `13/01/2031` y volvió `13/01/2034`, así que una
     * cédula legítima salía marcada como documento compuesto.
     *
     * La comparación es asimétrica a propósito. La MRZ trae dígitos de control
     * y ya se comprobaron —si no cuadraran, su campo sería `null` y no
     * llegaríamos aquí—; lo impreso sólo se puede leer y confiar. Así que cuando
     * las dos fuentes se parecen tanto que sólo pueden ser la misma, gana la que
     * puede demostrarse y no se avisa de nada. A partir de DOS caracteres de
     * diferencia el aviso vuelve, porque ahí ya no se explica por una errata.
     */
    const discrepa = Boolean(
      deMrz && impreso && deMrz !== impreso && distanciaDeEdicion(deMrz, impreso, 1) > 1,
    );
    if (deMrz) return { valor: deMrz, deMrz: true, discrepa };
    return { valor: impreso, deMrz: false, discrepa };
  }

  /** Nombre y apellidos, por orden de fiabilidad decreciente. */
  private resolverNombre(
    mrz: MrzTd1 | null,
    nombres: Extraction | null,
    apellidos: Extraction | null,
    fullName: Extraction | null,
  ): {
    firstNames: string | null;
    lastNames: string | null;
    fullName: string | null;
    deMrz: boolean;
    heuristico: boolean;
    /** Se leyó el rótulo del nombre y lo que había debajo no era un nombre. */
    rotuloIlegible: boolean;
    /** Lo impreso y la MRZ nombran a personas distintas. */
    discrepaConMrz: boolean;
  } {
    /*
     * Para el NOMBRE manda lo impreso, al revés que para el número y las fechas.
     *
     * No es una excepción caprichosa: el tercer renglón de la MRZ tiene treinta
     * caracteres contados, y cuando el nombre no cabe, la norma manda
     * TRUNCARLO. Medido con esta misma tarjeta: `RODRIGUEZ<GONZALEZ<<MARIA<RENE`
     * — la última «E» de «RENEÉ» no cabe y desaparece. Un dato con dígito de
     * control es más fiable que uno impreso sólo mientras el dato esté ENTERO;
     * en cuanto la MRZ lo recorta, el rótulo del anverso dice más.
     */
    /*
     * Lo impreso sólo manda si lo impreso PARECE UN NOMBRE.
     *
     * La regla de arriba —lo impreso gana a la MRZ— sigue siendo la correcta por
     * la truncatura de los treinta caracteres, pero daba por bueno lo que
     * hubiera bajo el rótulo pasara lo que pasara. Y el rótulo del nombre es
     * justo el que va PEGADO AL RETRATO: medido sobre una cédula real, el
     * reconocedor devuelve ahí `CMI`, `Priti`, `PrELLI` y renglones de letras
     * sueltas. Cuando uno de esos cae en la posición del valor, el expediente se
     * queda con un nombre inventado con toda la pinta de uno leído —que es
     * exactamente la peor clase de dato en una verificación de identidad— y
     * encima descarta la MRZ, que en esa misma foto trae el nombre entero y
     * limpio.
     *
     * `pareceNombre` es el filtro, y es deliberadamente flojo: letras, un mínimo
     * de tres, y ninguna cifra. No valida ortografía —un apellido puede ser
     * cualquier cosa— sólo descarta lo que no puede ser un nombre de persona.
     */
    const nombreImpreso = pareceNombre(nombres?.value) ? (nombres?.value ?? null) : null;
    const apellidoImpreso = pareceNombre(apellidos?.value) ? (apellidos?.value ?? null) : null;
    const hayRotuloIlegible =
      (nombres !== null && nombreImpreso === null) ||
      (apellidos !== null && apellidoImpreso === null);

    /*
     * Cada mitad se resuelve POR SEPARADO, y ésa es la corrección.
     *
     * Antes bastaba con que UNA de las dos mitades impresas pareciera un nombre
     * para quedarse con las dos y no volver a mirar la MRZ. La consecuencia,
     * medida sobre cédulas auténticas: el rótulo de los apellidos se leía y el de
     * los nombres no —o al revés—, y el expediente salía con media identidad
     * mientras la MRZ del reverso traía las dos mitades enteras y limpias.
     * Nombres y apellidos son dos campos y se leen de dos sitios distintos de la
     * tarjeta; que uno falle no dice nada del otro.
     */
    const resolverMitad = (
      impreso: string | null,
      deMrz: string | null,
    ): { valor: string | null; deMrz: boolean; discrepa: boolean } => {
      if (!impreso) return { valor: deMrz, deMrz: deMrz !== null, discrepa: false };
      if (!deMrz) return { valor: impreso, deMrz: false, discrepa: false };
      /*
       * Lo impreso gana SÓLO si es lo mismo o MÁS que la MRZ, nunca menos.
       *
       * La razón por la que lo impreso ganaba está en la truncatura: la MRZ
       * corta el tercer renglón a treinta caracteres por norma, así que sobre un
       * nombre largo lo impreso trae la cola que la MRZ recortó, y además trae
       * los diacríticos. Esa razón sólo se aplica cuando lo impreso CONTIENE lo
       * de la MRZ; si es más corto o le falta un trozo por el medio, la razón
       * juega al revés.
       *
       * La distinción hace falta porque `mismoNombre` tolera una edición —para
       * no acusar de documento compuesto a una cédula con una letra mal leída— y
       * sin ella esa tolerancia se volvía en contra: `.UISPE MAMANI` y `QUISPE
       * MAMANI` pasaban por el mismo nombre, y como lo impreso mandaba, el
       * expediente guardaba el apellido MUTILADO teniendo el entero al lado.
       */
      if (empiezaPor(impreso, deMrz)) return { valor: impreso, deMrz: false, discrepa: false };
      /*
       * Se parecen pero lo impreso no es lo más completo: gana la MRZ y no se
       * avisa, porque una edición de diferencia es una letra que el reconocedor
       * se comió y no dos personas distintas.
       */
      if (mismoNombre(impreso, deMrz)) return { valor: deMrz, deMrz: true, discrepa: false };
      /*
       * Y cuando NO coinciden gana la MRZ. Esto es lo contrario de lo que había,
       * y el motivo está medido sobre una cédula boliviana auténtica: el rótulo
       * del nombre es el que va PEGADO AL RETRATO, y el reconocedor le come
       * caracteres —`QUISPE MAMANI` volvió como `” .UISPE MAMANI`—
       * mientras la MRZ, que está impresa en OCR-B al pie del reverso y para ser
       * leída por una máquina, trae el mismo nombre entero.
       *
       * Quedarse con lo impreso guardaba en el expediente de identidad de una
       * persona un apellido que no es el suyo, teniendo el bueno delante. Y la
       * discrepancia NO se silencia: sigue levantando `NAME_MRZ_MISMATCH`, que
       * es la marca de documento compuesto. Lo que cambia es cuál de los dos
       * datos se guarda, no si se avisa.
       */
      return { valor: deMrz, deMrz: true, discrepa: true };
    };

    const primerosNombres = resolverMitad(nombreImpreso, mrz?.firstNames ?? null);
    const apellidosFinales = resolverMitad(apellidoImpreso, mrz?.lastNames ?? null);

    if (primerosNombres.valor || apellidosFinales.valor) {
      const completo =
        [primerosNombres.valor, apellidosFinales.valor].filter(Boolean).join(' ').trim() || null;
      return {
        firstNames: primerosNombres.valor,
        lastNames: apellidosFinales.valor,
        fullName: completo,
        deMrz: primerosNombres.deMrz || apellidosFinales.deMrz,
        heuristico: false,
        rotuloIlegible: hayRotuloIlegible,
        discrepaConMrz: primerosNombres.discrepa || apellidosFinales.discrepa,
      };
    }
    const partes = fullName ? this.splitName(fullName.value) : null;
    return {
      firstNames: partes?.firstNames ?? null,
      lastNames: partes?.lastNames ?? null,
      fullName: fullName?.value ?? null,
      deMrz: false,
      heuristico: Boolean(partes),
      rotuloIlegible: hayRotuloIlegible,
      discrepaConMrz: false,
    };
  }

  /**
   * Anclajes de contraste para detectar un anverso y un reverso que pertenecen
   * a documentos distintos. Se expone aparte para que la orquestación pueda
   * comparar las dos caras sin volver a analizar.
   */
  crossCheckAnchors(ocr: Pick<DocumentOcrResult, 'rawText' | 'lines'>): {
    documentNumber: string | null;
    serie: string | null;
    section: string | null;
  } {
    const lines = this.sourceLines(ocr);
    return {
      documentNumber: this.documentNumber(lines)?.value ?? null,
      serie: this.firstGroup(lines, SERIE_ANCHOR),
      section: this.firstGroup(lines, SECTION_ANCHOR),
    };
  }

  private sourceLines(ocr: Pick<DocumentOcrResult, 'rawText' | 'lines'>): SourceLine[] {
    const ocrLines = ocr.lines ?? [];
    if (ocrLines.length > 0) {
      return ocrLines
        .map((line) => ({
          text: collapseWhitespace(line.text),
          normalized: normalizeForMatch(collapseWhitespace(line.text)),
          confidence: line.confidence,
        }))
        .filter((line) => line.text.length > 0);
    }
    return toLines(ocr.rawText).map((text) => ({
      text,
      normalized: normalizeForMatch(text),
      confidence: null,
    }));
  }

  /**
   * El número de cédula, prefiriendo el anclaje explícito `No <dígitos>`.
   *
   * Tres cambios sobre lo que había, los tres medidos contra cinco cédulas
   * bolivianas auténticas:
   *
   * 1. **El candidato se REPARA y se VALIDA**, en vez de aceptarse tal cual.
   *    Reparar deshace las confusiones de glifo del reconocedor sobre cifras
   *    grandes; validar lo contrasta con la forma que el SEGIP emite
   *    (`esNumeroDeCedulaValido`: cinco a ocho dígitos, sin cero delante). Un
   *    candidato que no cumple la forma se descarta en vez de viajar al
   *    expediente, que es lo que impide que un número de control de nueve
   *    dígitos ocupe el sitio del bueno.
   * 2. **La serie y la sección se excluyen explícitamente.** Son los dos campos
   *    administrativos del anverso, van en cifras y **tienen cinco dígitos**, o
   *    sea que cumplen la forma de un número de cédula corto. Cuando el
   *    reconocedor se come su rótulo —pasa: van en gris a cuerpo pequeño— el
   *    renglón queda como cifras sueltas y la vía de los dígitos sueltos los
   *    adjudicaba como número de documento. Medido sobre las cinco cédulas:
   *    `42343`, `32333`, `21222`, `44333`, `54222`, todos candidatos legítimos
   *    según la forma y ninguno el número de nadie.
   * 3. **A igualdad de vía, gana el candidato MÁS LARGO.** El número de una
   *    cédula boliviana tiene siete u ocho cifras y los ruidos que compiten con
   *    él tienen cinco; sin este criterio, el orden de los renglones decidía.
   */
  private documentNumber(lines: SourceLine[]): Extraction | null {
    const excluidos = new Set<string>();
    for (const line of lines) {
      const control = CONTROL_NUMBER_LINE.exec(line.normalized);
      const numero = control?.[1] ? control[1].replace(/\s/g, '') : null;
      if (numero) excluidos.add(numero);
      const serie = SERIE_ANCHOR.exec(line.normalized)?.[1];
      if (serie) excluidos.add(serie);
      const seccion = SECTION_ANCHOR.exec(line.normalized)?.[1];
      if (seccion) excluidos.add(seccion);
    }

    const anclados: Extraction[] = [];
    const sueltos: Extraction[] = [];
    for (const line of lines) {
      if (NUMBER_NOISE.test(line.normalized)) continue;

      const anchored = DOCUMENT_NUMBER_ANCHOR.exec(line.normalized)?.[1];
      const reparado = anchored ? repararDigitos(anchored) : null;
      if (reparado && !excluidos.has(reparado) && esNumeroDeCedulaValido(reparado)) {
        anclados.push({ value: reparado, confidence: line.confidence });
      }

      const standalone = STANDALONE_NUMBER_LINE.exec(line.normalized)?.[1];
      if (standalone && !excluidos.has(standalone) && esNumeroDeCedulaValido(standalone)) {
        sueltos.push({ value: standalone, confidence: line.confidence });
      }
    }

    const masLargo = (candidatos: Extraction[]): Extraction | null =>
      candidatos.length === 0
        ? null
        : candidatos.reduce((mejor, actual) =>
            actual.value.length > mejor.value.length ? actual : mejor,
          );

    // El anclado manda siempre: `No 1234567` es el número porque la tarjeta lo
    // dice, y unas cifras sueltas sólo lo son porque no hay nada mejor.
    return masLargo(anclados) ?? masLargo(sueltos);
  }

  private fullName(lines: SourceLine[]): Extraction | null {
    for (const [index, line] of lines.entries()) {
      const match = NAME_ANCHOR.exec(line.normalized);
      const captured = match?.[1];
      if (!captured) continue;
      // `A:` introduce el nombre del titular; menos de dos palabras es ruido.
      const words = captured
        .trim()
        .split(/\s+/)
        .filter((word) => /^[A-ZÑ'’-]{2,}$/.test(word));
      if (words.length < 2) continue;
      // Recupera de la línea intacta las mayúsculas y los diacríticos.
      const original = lines[index]?.text ?? '';
      const separator = original.search(/[:;.,]/);
      const value =
        separator >= 0 ? collapseWhitespace(original.slice(separator + 1)) : words.join(' ');
      return { value: limpiarValor(value || words.join(' ')), confidence: line.confidence };
    }
    return null;
  }

  /**
   * El nombre del formato ANTERIOR cuando su ancla `A:` no se dejó leer.
   *
   * En esa generación el nombre vive en el reverso y lo único que lo anuncia es
   * una `A:` — el glifo más pequeño con el que se puede anclar un campo, y el
   * primero que el reconocedor pierde. Medido sobre una cédula de 2023, el
   * reverso volvió así:
   *
   *   `cedido es e`
   *   `r - ANA LUCIA QUISPE MAMANI`
   *   `— Nacido el 25 de Febrero de 2002 : o`
   *
   * El nombre está impreso, es legible y se leyó ENTERO; lo que se perdió fue su
   * ancla, y con ella el campo. El expediente salía con `NAME_NOT_FOUND`.
   *
   * Lo que sí sobrevive es la ESTRUCTURA de la tarjeta: el nombre es el renglón
   * que va justo encima de `Nacido el`. No es una coincidencia de maquetación,
   * es el orden que esa generación imprime —`A: <nombre>` y debajo `Nacido el
   * <fecha>`— y por eso se busca desde ahí y no por la forma del texto.
   *
   * Tres condiciones lo mantienen honesto:
   *
   * - Se mira sólo el renglón INMEDIATAMENTE anterior y el siguiente a ése hacia
   *   arriba. Ampliar la ventana empezaría a alcanzar el bloque de `CERTIFICA:
   *   Que la firma, fotografía…`, que es texto fijo de la tarjeta.
   * - Tiene que parecer un nombre (`pareceNombre`) y traer al menos DOS palabras
   *   de tres letras: un nombre boliviano completo lleva nombres y dos
   *   apellidos, y el ruido del reconocedor llega en glifos sueltos.
   * - **Va marcado `NAME_SPLIT_HEURISTIC`** igual que el corte por convención,
   *   porque igual que aquél es una suposición sobre la maqueta y no un dato
   *   rotulado. Quien revise el caso tiene que poder saberlo.
   */
  private nombrePorVecindad(lines: SourceLine[]): Extraction | null {
    for (const [indice, line] of lines.entries()) {
      if (!BIRTH_ANCHOR.test(line.normalized)) continue;
      for (const salto of [1, 2]) {
        const candidata = lines[indice - salto];
        if (!candidata) break;
        const valor = limpiarValor(candidata.text);
        if (!pareceNombre(valor)) continue;
        const palabras = valor.split(/\s+/).filter((p) => (p.match(/\p{L}/gu) ?? []).length >= 3);
        if (palabras.length < 2) continue;
        return { value: palabras.join(' '), confidence: candidata.confidence };
      }
    }
    return null;
  }

  private placeOfBirth(lines: SourceLine[]): Extraction | null {
    for (const [index, line] of lines.entries()) {
      const match = PLACE_ANCHOR.exec(line.normalized);
      const captured = match?.[1];
      if (!captured) continue;
      // La línea del lugar va junto a la del nacimiento y viene separada por
      // guiones (`departamento - provincia - localidad`); esto deja fuera
      // cualquier otro texto que empiece por `EN …`.
      const neighbouring = lines
        .slice(Math.max(0, index - 2), index + 3)
        .some((near) => BIRTH_ANCHOR.test(near.normalized));
      if (!captured.includes('-') && !neighbouring) continue;
      const original = lines[index]?.text ?? '';
      const value = collapseWhitespace(original.replace(/^\s*[Ee][Nn]\s+/, ''));
      return { value: sinColaDeRuido(value), confidence: line.confidence };
    }
    return null;
  }

  private anchored(lines: SourceLine[], pattern: RegExp): Extraction | null {
    for (const line of lines) {
      const match = pattern.exec(line.normalized);
      const captured = match?.[1];
      if (captured) return { value: collapseWhitespace(captured), confidence: line.confidence };
    }
    return null;
  }

  /**
   * Lo que sigue a un rótulo EN LA MISMA LÍNEA, cotejándolo con tolerancia.
   *
   * Es el hermano de `anchored` para los rótulos que el reconocedor mutila. El
   * cotejo aproximado no daba posiciones y por eso sólo se podía usar para mirar
   * el renglón de debajo; ahora `valorTrasEtiqueta` devuelve el corte, y con él
   * se alcanzan los rótulos del formato anterior —`Emitida el 22 de Mayo de
   * 2023`, `Expira el 22 de Mayo de 2028`— que ponen su valor detrás.
   *
   * Se lee de la línea ORIGINAL y no de la normalizada: la fecha larga lleva
   * espacios y la corta lleva barras, y los dos separadores hacen falta para
   * interpretarla.
   */
  private anchoredTolerante(lines: SourceLine[], grafias: readonly string[]): Extraction | null {
    for (const line of lines) {
      const resto = valorTrasEtiqueta(line.text, grafias);
      if (resto === null) continue;
      const valor = collapseWhitespace(resto);
      if (!valor) continue;
      return { value: valor, confidence: line.confidence };
    }
    return null;
  }

  /**
   * Valor de un campo ROTULADO, esté en la misma línea o en la siguiente.
   *
   * En la cédula vigente el rótulo va ENCIMA del valor, no delante: la tarjeta
   * imprime `NOMBRES` y debajo `MARIA RENEE`. El reconocedor los devuelve como
   * dos renglones distintos, así que buscar `NOMBRES: <algo>` en una sola línea
   * no encuentra nada —y ése era el motivo real de que un documento
   * perfectamente legible saliera «sin campos»—.
   *
   * Se mira la línea siguiente sólo si no es OTRO rótulo: dos rótulos seguidos
   * significan que el valor se perdió, y tomar el segundo rótulo como valor
   * sería inventarse el dato.
   *
   * Y lo que acompaña al rótulo en su propia línea tiene que PARECER un valor.
   * El retrato va al lado de los rótulos, así que el reconocedor mete en el
   * mismo renglón los glifos que cree ver en la foto: sobre una cédula legible
   * devolvió `NOMBRES í Y`, y quedarse con eso daba el nombre completo
   * «I Y RODRIGUEZ GONZALEZ» —un dato inventado, con la pinta de uno leído—.
   * Descartarlo hace que se lea el renglón de debajo, que es donde está el
   * valor de verdad.
   */
  private labelled(
    lines: SourceLine[],
    etiqueta: RegExp,
    grafias: readonly string[] = [],
    excluye?: RegExp,
  ): Extraction | null {
    for (const [indice, line] of lines.entries()) {
      const match = etiqueta.exec(line.normalized);
      if (!match) continue;

      const enLinea = collapseWhitespace(match[1] ?? '');
      if (enLinea && pareceValor(enLinea)) {
        return { value: limpiarValor(enLinea), confidence: line.confidence };
      }

      const siguiente = lines[indice + 1];
      if (!siguiente || ES_ROTULO.test(siguiente.normalized)) continue;
      return {
        value: limpiarValor(collapseWhitespace(siguiente.text)),
        confidence: siguiente.confidence,
      };
    }

    /*
     * El rótulo, cotejado con tolerancia. Segundo intento y no primero: cuando
     * la expresión regular encuentra el rótulo también sabe dónde ACABA, y con
     * eso puede tomar el valor de la misma línea. El cotejo aproximado no
     * devuelve posiciones, así que aquí sólo se puede mirar el renglón de
     * DEBAJO — que es donde la cédula vigente imprime el valor de todos modos,
     * porque el rótulo va encima y no delante.
     */
    for (const [indice, line] of lines.entries()) {
      /*
       * Un renglón que lleva LITERALMENTE el rótulo de otro campo no se
       * adjudica por parecido. Es lo que impide que `FECHA DE NACIMIENTO`, que
       * está a dos ediciones de `FECHA DE VENCIMIENTO`, se lleve la caducidad —y
       * con ella la fecha de nacimiento puesta en el campo equivocado—.
       */
      if (excluye?.test(line.normalized)) continue;
      if (casarGrafias(plegarParaCotejo(line.normalized), grafias) === null) continue;
      const siguiente = lines[indice + 1];
      if (!siguiente || ES_ROTULO.test(siguiente.normalized)) continue;
      const valor = limpiarValor(collapseWhitespace(siguiente.text));
      if (!pareceValor(valor)) continue;
      return { value: valor, confidence: siguiente.confidence };
    }
    return null;
  }

  /**
   * El lugar de nacimiento por su VALOR, cuando su rótulo no se dejó leer.
   *
   * `LUGAR DE NACIMIENTO` es el rótulo más pequeño del reverso y el que peor
   * sobrevive: medido sobre una cédula real, a ninguna de las cuatro
   * resoluciones apareció ni entero ni mutilado. Lo que sí aparece limpio, y a
   * buen cuerpo, es el valor —`SANTA CRUZ - ANDRES IBAÑEZ - SANTA CRUZ DE LA
   * SIERRA`—, porque nombra un departamento de Bolivia y viene con la estructura
   * `departamento - provincia - localidad` que no tiene ningún otro renglón de
   * la tarjeta.
   *
   * Se exige el guion además del departamento. Sin él, `SANTA CRUZ` suelto lo
   * lleva también el domicilio, y el lugar de nacimiento acabaría siendo una
   * dirección — un dato equivocado en el sitio de uno correcto, que es peor que
   * dejarlo vacío.
   *
   * Y se recorta por delante hasta el departamento: el reconocedor deja restos
   * del código QR y del sello a la izquierda del renglón (`OF AO!`, `[RO]`), y
   * arrastrarlos al expediente sería guardar ruido con forma de dato.
   */
  private placeOfBirthPorDepartamento(lines: SourceLine[]): Extraction | null {
    for (const line of lines) {
      if (!line.normalized.includes('-')) continue;
      const departamento = NOMBRES_DE_DEPARTAMENTO.map((nombre) => ({
        nombre,
        posicion: line.normalized.indexOf(nombre),
      })).find(({ posicion }) => posicion >= 0);
      if (!departamento) continue;
      // Y por detrás se quitan los signos que el reconocedor cuelga del final
      // del renglón (`SANTA”`, `SANTA pr`): son del borde de la tarjeta, no del
      // lugar de nacimiento.
      const valor = collapseWhitespace(line.text.slice(departamento.posicion)).replace(
        /[^\p{L}\p{N}]+$/u,
        '',
      );
      if (valor.length < 6) continue;
      return { value: sinColaDeRuido(valor), confidence: line.confidence };
    }
    return null;
  }

  private firstGroup(lines: SourceLine[], pattern: RegExp): string | null {
    for (const line of lines) {
      const match = pattern.exec(line.normalized);
      if (match?.[1]) return match[1];
    }
    return null;
  }

  /**
   * Fecha normalizada, eligiendo cuál cuando el renglón trae más de una.
   *
   * La cédula vigente imprime `FECHA DE EMISION` y `FECHA DE EXPIRACION` UNA AL
   * LADO DE LA OTRA, y el reconocedor devuelve los dos rótulos en un renglón y
   * los dos valores en el siguiente: `01/11/2023 01/11/2028`. Quedarse con la
   * primera fecha daba la de emisión como caducidad y **declaraba caducado un
   * documento vigente** — un rechazo silencioso sobre alguien que no había
   * hecho nada mal.
   *
   * Se resuelve con un hecho del documento y no con posiciones de píxeles: la
   * emisión SIEMPRE es anterior a la expiración. Así el criterio sobrevive a
   * que el reconocedor cambie el orden de las columnas.
   */
  private normalizedDate(
    extraction: Extraction | null,
    cual: 'primera' | 'ultima' = 'primera',
  ): Extraction | null {
    if (!extraction) return null;
    const fechas = this.todasLasFechas(extraction.value);
    if (fechas.length === 0) return null;
    const elegida = cual === 'ultima' ? fechas[fechas.length - 1] : fechas[0];
    return { value: elegida, confidence: extraction.confidence };
  }

  /** Todas las fechas de un texto, en el orden en que aparecen y ya en ISO. */
  private todasLasFechas(texto: string): string[] {
    const trozos = texto.match(
      /\d{1,4}[/\-.]\d{1,2}[/\-.]\d{2,4}|\d{1,2}\s+DE\s+\S+\s+DE\s+\d{4}/gi,
    );
    const candidatos = trozos && trozos.length > 0 ? trozos : [texto];
    return candidatos
      .map((trozo) => parseSpanishDate(trozo)?.iso)
      .filter((iso): iso is string => Boolean(iso));
  }

  /**
   * Los registros bolivianos imprimen `<nombres> <apellido paterno> <apellido
   * materno>`. El corte es una convención, no un delimitador, así que las dos
   * mitades se marcan `DERIVED` y se avisa; `fullName` sigue siendo la
   * autoridad.
   */
  private splitName(fullName: string): { firstNames: string; lastNames: string } | null {
    const words = collapseWhitespace(fullName).split(' ').filter(Boolean);
    if (words.length < 2) return null;
    if (words.length === 2) return { firstNames: words[0], lastNames: words[1] };
    return {
      firstNames: words.slice(0, words.length - 2).join(' '),
      lastNames: words.slice(words.length - 2).join(' '),
    };
  }

  private field(
    value: string | null,
    confidence: number | null,
    source: ExtractedField<string>['source'] = 'OCR',
  ): ExtractedField<string> {
    return { value, confidence, source };
  }
}
