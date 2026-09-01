import { Injectable } from '@nestjs/common';
import { IdentityDocumentType } from '../domain/identity-enums';
import type { ExtractedField } from '../domain/extracted-identity.types';
import type { DocumentOcrResult } from '../ports/identity.ports';
import type { DocumentParser, DocumentParserInput, ParsedDocument } from './document-parser';
import { parseMrzTd1, type MrzTd1 } from './mrz-td1';
import { parseSpanishDate } from './spanish-date';
import { collapseWhitespace, normalizeForMatch, toLines } from './text-normalization';
import { casarGrafias, plegarParaCotejo } from '../catalog/approximate-match';
import { NOMBRES_DE_DEPARTAMENTO } from '../catalog/bolivia-ci.catalog';

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
const DOCUMENT_NUMBER_ANCHOR =
  /(?:^|\s)(?:N\s?[O°º*"'”’~^]\.?|NRO\.?|NUM(?:ERO)?\.?|C\.?\s?[I1L]\.?|N[?¿])\s*[:#-]?\s*(\d{5,10})(?![\d-])/;
const CONTROL_NUMBER_LINE = /^(\d{5,10})\s+\d{2}\s?-\s?\d{2}$/;
const STANDALONE_NUMBER_LINE = /^(\d{5,10})$/;
const NAME_ANCHOR = /^A\s*[:;.,]\s*(.+)$/;
const BIRTH_ANCHOR = /(?:^|\s)NACID[OA]\s+EL\s+(.+)$/;
const EXPIRY_ANCHOR = /(?:^|\s)VALID[AO]\s+HASTA(?:\s+EL)?\s*[:.]?\s*(.+)$/;
const PLACE_ANCHOR = /^EN\s+(.{4,})$/;
// --- Formato vigente: los rótulos SON los anclajes ------------------------
const LABEL_NOMBRES = /^NOMBRES\s*[:.]?\s*(.*)$/;
const LABEL_APELLIDOS = /^APELLIDOS\s*[:.]?\s*(.*)$/;
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
  return a.startsWith(b) || b.startsWith(a);
}

function sinColaDeRuido(texto: string): string {
  const trozos = texto.split(/\s+/).filter(Boolean);
  while (trozos.length > 1 && !/[\p{L}\p{N}]{3,}/u.test(trozos[trozos.length - 1] ?? '')) {
    trozos.pop();
  }
  return trozos.join(' ');
}

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
    const fullName = this.fullName(lines);
    const birth =
      this.labelled(lines, LABEL_NACIMIENTO, GRAFIAS_NACIMIENTO, EXCLUSIONES.NACIMIENTO) ??
      this.anchored(lines, BIRTH_ANCHOR);
    const expiry =
      this.labelled(lines, LABEL_EXPIRACION, GRAFIAS_EXPIRACION, EXCLUSIONES.EXPIRACION) ??
      this.anchored(lines, EXPIRY_ANCHOR);
    const issue = this.labelled(lines, LABEL_EMISION, GRAFIAS_EMISION, EXCLUSIONES.EMISION);
    const placeOfBirth =
      this.labelled(lines, LABEL_LUGAR, GRAFIAS_LUGAR) ??
      this.placeOfBirth(lines) ??
      this.placeOfBirthPorDepartamento(lines);

    const dateOfBirth = this.normalizedDate(birth);
    // La ÚLTIMA de las fechas del renglón: la emisión va antes que la expiración.
    const expirationDate = this.normalizedDate(expiry, 'ultima');

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
    if (numero.discrepa || nacimiento.discrepa || caducidad.discrepa) {
      warnings.push(BOLIVIA_CI_WARNINGS.mrzMismatch);
    }
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
    if (!expiry && !mrz?.expirationDate) warnings.push(BOLIVIA_CI_WARNINGS.expiryNotFound);
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
    const discrepa = Boolean(deMrz && impreso && deMrz !== impreso);
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

    if (nombreImpreso || apellidoImpreso) {
      const completo = [nombreImpreso, apellidoImpreso].filter(Boolean).join(' ').trim() || null;
      /*
       * Y si además hay MRZ y dice OTRO nombre, se avisa.
       *
       * No se corrige —la truncatura hace que discrepar sea normal cuando el
       * nombre es largo— pero un anverso y un reverso que nombran a dos personas
       * distintas es la firma de un documento compuesto, y callarlo sería
       * quedarse con el dato y tirar la señal. Es el mismo trato que ya reciben
       * el número y las fechas.
       */
      const discrepa =
        (nombreImpreso !== null &&
          mrz?.firstNames != null &&
          !mismoNombre(nombreImpreso, mrz.firstNames)) ||
        (apellidoImpreso !== null &&
          mrz?.lastNames != null &&
          !mismoNombre(apellidoImpreso, mrz.lastNames));
      return {
        firstNames: nombreImpreso,
        lastNames: apellidoImpreso,
        fullName: completo,
        deMrz: false,
        heuristico: false,
        rotuloIlegible: hayRotuloIlegible,
        discrepaConMrz: discrepa,
      };
    }
    if (mrz?.firstNames || mrz?.lastNames) {
      const completo = [mrz.firstNames, mrz.lastNames].filter(Boolean).join(' ') || null;
      return {
        firstNames: mrz.firstNames,
        lastNames: mrz.lastNames,
        fullName: completo,
        deMrz: true,
        heuristico: false,
        rotuloIlegible: hayRotuloIlegible,
        discrepaConMrz: false,
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
   * El número de cédula, prefiriendo el anclaje explícito `No <dígitos>`. Las
   * líneas de dígitos sueltos sólo se consideran después de excluir el número
   * de control de impresión, identificado por su sufijo `NN-NN` allá donde
   * aparezca.
   */
  private documentNumber(lines: SourceLine[]): Extraction | null {
    const controlNumbers = new Set<string>();
    for (const line of lines) {
      const control = CONTROL_NUMBER_LINE.exec(line.normalized);
      if (control?.[1]) controlNumbers.add(control[1]);
    }

    for (const line of lines) {
      if (NUMBER_NOISE.test(line.normalized)) continue;
      const anchored = DOCUMENT_NUMBER_ANCHOR.exec(line.normalized);
      const value = anchored?.[1];
      if (value && !controlNumbers.has(value)) return { value, confidence: line.confidence };
    }

    for (const line of lines) {
      if (NUMBER_NOISE.test(line.normalized)) continue;
      const standalone = STANDALONE_NUMBER_LINE.exec(line.normalized);
      const value = standalone?.[1];
      if (value && !controlNumbers.has(value)) return { value, confidence: line.confidence };
    }
    return null;
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
      return { value: sinColaDeRuido(value || words.join(' ')), confidence: line.confidence };
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
        return { value: sinColaDeRuido(enLinea), confidence: line.confidence };
      }

      const siguiente = lines[indice + 1];
      if (!siguiente || ES_ROTULO.test(siguiente.normalized)) continue;
      return {
        value: sinColaDeRuido(collapseWhitespace(siguiente.text)),
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
      const valor = sinColaDeRuido(collapseWhitespace(siguiente.text));
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
