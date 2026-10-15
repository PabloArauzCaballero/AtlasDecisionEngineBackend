import { Inject, Injectable } from '@nestjs/common';
import { identityErrors } from '../core/domain/identity-domain.error';
import {
  ImageQualityAssessmentService,
  type ImageQualityAssessment,
} from '../core/image-quality-assessment.service';
import {
  IDENTITY_FACE_DETECTOR_PORT,
  IDENTITY_NORMALIZER_PORT,
  IDENTITY_OPTIONS,
  type IdentityOptions,
} from '../core/identity-options';
import type {
  DocumentFramerPort,
  FaceBoundingBox,
  FaceCropPort,
  FaceDetectionResult,
  FaceDetectorPort,
  ImageNormalizerPort,
  NormalizedImage,
} from '../core/ports/identity.ports';
import type { IdentityPipelineInput } from './identity-pipeline-input';

/** El retrato del documento, ya recortado para compararlo. */
export interface RetratoDelDocumento {
  face: Buffer;
  provider: string;
  /** Más de un rostro es señal de composición: se anota y se sigue. */
  variosRostros: boolean;
}

/** La selfie normalizada (y enderezada si hizo falta), con su medida de calidad. */
export interface SelfieCapturada {
  selfie: NormalizedImage;
  selfieFaces: FaceDetectionResult;
  selfieQuality: ImageQualityAssessment;
  /** Marcas de riesgo que nacen al capturarla (`SELFIE_REORIENTED`, `FACE_TOO_SMALL`). */
  riskFlags: string[];
}

/**
 * ¿Cabe el rostro con su margen dentro del encuadre?
 *
 * `crop` acota el recorte a los límites de la imagen sin avisar, así que una
 * caja pegada a un borde produce un recorte asimétrico —y una cara cortada por
 * el marco produce medio rostro—. Preguntarlo ANTES es lo que permite decidir
 * entre recortar y comparar con la imagen entera, en vez de descubrirlo cuando
 * el descriptor ya devolvió un número malo.
 */
function cajaHolgada(caja: FaceBoundingBox, margen: number): boolean {
  const padX = caja.width * margen;
  const padY = caja.height * margen;
  return (
    caja.left - padX >= 0 &&
    caja.top - padY >= 0 &&
    caja.left + caja.width + padX <= 1 &&
    caja.top + caja.height + padY <= 1
  );
}

/** Los rostros del flujo: el retrato del documento y la selfie, hasta dejarlos listos para comparar. */
@Injectable()
export class FaceCaptureService {
  constructor(
    @Inject(IDENTITY_OPTIONS) private readonly options: IdentityOptions,
    @Inject(IDENTITY_NORMALIZER_PORT)
    private readonly images: ImageNormalizerPort & FaceCropPort & DocumentFramerPort,
    @Inject(IDENTITY_FACE_DETECTOR_PORT) private readonly faces: FaceDetectorPort,
    private readonly quality: ImageQualityAssessmentService,
  ) {}

  async detectDocumentFace(
    input: IdentityPipelineInput,
    document: NormalizedImage,
  ): Promise<RetratoDelDocumento> {
    /*
     * --- 4. Rostro del documento -------------------------------------------
     *
     * DESPUÉS de clasificar, y no antes. Se probó a detectarlo primero para
     * poder tapar el retrato antes de leer —el reconocedor saca glifos de la
     * cara y los mete en el renglón del nombre—, y medido salió PEOR: el
     * reencodeado que añade tapar degradó la lectura hasta perder la fecha de
     * caducidad de un escenario y el número de otro, y bajó el parecido de
     * 0,898 a 0,869. El ruido del retrato se limpia donde no cuesta nada, que
     * es en el analizador.
     *
     * El orden también importa para los rechazos: «esto no es un documento» se
     * decide antes que «a este documento le falta el retrato». Una foto de un
     * paisaje tampoco tiene cara, y contestar lo segundo sería contestar a otra
     * pregunta.
     */
    const documentFaces = await this.faces.detectFaces({
      image: document.buffer,
      correlationId: input.correlationId,
    });
    if (documentFaces.faces.length === 0) throw identityErrors.faceNotFound();
    /*
     * El recorte sale de la imagen NORMALIZADA, y no del archivo original.
     *
     * Se probó lo contrario, con un argumento que parecía sólido: `normalize`
     * reduce a 1800 px de lado largo, así que quien fotografía el documento de
     * lejos con un móvil actual pierde detalle del retrato que SÍ estaba en el
     * archivo que subió. Recortar del original debería conservarlo.
     *
     * Medido, sale PEOR: sobre el escenario de la cédula en el escritorio el
     * parecido bajó de 0,8816 a 0,8635. La causa es un artefacto conocido de los
     * rostros sintéticos —su grano se dibuja sobre el lienzo de origen, así que
     * cambiar cuánto se remuestrea el recorte cambia cómo lo ve el descriptor—,
     * de modo que la medición no dice si la idea ayuda a una foto de verdad;
     * sólo dice que no puedo demostrarlo con lo que tengo. Y para saberlo harían
     * falta fotos de personas reales, que este repositorio no debe guardar.
     *
     * Así que se queda como estaba. Cambiar de dónde se recorta el rostro de
     * TODO el mundo apoyándose en una teoría, contra la única medición
     * disponible, no es una mejora: es una apuesta.
     */
    const face = await this.images.crop(document.buffer, documentFaces.faces[0].box);
    return {
      face,
      provider: documentFaces.provider,
      variosRostros: documentFaces.faces.length > 1,
    };
  }

