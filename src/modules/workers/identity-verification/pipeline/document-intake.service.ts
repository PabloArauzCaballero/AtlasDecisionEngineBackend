import { Inject, Injectable } from '@nestjs/common';
import { identityErrors } from '../core/domain/identity-domain.error';
import { medirColorDelDocumento, type ColorDelDocumento } from '../core/forensics/document-color';
import {
  ImageQualityAssessmentService,
  type ImageQualityAssessment,
} from '../core/image-quality-assessment.service';
import {
  IDENTITY_NORMALIZER_PORT,
  IDENTITY_OPTIONS,
  type IdentityOptions,
} from '../core/identity-options';
import type {
  DocumentFraming,
  DocumentFramerPort,
  FaceCropPort,
  ImageNormalizerPort,
  NormalizedImage,
} from '../core/ports/identity.ports';
import { DocumentOrientationService } from './document-orientation.service';
import { hayIndicioDeDocumento, puntuarLectura, type Lectura } from './document-reading';
import { DocumentTextReaderService } from './document-text-reader.service';
import type { IdentityPipelineInput } from './identity-pipeline-input';

/** El documento ya normalizado, medido, encuadrado y leído: lo que las etapas siguientes juzgan. */
export interface DocumentoLeido {
  document: NormalizedImage;
  documentQuality: ImageQualityAssessment;
  /** La captura vino del escáner del sistema (anverso ya recortado). */
  escaneado: boolean;
  colorDelAnverso: ColorDelDocumento | null;
  encuadre: DocumentFraming;
  reverso: Buffer | null;
  lectura: Lectura;
}

/**
 * Etapas 1 a 3 del pipeline: normalizar y medir el documento, quitarle el fondo y leerlo,
 * con las pasadas de más (sin recorte, orientación, relectura fina) sólo cuando hacen falta.
 */
@Injectable()
export class DocumentIntakeService {
  constructor(
    @Inject(IDENTITY_OPTIONS) private readonly options: IdentityOptions,
    @Inject(IDENTITY_NORMALIZER_PORT)
    private readonly images: ImageNormalizerPort & FaceCropPort & DocumentFramerPort,
    private readonly quality: ImageQualityAssessmentService,
    private readonly textReader: DocumentTextReaderService,
    private readonly orientation: DocumentOrientationService,
  ) {}

