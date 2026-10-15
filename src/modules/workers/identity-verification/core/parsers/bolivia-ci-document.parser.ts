import { Injectable } from '@nestjs/common';
import { IdentityDocumentType } from '../domain/identity-enums';
import type { ExtractedField } from '../domain/extracted-identity.types';
import type { DocumentOcrResult } from '../ports/identity.ports';
import type { DocumentParser, DocumentParserInput, ParsedDocument } from './document-parser';
import { parseMrzTd1 } from './mrz-td1';
import { SECTION_ANCHOR, SERIE_ANCHOR } from './bolivia-ci/ci-anchors';
import { fechaNormalizada } from './bolivia-ci/ci-dates';
import { numeroDeDocumento } from './bolivia-ci/ci-document-number';
import { leerCamposImpresos } from './bolivia-ci/ci-printed-fields';
import { conciliarConMrz } from './bolivia-ci/ci-reconciliation';
import { firstGroup, sourceLines } from './bolivia-ci/ci-source-lines';

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
@Injectable()
export class BoliviaCiDocumentParser implements DocumentParser {
  supports(context: { type: IdentityDocumentType; country: string }): boolean {
    return (
      context.type === IdentityDocumentType.BOLIVIA_CI && context.country.toUpperCase() === 'BO'
    );
  }

  async parse(input: DocumentParserInput): Promise<ParsedDocument> {
    const lines = sourceLines(input.ocr);

    // La MRZ primero: si valida, es la fuente que se puede demostrar.
    const mrz = parseMrzTd1(input.ocr.rawText);
    const impresos = leerCamposImpresos(lines);
    const { numero, nacimiento, caducidad, partes, warnings } = conciliarConMrz(mrz, impresos);

    const desdeMrz = (usada: boolean): ExtractedField<string>['source'] => (usada ? 'MRZ' : 'OCR');

    return {
      fields: {
        documentType: this.field('BOLIVIA_CI', 1, 'DERIVED'),
        documentNumber: this.field(
          numero.valor,
          impresos.documentNumber?.confidence ?? null,
          desdeMrz(numero.deMrz),
        ),
        fullName: this.field(partes.fullName, impresos.fullName?.confidence ?? null),
        firstNames: this.field(
          partes.firstNames,
          impresos.fullName?.confidence ?? null,
          partes.heuristico ? 'DERIVED' : desdeMrz(partes.deMrz),
        ),
        lastNames: this.field(
          partes.lastNames,
          impresos.fullName?.confidence ?? null,
          partes.heuristico ? 'DERIVED' : desdeMrz(partes.deMrz),
        ),
        dateOfBirth: this.field(
          nacimiento.valor,
          impresos.birth?.confidence ?? null,
          desdeMrz(nacimiento.deMrz),
        ),
        expirationDate: this.field(
          caducidad.valor,
          impresos.expiry?.confidence ?? null,
          desdeMrz(caducidad.deMrz),
        ),
        // Y la PRIMERA para la emisión, por el mismo motivo al revés.
        issueDate: this.field(
          fechaNormalizada(impresos.issue, 'primera')?.value ?? null,
          impresos.issue?.confidence ?? null,
        ),
        placeOfBirth: this.field(
          impresos.placeOfBirth?.value ?? null,
          impresos.placeOfBirth?.confidence ?? null,
        ),
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
   * Anclajes de contraste para detectar un anverso y un reverso que pertenecen
   * a documentos distintos. Se expone aparte para que la orquestación pueda
   * comparar las dos caras sin volver a analizar.
   */
  crossCheckAnchors(ocr: Pick<DocumentOcrResult, 'rawText' | 'lines'>): {
    documentNumber: string | null;
    serie: string | null;
    section: string | null;
  } {
    const lines = sourceLines(ocr);
    return {
      documentNumber: numeroDeDocumento(lines)?.value ?? null,
      serie: firstGroup(lines, SERIE_ANCHOR),
      section: firstGroup(lines, SECTION_ANCHOR),
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