  async captureSelfie(input: IdentityPipelineInput): Promise<SelfieCapturada> {
    const riskFlags: string[] = [];
    // --- 5. Selfie: normalizar, ENDEREZAR, detectar y medir ------------------
    /*
     * La selfie también se endereza, y hasta ahora no.
     *
     * El documento tenía búsqueda de orientación desde el principio y la selfie
     * no tenía ninguna, aunque las dos llegan de la misma cámara del mismo
     * teléfono. Medido con el detector de este mismo worker sobre un rostro que
     * a 0° se detecta con puntuación 1,000: girado 90°, 180° o 270° devuelve
     * **CERO rostros** en los tres casos. O sea que una selfie tumbada no
     * producía un parecido bajo —producía `IDENTITY_FACE_NOT_FOUND`, un fallo
     * duro, sobre una foto en la que la cara está perfectamente visible.
     *
     * Ocurre más de lo que parece: una captura de cámara sin metadatos de
     * orientación, un teléfono sostenido de lado, o un cliente que sube el
     * archivo tal cual sale del sensor. `normalize` ya aplica la orientación
     * EXIF, pero eso sólo arregla las imágenes que la traen.
     *
     * El coste es cero para quien manda la selfie derecha: sólo se prueban giros
     * cuando la detección ya iba a terminar en fallo duro.
     */
    let selfie = await this.images.normalize(input.selfieImage);
    let selfieFaces = await this.faces.detectFaces({
      image: selfie.buffer,
      correlationId: input.correlationId,
    });
    if (selfieFaces.faces.length === 0) {
      const enderezada = await this.enderezarSelfie(input);
      if (enderezada) {
        ({ selfie, selfieFaces } = enderezada);
        riskFlags.push('SELFIE_REORIENTED');
      }
    }
    if (selfieFaces.faces.length === 0) throw identityErrors.faceNotFound();
    if (selfieFaces.faces.length > 1) throw identityErrors.multipleFaces();
    const selfieQuality = this.quality.selfie(selfie.quality, selfieFaces.faces[0]);
    /*
     * El mismo rechazo por puntaje que había arriba, y con el mismo defecto.
     *
     * Medido: una selfie de 480×480 —una captura de webcam corriente, y
     * exactamente el mínimo que la fórmula pedía a lo ancho Y a lo alto— se
     * rechazaba con `IDENTITY_SELFIE_INVALID`; con el gate apagado esa misma
     * imagen compara a 0,9282 y verifica. A 96×96 todavía compara a 0,9040. La
     * puerta estaba cinco veces por encima de donde la biometría deja de
     * funcionar.
     *
     * Lo que SÍ prueba que una selfie sirve ya está comprobado dos líneas más
     * arriba: se detectó un rostro, y uno solo. Sin rostro no se sigue
     * (`faceNotFound`), con varios tampoco (`multipleFaces`). Lo que la medida
     * añada viaja como señal —`LOW_FACE_QUALITY` al motor de decisión, y los
     * avisos enteros en el resultado—, no como un portazo.
     */
    if (selfieQuality.warnings.includes('FACE_TOO_SMALL')) riskFlags.push('FACE_TOO_SMALL');
    return { selfie, selfieFaces, selfieQuality, riskFlags };
  }