  async intake(input: IdentityPipelineInput, country: string): Promise<DocumentoLeido> {
    // --- 1. Documento: normalizar y medir -----------------------------------
    // `let`: si la tarjeta viene tumbada, más abajo se sustituye por la misma
    // foto enderezada y vuelta a normalizar. Todo lo que va después trabaja con
    // el documento ya derecho sin enterarse de que hubo giro.
    let document = await this.images.normalize(input.documentImage);
    const documentQuality = this.quality.document(document.quality);
    /*
     * Aquí había un RECHAZO por puntaje, y era el defecto que más gente paraba.
     *
     * `if (!documentQuality.acceptable) throw blurryDocument(...)`: la foto se
     * medía con una fórmula —resolución contra un megapíxel, exposición,
     * contraste y nitidez— y por debajo de 0,5 se contestaba «no tiene calidad
     * suficiente» SIN HABER INTENTADO LEERLA NUNCA. Medido con
     * `scripts/medir-resolucion-identidad.ts`, esa puerta se cerraba a 700×450,
     * y la misma cédula a 450×289 —bastante por debajo— entrega número, nombre y
     * caducidad y termina VERIFICADA con parecido 0,8971. O sea: rechazaba por
     * ilegibles imágenes que el propio motor lee enteras. Peor todavía, la
     * batería tenía una prueba que fijaba ese rechazo dando por cierto, sin
     * medirlo, que a 445×282 «no hay lectura posible».
     *
     * La medida sigue tomándose y sigue contando: viaja al motor de decisión
     * como `LOW_DOCUMENT_CONFIDENCE` y sale en el resultado. Lo que ya no hace
     * es decidir por su cuenta algo que la etapa siguiente puede COMPROBAR. La
     * prueba de que una foto era legible es haberla leído; si la lectura falla,
     * abajo se contesta con el consejo que la medida explique.
     *
     * Lo único que se corta antes de gastar OCR es el suelo de abajo, que es
     * dónde se dejó de leer NADA, medido.
     */
    const { width, height } = document.quality;
    if (
      Math.max(width, height) < this.options.minReadableLongEdge ||
      Math.min(width, height) < this.options.minReadableShortEdge
    ) {
      throw identityErrors.documentTooSmall(
        width,
        height,
        this.options.minReadableLongEdge,
        this.options.minReadableShortEdge,
      );
    }
    /*
     * El escáner del sistema entrega la tarjeta YA recortada, y en iOS con el
     * filtro que haya elegido el usuario. El color se mide aquí, sobre el anverso
     * normalizado y antes de girar nada —el color no depende de la orientación—,
     * y SÓLO para esa población: sobre una foto de cámara no se calcula nada, así
     * que su camino no cambia ni en un milisegundo.
     */
    const escaneado = input.documentCaptureSource === 'system_scanner';
    const colorDelAnverso: ColorDelDocumento | null = escaneado
      ? await medirColorDelDocumento(document.buffer)
      : null;
    await input.onProgress?.(20);

    // --- 2. Recorte del fondo ----------------------------------------------
    /*
     * Se quita lo que rodea al documento ANTES de leerlo.
     *
     * Una foto de una cédula sobre un escritorio trae mesa, sombras y a veces
     * otros papeles; todo eso entra al reconocedor, le baja la precisión sobre
     * el documento y puede darle letras que no son del documento. Recortar
     * primero es la diferencia entre leer una tarjeta y leer una mesa con una
     * tarjeta encima.
     *
     * El recorte NO se da por bueno a ciegas: si la imagen recortada no se deja
     * clasificar, se vuelve a leer la entera antes de rechazar nada (abajo). Un
     * recorte de más nunca convierte un documento legible en un rechazo.
     *
     * Con el escáner del sistema también se recorta, a propósito. La tarjeta
     * escaneada ya llena el encuadre y la guarda del detector («si el documento
     * ya llena el encuadre, no recortes») la deja como está. Se mantiene el mismo
     * camino que por la cámara para que la fase 5 mida UNA diferencia entre las
     * dos poblaciones (recodificación y filtro) y no dos; saltarse el recorte por
     * el origen sólo ahorraba tiempo. El origen que llega es el del ANVERSO.
     */
    let encuadre = await this.images.frame(document.buffer);

    // --- 3. OCR, orientación, clasificación y análisis ----------------------
    let reverso = input.documentBackImage
      ? (await this.images.normalize(input.documentBackImage)).buffer
      : null;

    const clasificar = this.textReader.clasificadorPara(country);

    /*
     * Lectura barata, reintento sin recorte, búsqueda de orientación y —sólo si
     * hay algo que leer— una relectura FINA.
     *
     * Las pasadas de más se cobran SÓLO cuando hacen falta, y lo que decide es
     * el catálogo. La primera lectura va al tamaño barato (`ocrMaxLongEdge`),
     * que es donde el reconocedor deja de perseguir texto en el ruido de una
     * foto que no es un documento: medido, una imagen de ruido de 12 MP cuesta
     * 513 ms a 600 px de lado y 5569 ms a 1200. Quien sube una foto equivocada
     * sigue recibiendo su respuesta igual de rápido que antes.
     *
     * El reintento sin recorte estaba ya y sigue: un recorte demasiado agresivo
     * deja de ser un rechazo y pasa a ser, como mucho, una lectura más lenta.
     */
    let caras = { anverso: encuadre.buffer, reverso };
    let lectura = await this.textReader.leerCaras(
      caras,
      input,
      clasificar,
      this.options.ocrMaxLongEdge,
    );
    if (!hayIndicioDeDocumento(lectura) && encuadre.recortado) {
      caras = { anverso: document.buffer, reverso };
      lectura = await this.textReader.leerCaras(
        caras,
        input,
        clasificar,
        this.options.ocrMaxLongEdge,
      );
    }
    if (!hayIndicioDeDocumento(lectura)) {
      const enderezado = await this.orientation.buscarOrientacion(
        input,
        clasificar,
        encuadre.buffer,
      );
      if (enderezado) {
        ({ document, encuadre, reverso, lectura } = enderezado);
        caras = { anverso: encuadre.buffer, reverso };
      }
    }

    /*
     * LA RELECTURA FINA, y por qué la lectura barata no puede ser la última.
     *
     * `ocrMaxLongEdge` está calibrado para RECHAZAR barato, no para leer bien, y
     * la diferencia se mide en campos perdidos. Sobre una cédula boliviana
     * auténtica fotografiada con un móvil, en su orientación correcta y
     * perfectamente enfocada:
     *
     *   lado    cobertura   qué se lee de más
     *    600      0,216     casi nada: ni el rótulo ni las fechas
     *    900      0,463     las tres fechas y sus rótulos
     *   1200      0,515     «IDENTIDAD», y el dígito de control del número en la MRZ
     *   1600      0,664     «IDENTIFICACIÓN PERSONAL» y «DOMICILIO»
     *
     * La fila de 1200 es la que importa y no por la cobertura: a 600 y a 900 el
     * reconocedor lee la `7` de control del primer renglón de la MRZ como una
     * `T`, el dígito no cuadra y **el número de cédula y la fecha de nacimiento
     * se descartan enteros**. O sea que el tope barato no producía un rechazo,
     * producía algo peor: una verificación sin número de documento, que termina
     * en la bandeja de revisión de una persona.
     *
     * Se paga sólo cuando el catálogo ya ha visto algo. Sobre lo que no es un
     * documento —que es donde el coste duele— esta pasada no ocurre nunca.
     */
    if (
      hayIndicioDeDocumento(lectura) &&
      this.options.ocrFineLongEdge > this.options.ocrMaxLongEdge
    ) {
      const fina = await this.textReader.leerCaras(
        caras,
        input,
        clasificar,
        this.options.ocrFineLongEdge,
      );
      // Se queda la que MÁS plantilla reconoce. La fina gana casi siempre, pero
      // no siempre: a más resolución el reconocedor también encuentra más ruido,
      // y quedarse con la peor lectura por norma sería cambiar un defecto por
      // otro. El criterio es el mismo que elige la orientación.
      if (puntuarLectura(fina) >= puntuarLectura(lectura)) lectura = fina;
    }

    return { document, documentQuality, escaneado, colorDelAnverso, encuadre, reverso, lectura };
  }
}
