import { Inject, Injectable } from '@nestjs/common';
import { IdentityDocumentType } from '../core/domain/identity-enums';
import {
  IDENTITY_CLASSIFIER_PORT,
  IDENTITY_NORMALIZER_PORT,
  IDENTITY_OCR_PORT,
  IDENTITY_OPTIONS,
  type IdentityOptions,
} from '../core/identity-options';
import type {
  DocumentClassifierPort,
  DocumentFramerPort,
  DocumentOcrPort,
  FaceCropPort,
  ImageNormalizerPort,
} from '../core/ports/identity.ports';
import {
  unirCaras,
  type CarasDelDocumento,
  type Clasificador,
  type Lectura,
} from './document-reading';
import type { IdentityPipelineInput } from './identity-pipeline-input';

/** Lee el texto de las caras del documento y lo clasifica; el único sitio que llama al OCR. */
@Injectable()
export class DocumentTextReaderService {
  constructor(
    @Inject(IDENTITY_OPTIONS) private readonly options: IdentityOptions,
    @Inject(IDENTITY_NORMALIZER_PORT)
    private readonly images: ImageNormalizerPort & FaceCropPort & DocumentFramerPort,
    @Inject(IDENTITY_OCR_PORT) private readonly ocr: DocumentOcrPort,
    @Inject(IDENTITY_CLASSIFIER_PORT) private readonly classifier: DocumentClassifierPort,
  ) {}

  /** El clasificador de este país, o uno inerte si la clasificación está apagada. */
  clasificadorPara(country: string): Clasificador {
    return (anverso, reversoLeido) =>
      this.options.documentClassificationEnabled
        ? this.classifier.classify({
            rawText: `${anverso}\n${reversoLeido}`,
            frontText: anverso,
            backText: reversoLeido,
            documentCountry: country,
          })
        : Promise.resolve({
            type: IdentityDocumentType.UNKNOWN,
            confidence: 1,
            signals: ['classification-disabled'],
          });
  }

  /**
   * El tope de resolución del reconocedor, aplicado en el ÚNICO sitio por el que
   * pasan todas las lecturas.
   *
   * Va aquí y no en el adaptador porque es una decisión del flujo —cuánto vale
   * la pena pagar por leer— y no del reconocedor. La imagen de tamaño completo
   * sigue viva para todo lo demás: el recorte del retrato, la comparación
   * biométrica y el análisis de píxeles del fraude siguen viendo cada píxel.
   * Aquí sólo se abarata el TEXTO.
   */
  private async paraLeer(imagen: Buffer, lado: number): Promise<Buffer> {
    if (lado <= 0) return imagen;
    return this.images.downscale(imagen, lado);
  }

  /** Lee anverso y, si lo hay, reverso, y clasifica el texto de los dos juntos. */
  async leerCaras(
    caras: CarasDelDocumento,
    input: IdentityPipelineInput,
    clasificar: Clasificador,
    lado: number,
  ): Promise<Lectura> {
    const front = await this.ocr.extract({
      image: await this.paraLeer(caras.anverso, lado),
      correlationId: input.correlationId,
    });
    const back = caras.reverso
      ? await this.ocr.extract({
          image: await this.paraLeer(caras.reverso, lado),
          correlationId: input.correlationId,
        })
      : null;
    // Las dos caras de una cédula llevan campos distintos; el análisis corre
    // sobre las dos juntas.
    const ocr = back ? unirCaras(front, back) : front;
    return {
      ocr,
      front,
      back,
      // Las dos caras van SEPARADAS al clasificador además de unidas: el
      // catálogo sitúa cada anclaje en su cara, y medirlo sobre el texto unido
      // convierte la plantilla en una bolsa de palabras.
      classification: await clasificar(front.rawText, back?.rawText ?? ''),
    };
  }
}