  /**
   * Recorta un rostro para compararlo, o devuelve la imagen entera si no se
   * puede.
   *
   * `crop` se niega a entregar un recorte por debajo de `minDocumentFacePx`, y
   * esa negativa es correcta para el DOCUMENTO —un retrato diminuto no da una
   * comparación fiable y el caso debe pararse—. Para la selfie no: allí el
   * rostro ya se detectó, la comparación va a ocurrir de todos modos, y
   * convertir un recorte imposible en un fallo duro sería endurecer por un
   * detalle de preprocesado. Se cae a lo que había antes, que es comparar con la
   * imagen entera.
   */
  async recortarRostro(imagen: Buffer, caja: FaceBoundingBox): Promise<Buffer> {
    /*
     * Un rostro que TOCA el borde del encuadre no se recorta.
     *
     * Cuando la cara está cortada por el marco, el detector devuelve una caja
     * pegada al borde y el margen del recorte no cabe: `crop` lo recorta contra
     * los límites de la imagen y entrega media cara ampliada, con un encuadre
     * que no se parece al del retrato del documento. Medido sobre una imagen en
     * la que la caja llegaba justo al borde inferior (`top` 0,565 + alto 0,435 =
     * 1,000), el parecido del MISMO rostro caía de 0,7971 con la imagen entera a
     * 0,6245 con el recorte: el recorte convertía una comparación mediocre en un
     * rechazo.
     *
     * En ese caso se compara con la imagen entera —que es lo que se hacía
     * siempre antes— porque el contexto de alrededor es justo lo que le falta al
     * recorte. La simetría se pierde, y perderla aquí es mejor que imponerla
     * sobre media cara.
     */
    if (!cajaHolgada(caja, this.options.faceCropPaddingRatio)) return imagen;
    try {
      return await this.images.crop(imagen, caja);
    } catch {
      return imagen;
    }
  }

  /**
   * Endereza la SELFIE cuando la detección no encontró ningún rostro.
   *
   * Es el hermano de `buscarOrientacion`, y existe por la misma medición: el
   * detector de este worker puntúa 1,000 sobre un rostro derecho y devuelve CERO
   * rostros sobre el mismo rostro girado un cuarto de vuelta, media o tres
   * cuartos. Sin esto, una selfie tumbada no bajaba el parecido: producía
   * `IDENTITY_FACE_NOT_FOUND`, un fallo duro, sobre una foto correcta.
   *
   * Se gira el ORIGINAL y se vuelve a normalizar, no la imagen ya normalizada,
   * por lo mismo que en el documento: `normalize` entrega un JPEG y girar
   * después deja los artefactos del bloque atravesados sobre los rasgos, que es
   * justo de donde sale el descriptor biométrico.
   *
   * Se prueban los TRES giros y gana el de MAYOR puntuación del detector, no el
   * primero que encuentre una cara. La diferencia no es teórica: sobre una
   * selfie girada un cuarto de vuelta, pararse en el primer acierto elegía el
   * giro que la deja boca abajo —el detector todavía encuentra algo ahí— y el
   * parecido salía 0,3259 en vez de 0,7970. Un rostro invertido no es un fallo
   * de detección, es una detección MALA, y sólo comparar las tres las separa.
   * Es el mismo criterio con el que se endereza el documento, y por lo mismo.
   *
   * Sólo cuenta un giro con EXACTAMENTE un rostro. Varios rostros no valen como
   * acierto: ése es un caso que el flujo rechaza aparte, y aceptarlo aquí
   * escondería el rechazo detrás de un giro.
   */
  private async enderezarSelfie(input: IdentityPipelineInput): Promise<{
    selfie: NormalizedImage;
    selfieFaces: FaceDetectionResult;
  } | null> {
    let mejor: {
      selfie: NormalizedImage;
      selfieFaces: FaceDetectionResult;
      puntos: number;
    } | null = null;

    for (const grados of [90, 180, 270] as const) {
      const selfie = await this.images.normalize(
        await this.images.rotate(input.selfieImage, grados),
      );
      const selfieFaces = await this.faces.detectFaces({
        image: selfie.buffer,
        correlationId: input.correlationId,
      });
      if (selfieFaces.faces.length !== 1) continue;
      const puntos = selfieFaces.faces[0]?.quality ?? 0;
      if (!mejor || puntos > mejor.puntos) mejor = { selfie, selfieFaces, puntos };
    }

    return mejor ? { selfie: mejor.selfie, selfieFaces: mejor.selfieFaces } : null;
  }
}
