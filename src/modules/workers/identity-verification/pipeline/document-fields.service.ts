import { Inject, Injectable, Logger } from '@nestjs/common';
import type { IdentityDocumentType } from '../core/domain/identity-enums';
import type { ExtractedIdentityData } from '../core/domain/extracted-identity.types';
import { reconcileSecondReading } from '../core/engine/second-reader';
import { IDENTITY_SECOND_READER_PORT } from '../core/identity-options';
import type { DocumentParser } from '../core/parsers/document-parser';
import { DocumentParserRegistry } from '../core/parsers/document-parser.registry';
import type {
  DocumentOcrResult,
  IdentitySecondReaderPort,
  NormalizedImage,
} from '../core/ports/identity.ports';
import type { DocumentoLeido } from './document-intake.service';
import type { IdentityPipelineInput } from './identity-pipeline-input';

/** Los campos del documento y las marcas de riesgo que salieron de leerlos. */
export interface CamposExtraidos {
  fields: ExtractedIdentityData;
  riskFlags: string[];
}

/**
 * Los campos que tiene sentido volver a leer.
 *
 * No está `fullName` a propósito: es un campo DERIVADO de los otros dos, y
 * pedírselo al modelo sería invitarle a proponer una tercera versión del nombre
 * que luego habría que reconciliar con las dos que ya hay.
 */
const CAMPOS_RELEIBLES = [
  'documentNumber',
  'firstNames',
  'lastNames',
  'dateOfBirth',
  'expirationDate',
] as const satisfies readonly (keyof ExtractedIdentityData)[];

/** Registro del segundo lector. Fuera de la clase: el servicio no tiene logger. */
const SECOND_READER_LOG = new Logger('IdentitySecondReader');

/**
 * La imagen ya normalizada, como `data:` URL.
 *
 * Se manda la NORMALIZADA y no el original de 12 MP: es la misma que ve el
 * resto del pipeline, pesa una fracción y viaja en el cuerpo de una petición
 * HTTP que además se cobra por tamaño.
 */
function toDataUrl(image: NormalizedImage): string {
  return `data:${image.mimeType};base64,${image.buffer.toString('base64')}`;
}

/**
 * Extrae los campos con el analizador del tipo resuelto y, sólo si faltó algo, le pide un segundo
 * lector que complete los huecos.
 */
@Injectable()
export class DocumentFieldsService {
  constructor(
    private readonly parsers: DocumentParserRegistry,
    /*
     * El segundo lector es OPCIONAL y viene apagado. No es una función a medias:
     * es que mandarle la imagen del documento a un enrutador que elige proveedor
     * por su cuenta es una decisión de tratamiento de datos, y esa se toma
     * encendiendo una bandera, no heredándola de otra función.
     */
    @Inject(IDENTITY_SECOND_READER_PORT)
    private readonly secondReader: IdentitySecondReaderPort | null,
  ) {}

  async extract(
    input: IdentityPipelineInput,
    read: DocumentoLeido,
    tipoResuelto: IdentityDocumentType,
    country: string,
  ): Promise<CamposExtraidos> {
    const { document } = read;
    const { ocr, front, back } = read.lectura;
    const riskFlags: string[] = [];

    const parser = this.parsers.resolve({ type: tipoResuelto, country });
    const parsed = await parser.parse({ ocr, context: { type: tipoResuelto, country } });
    if (back) this.assertSidesAgree(parser, front, back, parsed.warnings);
    riskFlags.push(...parsed.warnings);

    /*
     * --- 3.ter. Segundo lector, sólo si faltó algo --------------------------
     *
     * No corre en el camino feliz: si el analizador sacó los campos, preguntarle
     * a un modelo sólo puede empeorar el caso —contradiciendo una lectura
     * correcta— y cuesta una llamada de red por verificación.
     *
     * Va DESPUÉS del analizador porque necesita saber qué falta, y ANTES del
     * fraude porque la conformidad de plantilla y la aritmética interna se miden
     * sobre los campos: rellenarlos después dejaría al análisis de autenticidad
     * juzgando un documento distinto del que se guarda.
     */
    const campos = await this.releerCamposQueFaltan(
      parsed.fields,
      document,
      ocr.rawText,
      input,
      riskFlags,
    );
    return { fields: campos, riskFlags };
  }

  /**
   * Le pide a un segundo lector los campos que el analizador no sacó.
   *
   * Devuelve SIEMPRE unos campos utilizables: si el lector está apagado, no hay
   * huecos, o la llamada falló, devuelve los de entrada sin tocar. La función no
   * puede hacer fracasar una verificación, sólo mejorarla — y ése es el único
   * contrato que la hace segura de encender.
   */
  private async releerCamposQueFaltan(
    fields: ExtractedIdentityData,
    document: NormalizedImage,
    ocrRawText: string,
    input: IdentityPipelineInput,
    riskFlags: string[],
  ): Promise<ExtractedIdentityData> {
    if (this.secondReader === null) return fields;

    const faltantes = CAMPOS_RELEIBLES.filter((campo) => !fields[campo]?.value);
    if (faltantes.length === 0) return fields;

    const proposal = await this.secondReader.read({
      correlationId: input.correlationId,
      images: [toDataUrl(document)],
      missingFields: faltantes,
    });
    if (proposal === null) return fields;

    const reconciliado = reconcileSecondReading(fields, proposal, ocrRawText);
    riskFlags.push(...reconciliado.riskFlags);
    if (reconciliado.filled.length > 0) {
      SECOND_READER_LOG.log(
        `Segundo lector (${this.secondReader.provider}) completó ` +
          `${reconciliado.filled.join(', ')} en ${input.correlationId}.`,
      );
    }
    return reconciliado.fields;
  }

  /**
   * Un anverso y un reverso que imprimen números distintos se fotografiaron de
   * dos tarjetas distintas. Eso es un intento de composición, no un problema de
   * captura, así que sale como aviso del analizador y termina en marca de
   * riesgo. Absorbido de `DocumentParseStageService`.
   */
  private assertSidesAgree(
    parser: DocumentParser,
    front: DocumentOcrResult,
    back: DocumentOcrResult,
    warnings: string[],
  ): void {
    if (!parser.crossCheckAnchors) return;
    const frontNumber = parser.crossCheckAnchors(front).documentNumber;
    const backNumber = parser.crossCheckAnchors(back).documentNumber;
    if (frontNumber && backNumber && frontNumber !== backNumber) {
      warnings.push('DOCUMENT_SIDES_MISMATCH');
    }
  }
}
