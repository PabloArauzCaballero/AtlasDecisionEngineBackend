import { Inject, Injectable } from '@nestjs/common';
import { IdentityDecisionEngine } from './core/domain/identity-decision.engine';
import { IdentityDecision, IdentityDocumentType } from './core/domain/identity-enums';
import { identityErrors } from './core/domain/identity-domain.error';
import type { ExtractedIdentityData } from './core/domain/extracted-identity.types';
import { ImageQualityAssessmentService } from './core/image-quality-assessment.service';
import {
  IDENTITY_ARBITRATION_PORT,
  IDENTITY_CLASSIFIER_PORT,
  IDENTITY_EMBEDDER_PORT,
  IDENTITY_FACE_DETECTOR_PORT,
  IDENTITY_FACE_MATCH_PORT,
  IDENTITY_LIVENESS_PORT,
  IDENTITY_NORMALIZER_PORT,
  IDENTITY_OCR_PORT,
  IDENTITY_OPTIONS,
  type IdentityOptions,
} from './core/identity-options';
import { DocumentParserRegistry } from './core/parsers/document-parser.registry';
import { medirEvidenciaDeIdentidad } from './core/engine/identity-evidence';
import { reconocerCedulaBoliviana } from './core/catalog/bolivia-ci.recognizer';
import { triageIdentityDocument, type IdentityGateOutcome } from './core/engine/identity-triage';
import { mrzDiagnostics, parseMrzTd1 } from './core/parsers/mrz-td1';
import { analizarPlantilla } from './core/forensics/template-conformance';
import { analizarManipulacion } from './core/forensics/image-tamper.analyzer';
import {
  clasificarSemanticamente,
  type IdentityEmbedderPort,
} from './core/forensics/identity-semantic.classifier';
import { evaluarFraude, type EvaluacionDeFraude } from './core/forensics/identity-fraud.scorer';
import { isoDateToUtcDate } from './core/parsers/spanish-date';
import type { DocumentParser } from './core/parsers/document-parser';
import type {
  DocumentClassificationResult,
  DocumentClassifierPort,
  DocumentFraming,
  DocumentFramerPort,
  DocumentOcrPort,
  DocumentOcrResult,
  FaceBoundingBox,
  FaceCropPort,
  FaceDetectionResult,
  FaceDetectorPort,
  FaceMatchPort,
  FaceMatchResult,
  IdentityArbitrationPort,
  ImageNormalizerPort,
  LivenessPort,
  LivenessResult,
  NormalizedImage,
} from './core/ports/identity.ports';

/**
 * Lado largo de las SONDAS de orientación, en píxeles.
 *
 * No es el tamaño con el que se lee un documento: es el tamaño con el que se
 * decide si hay que leerlo. Va en 800 porque ahí sigue habiendo de sobra para
 * la parte del texto que clasifica —el rótulo es lo más grande impreso en la
 * tarjeta— y porque es donde el coste deja de doler.
 *
 * Medido con `scripts/medir-rechazo-identidad.ts` sobre una foto de móvil que
 * no es un documento: 6516 ms a 1350x1800, 2435 ms a 900x1200, 1038 ms a
 * 600x800. Y en el otro lado, la cédula sintética reducida a 1000 px de lado
 * largo entrega LAS MISMAS señales y la misma evidencia (0,75) que entera.
 *
 * Bajarlo más no compra casi nada —de 600x800 a 450x600 son 140 ms— y empieza a
 * arriesgar el rótulo de una cédula fotografiada pequeña dentro del encuadre.
 */
const ORIENTATION_PROBE_LONG_EDGE = 600;

/** Lo que sale de leer una o las dos caras y clasificarlas juntas. */
interface Lectura {
  ocr: DocumentOcrResult;
  front: DocumentOcrResult;
  back: DocumentOcrResult | null;
  classification: DocumentClassificationResult;
}

/** El par de imágenes que se está leyendo. El reverso es opcional siempre. */
interface CarasDelDocumento {
  readonly anverso: Buffer;
  readonly reverso: Buffer | null;
}

/** Clasificar recibe las dos caras POR SEPARADO: el catálogo sitúa cada anclaje en la suya. */
type Clasificador = (anverso: string, reverso: string) => Promise<DocumentClassificationResult>;

/**
 * Cuánta plantilla de cédula boliviana se reconoce en una lectura, en `[0, 1]`.
 *
 * Es la MISMA medida que usa el clasificador para nombrar el documento y la
 * misma que después juzga `identity-fraud.scorer.ts`, y que sea la misma es
 * deliberado: con dos escalas distintas, una lectura podría ser «suficiente»
 * para elegir una orientación y «plantilla incompleta» para el análisis de
 * fraude en la misma ejecución.
 *
 * Aquí se usa como PUNTAJE RELATIVO y no contra un umbral. Es lo que permite
 * elegir orientación a 600 px, donde ninguna lectura llega a cruzar ningún
 * umbral y aun así sólo una de las cuatro saca algo distinto de cero.
 */
function puntuarLectura(lectura: Lectura): number {
  return reconocerCedulaBoliviana({
    textoAnverso: lectura.front.rawText,
    textoReverso: lectura.back?.rawText ?? '',
  }).mejor.cobertura;
}

/**
 * ¿Hay motivo para seguir gastando reconocedor en esta imagen?
 *
 * Es la condición que sustituye a «el clasificador no supo decir qué es». Aquélla
 * era binaria y a tamaño barato contestaba que no sobre cédulas perfectamente
 * legibles, de modo que el reintento sin recorte y la búsqueda de orientación
 * —las dos vías que rescatan una foto— se disparaban o no según un umbral que la
 * foto real no alcanzaba nunca.
 *
 * Basta CUALQUIERA de las dos: que el clasificador ya sepa el tipo, o que el
 * catálogo reconozca aunque sea un anclaje. La segunda es la que rescata la foto
 * tumbada; la primera, la que evita medir dos veces lo que ya está decidido.
 */
function hayIndicioDeDocumento(lectura: Lectura): boolean {
  if (lectura.classification.type !== IdentityDocumentType.UNKNOWN) return true;
  return puntuarLectura(lectura) > 0;
}
import { maskDocumentNumber, type IdentityVerificationOutcome } from './identity-result';

export interface IdentityPipelineInput {
  readonly documentImage: Buffer;
  readonly documentBackImage?: Buffer | null;
  readonly selfieImage: Buffer;
  readonly documentCountry: string;
  readonly correlationId: string;
  /*
   * Aquí había una `scenarioHint`: el código del escenario, que viajaba hasta
   * los proveedores para que eligieran el desenlace. Ya no existe, y quitarla es
   * parte de que la biometría sea real. Con proveedores que miran las imágenes
   * no la lee nadie, y dejarla puesta habría conservado un canal por el que
   * quien llama podía influir en un veredicto de identidad. Hoy el desenlace de
   * un escenario lo deciden sus IMÁGENES: qué cara lleva el documento y qué cara
   * lleva la selfie.
   */
  /**
   * La entrada la FABRICÓ el motor para un escenario del catálogo.
   *
   * Sólo apaga la prueba de vida, y por una razón que no es de comodidad: una
   * imagen generada no es una captura en vivo, y el antispoof lo sabe. Medido
   * sobre los rostros dibujados de `identity-faces.ts`, puntúa entre 0,44 y 0,67
   * —ni convencido de que sea real ni de que sea un ataque—, que es justo lo que
   * debe responder ante un dibujo. Bajar el listón para que pasaran habría
   * debilitado la defensa contra una foto impresa, que es el ataque que este
   * control existe para parar.
   *
   * Así que en vez de fingir que la superó, se declara que NO SE EJECUTÓ, y el
   * resultado lo dice. El motor de decisión trata `NOT_RUN` como señal ausente,
   * nunca como éxito.
   *
   * No es una puerta trasera: lo pone el servidor a partir de que la ejecución
   * naciera del catálogo, nunca quien sube un archivo, y los escenarios están
   * apagados en producción (`WORKERS_FIXTURES_ENABLED`). La COMPARACIÓN
   * BIOMÉTRICA de un escenario es real y completa; esto sólo afecta a la prueba
   * de vida, que sobre una imagen fabricada no tiene nada que medir.
   */
  readonly entradaGenerada?: boolean;
  /**
   * El tipo de documento que YA decidió un árbitro, si alguien lo decidió.
   *
   * Es lo que cierra el bucle. Un caso derivado a la cola vuelve al worker
   * cuando una persona confirma qué documento es, y sin este dato la puerta
   * volvería a dudar exactamente igual y a devolverlo a la misma cola por el
   * mismo motivo, para siempre. Con él, la puerta no pregunta: la respuesta ya
   * está dada, se anota en las marcas de riesgo —`DOCUMENT_ARBITRATED`, para que
   * el veredicto final diga que hubo una mano humana— y el camino sigue.
   *
   * Lo pone el SERVICIO de fondo leyendo la fila resuelta, nunca quien sube un
   * archivo: es una decisión de un rol autorizado, no un parámetro de entrada.
   */
  readonly arbitratedDocumentType?: IdentityDocumentType | null;
  /** Se invoca al terminar cada etapa, con el avance en tanto por ciento. */
  readonly onProgress?: (progress: number) => Promise<void>;
}

/**
 * Ejecuta la verificación completa en una sola pasada.
 *
 * El paquete original repartía estas etapas entre cuatro trabajos de pg-boss
 * encadenados (`document.process` → `selfie.process` → `liveness.process` →
 * `face-match.process`) porque su protocolo de captura es de varios pasos: la
 * persona fotografía el documento desde el móvil y la selfie llega minutos
 * después. Aquí las dos imágenes llegan JUNTAS en una sola petición, así que
 * encadenar cuatro trabajos sólo añadiría tres viajes a la base y tres estados
 * intermedios que nadie puede observar. Lo que se conserva íntegro es el ORDEN
 * y el contenido de cada etapa, y el motor de decisión que las cierra.
 *
 * Nada de esto se persiste aquí: el servicio de fondo es quien escribe la fila.
 * Esta clase es pura salvo por las llamadas a los proveedores.
 */
@Injectable()
export class IdentityPipelineService {
  private readonly decisionEngine = new IdentityDecisionEngine();

  constructor(
    @Inject(IDENTITY_OPTIONS) private readonly options: IdentityOptions,
    @Inject(IDENTITY_NORMALIZER_PORT)
    private readonly images: ImageNormalizerPort & FaceCropPort & DocumentFramerPort,
    @Inject(IDENTITY_OCR_PORT) private readonly ocr: DocumentOcrPort,
    @Inject(IDENTITY_CLASSIFIER_PORT) private readonly classifier: DocumentClassifierPort,
    @Inject(IDENTITY_FACE_DETECTOR_PORT) private readonly faces: FaceDetectorPort,
    @Inject(IDENTITY_FACE_MATCH_PORT) private readonly faceMatch: FaceMatchPort,
    @Inject(IDENTITY_LIVENESS_PORT) private readonly liveness: LivenessPort,
    @Inject(IDENTITY_ARBITRATION_PORT)
    private readonly arbitration: IdentityArbitrationPort,
    /*
     * El codificador es OPCIONAL, y ese `null` es parte del contrato: un
     * despliegue sin servidor de embeddings tiene que seguir verificando
     * identidades, sabiendo que le falta una prueba. Lo que no puede es aprobar
     * como si la hubiera hecho — de eso se encarga el modo estricto del fusor.
     */
    @Inject(IDENTITY_EMBEDDER_PORT)
    private readonly embedder: IdentityEmbedderPort | null,
    private readonly parsers: DocumentParserRegistry,
    private readonly quality: ImageQualityAssessmentService,
  ) {}

  async run(input: IdentityPipelineInput): Promise<IdentityVerificationOutcome> {
    const country = (input.documentCountry || this.options.defaultDocumentCountry).toUpperCase();
    const riskFlags: string[] = [];

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
     */
    let encuadre = await this.images.frame(document.buffer);

    // --- 3. OCR, orientación, clasificación y análisis ----------------------
    let reverso = input.documentBackImage
      ? (await this.images.normalize(input.documentBackImage)).buffer
      : null;

    const clasificar = (anverso: string, reversoLeido: string) =>
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
    let lectura = await this.leerCaras(caras, input, clasificar, this.options.ocrMaxLongEdge);
    if (!hayIndicioDeDocumento(lectura) && encuadre.recortado) {
      caras = { anverso: document.buffer, reverso };
      lectura = await this.leerCaras(caras, input, clasificar, this.options.ocrMaxLongEdge);
    }
    if (!hayIndicioDeDocumento(lectura)) {
      const enderezado = await this.buscarOrientacion(input, clasificar, encuadre.buffer);
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
      const fina = await this.leerCaras(caras, input, clasificar, this.options.ocrFineLongEdge);
      // Se queda la que MÁS plantilla reconoce. La fina gana casi siempre, pero
      // no siempre: a más resolución el reconocedor también encuentra más ruido,
      // y quedarse con la peor lectura por norma sería cambiar un defecto por
      // otro. El criterio es el mismo que elige la orientación.
      if (puntuarLectura(fina) >= puntuarLectura(lectura)) lectura = fina;
    }

    const { ocr, front, back, classification } = lectura;

    /*
     * Si no se reconoce un documento de identidad, esto NO produce veredicto.
     *
     * Es la diferencia entre «no puedo afirmar que sean la misma persona» y «lo
     * que me diste no es un documento». Sin esta guarda, una foto cualquiera
     * seguía el camino entero —el analizador genérico devuelve dos campos
     * derivados y ninguno obligatorio— y salía por la puerta de la revisión
     * manual, cargándole a una persona una cola de fotos de gatos. Peor: con un
     * lector que invente el texto, salía VERIFICADA.
     *
     * Se corta ANTES de comparar rostros: la comparación biométrica es la parte
     * cara y no hay nada que comparar contra un documento que no existe. Es
     * error de VALIDACIÓN, así que el servicio de fondo no lo reencola —una
     * imagen que no es un documento no va a serlo en el segundo intento—.
     */
    /*
     * Y aquí, con la lectura ya intentada, se elige QUÉ se contesta.
     *
     * Es el sitio donde el consejo de calidad vale de algo: sólo cuando la
     * lectura ha fallado tiene sentido decir «está oscura» o «está movida», y
     * sólo entonces se sabe además que no era simplemente otra cosa. Antes se
     * decía sin haber leído, y por eso se lo llevaban fotos legibles.
     *
     * El orden es deliberado: si la medida señala un defecto REAL de captura
     * —poca luz, quemada, movida, diminuta— se contesta eso, porque se arregla
     * repitiendo la foto. Si la imagen estaba bien y aun así no es un documento,
     * se contesta lo otro, que se arregla subiendo otra cosa.
     *
     * Y se miran DEFECTOS CONCRETOS, no el puntaje. El puntaje es una suma
     * ponderada donde resolución y exposición juntas ya pasan el mínimo, así que
     * una imagen grande y bien expuesta lo supera por muy plana que esté: como
     * instrumento para explicar un fallo no sirve.
     */
    /*
     * LA PUERTA. Tres desenlaces donde antes había uno.
     *
     * Lo que cambió no es el rigor —una foto de un gato se sigue rechazando—
     * sino a QUIÉN se le dice qué. Antes toda imagen sin tipo reconocible salía
     * por `IDENTITY_DOCUMENT_UNSUPPORTED`, de modo que la cédula fotografiada de
     * noche y el recibo del supermercado recibían la misma respuesta y el mismo
     * desenlace. Ahora se mide la EVIDENCIA de que haya un documento de
     * identidad —independiente de cuál sea— y esa medida separa las tres cosas:
     * lo que se rechaza, lo que se pregunta y lo que sigue.
     *
     * El defecto de captura conserva su prioridad sobre todo lo demás: si la
     * medición señala un problema real —oscura, quemada, movida— se contesta
     * eso, porque se arregla repitiendo la foto y es la única respuesta que
     * desbloquea a quien está delante del móvil.
     */
    const evidencia = medirEvidenciaDeIdentidad({
      texto: `${front.rawText}\n${back?.rawText ?? ''}`,
      anchoLargo: Math.max(document.quality.width, document.quality.height),
      ladoCorto: Math.min(document.quality.width, document.quality.height),
    });
    /*
     * Un documento ya arbitrado no vuelve a pasar por la puerta.
     *
     * Quien confirmó tenía delante la misma foto y más contexto del que la
     * puerta puede medir —el expediente, el trámite, a veces la persona—, así
     * que volver a preguntarle a un puntaje sería devolver el caso a la cola de
     * la que acaba de salir. Queda constancia en las marcas de riesgo: el
     * veredicto final tiene que poder decir que aquí hubo una mano humana.
     */
    if (input.arbitratedDocumentType != null) {
      riskFlags.push('DOCUMENT_ARBITRATED');
    }
    const puerta: IdentityGateOutcome =
      input.arbitratedDocumentType != null
        ? { verdict: 'ACCEPT', documentType: input.arbitratedDocumentType }
        : triageIdentityDocument({
            evidence: evidencia,
            documentType: classification.type,
            acceptedTypes: this.options.acceptedDocumentTypes,
            thresholds: {
              accept: this.options.documentAcceptConfidence,
              review: this.options.documentReviewConfidence,
            },
          });

    if (puerta.verdict === 'REJECT') {
      /*
       * El aviso de calidad manda SÓLO cuando el rechazo fue por falta de
       * evidencia. Si lo que se reconoció fue otro documento —o un tipo que este
       * flujo no admite— la foto está perfectamente bien y decirle a alguien que
       * repita la captura le hace perder el intento siguiente sin arreglar nada.
       */
      if (
        puerta.reason !== 'UNSUPPORTED_DOCUMENT_TYPE' &&
        evidencia.contraindicator === null &&
        documentQuality.warnings.some((aviso) => DEFECTOS_DECISIVOS.includes(aviso))
      ) {
        throw identityErrors.blurryDocument(documentQuality.warnings);
      }
      if (puerta.reason === 'UNSUPPORTED_DOCUMENT_TYPE') {
        throw identityErrors.documentTypeNotAccepted(puerta.detail);
      }
      throw identityErrors.notAnIdentityDocument(
        `${puerta.detail} ${describeUnreadable(ocr)}`.trim(),
        puerta.reason,
      );
    }

    if (puerta.verdict === 'REVIEW') {
      /*
       * La franja de duda, y el ÚNICO sitio del worker que delega en alguien.
       *
       * Se corta ANTES de la biometría a propósito: comparar rostros es la parte
       * cara, y no hay nada que comparar contra un documento del que todavía no
       * se sabe si lo es. Quien conteste —persona hoy, modelo mañana— decide eso
       * primero; si acepta, el caso se relanza y recorre el camino completo.
       */
      const veredicto = await this.arbitration.arbitrate({
        correlationId: input.correlationId,
        reason: puerta.reason,
        detail: puerta.detail,
        documentType: classification.type,
        evidenceConfidence: evidencia.confidence,
        signals: evidencia.signals,
      });

      if (veredicto.outcome === 'REJECT_DOCUMENT') {
        throw identityErrors.notAnIdentityDocument(veredicto.rationale, 'NOT_AN_IDENTITY_DOCUMENT');
      }

      /*
       * UN ÁRBITRO QUE NO ES UNA PERSONA PUEDE ESCALAR, NUNCA APROBAR.
       *
       * No es desconfianza genérica hacia los modelos: es que la pregunta que
       * llega hasta aquí no se contesta con lo que un árbitro de texto ve. La
       * franja de duda se abre cuando hay evidencia de un documento y no basta
       * para afirmar cuál es, y lo que separa una cédula legítima de una
       * falsificada NO está en el texto —el texto de una falsificación es el de
       * un documento auténtico, porque se copió de uno— sino en los píxeles, que
       * es lo que mira `core/forensics/`. Un árbitro que aprobara leyendo el
       * texto estaría dando por buena justamente la parte que el falsificador
       * copia bien.
       *
       * Así que el `ACCEPT_DOCUMENT` de un árbitro que no es humano se degrada a
       * «sigue en la cola». Escalar sí puede —`REJECT_DOCUMENT` sigue valiendo—:
       * negarse no aprueba nada, y ahí un modelo sí descarga trabajo de la
       * bandeja.
       *
       * Que ocurrió se cuenta en el MOTIVO del error, y no en una marca de
       * riesgo: las marcas viajan dentro del resultado, y aquí no va a haber
       * resultado —esto termina en una excepción y el caso queda abierto—. Una
       * marca empujada justo antes de un `throw` no la lee nadie.
       *
       * Se mira `mode` Y `decidedBy`: el primero es lo que el despliegue
       * configuró y el segundo lo que el adaptador dice de sí mismo. Con
       * cualquiera de los dos basta, porque un adaptador con un fallo podría
       * firmar como humano y la regla tiene que aguantar eso.
       *
       * Cuando exista un árbitro automático que MIRE los píxeles, esta regla
       * cambia aquí y en un solo sitio, deliberadamente y no por descuido.
       */
      const arbitroAutomatico = this.arbitration.mode === 'AI' || veredicto.decidedBy === 'AI';
      if (arbitroAutomatico && veredicto.outcome === 'ACCEPT_DOCUMENT') {
        throw identityErrors.arbitrationPending(
          `El árbitro automático (${veredicto.provider}) dio el documento por bueno, y eso no ` +
            `aprueba por sí solo: la autenticidad se decide sobre la imagen y no sobre el texto. ` +
            `El caso sigue en la bandeja. Motivo del árbitro: ${veredicto.rationale}`,
          puerta.reason,
          this.options.arbitrationMode,
        );
      }
      /*
       * Aceptar sin poder nombrar el tipo no es aceptar: sin tipo no hay
       * analizador, y seguir adelante significaría leer una cédula con el
       * analizador equivocado. Se vuelve a la cola con el mismo motivo, que es
       * la respuesta honesta —«sí es un documento, pero sigo sin saber cuál»—.
       */
      if (
        veredicto.outcome !== 'ACCEPT_DOCUMENT' ||
        classification.type === IdentityDocumentType.UNKNOWN
      ) {
        throw identityErrors.arbitrationPending(
          veredicto.rationale,
          puerta.reason,
          this.options.arbitrationMode,
        );
      }
    }

    /*
     * El tipo que manda es el de la PUERTA, no el del clasificador.
     *
     * Coinciden siempre salvo en un caso, y es justo el que importa: cuando una
     * persona arbitró, ella dijo qué documento es y el clasificador seguía sin
     * saberlo. Leer aquí `classification.type` habría elegido el analizador
     * genérico para una cédula que alguien acababa de identificar.
     */
    const tipoResuelto = puerta.verdict === 'ACCEPT' ? puerta.documentType : classification.type;
    const parser = this.parsers.resolve({ type: tipoResuelto, country });
    const parsed = await parser.parse({ ocr, context: { type: tipoResuelto, country } });
    if (back) this.assertSidesAgree(parser, front, back, parsed.warnings);
    riskFlags.push(...parsed.warnings);

    /*
     * --- 3.bis. ¿Es un carnet AUTÉNTICO? ------------------------------------
     *
     * La puerta de arriba contestó «¿es un carnet?». Ésta contesta la siguiente,
     * y es la que separa el fraude: el texto de una falsificación es el de un
     * documento auténtico —porque se copió de uno—, así que la puerta de
     * evidencia la aprueba con holgura. Lo que una falsificación NO puede
     * imitar a la vez es la plantilla completa del SEGIP, la aritmética interna
     * de sus propios datos y la física de la imagen.
     *
     * Va AQUÍ, después del analizador y antes de la biometría, por dos razones.
     * Necesita los campos ya extraídos —sin ellos no hay aritmética que
     * comprobar— y la biometría es la etapa cara: si el documento no es
     * auténtico, comparar su retrato con la selfie sólo respondería a la
     * pregunta equivocada con precisión.
     *
     * Las tres pruebas corren EN PARALELO: son independientes, dos de ellas
     * salen de la red o del procesador de imagen, y encadenarlas sumaría sus
     * latencias en el camino caliente de cada verificación.
     */
    const fraude = await this.analizarFraude({
      textoAnverso: front.rawText,
      textoReverso: back?.rawText ?? '',
      campos: parsed.fields,
      rawText: ocr.rawText,
      documento: document.buffer,
      entradaGenerada: input.entradaGenerada === true,
    });
    if (fraude) {
      riskFlags.push(...fraude.motivos);
      if (fraude.veredicto === 'FRAUD_SUSPECTED') riskFlags.push('FRAUD_SUSPECTED');
      if (fraude.veredicto === 'REVIEW') riskFlags.push('DOCUMENT_AUTHENTICITY_DOUBTFUL');
    }

    await input.onProgress?.(40);

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
    // Más de un rostro en un documento es señal de composición, no un fallo de
    // captura: se anota y se sigue, para que la decisión la tome una persona.
    if (documentFaces.faces.length > 1) riskFlags.push('MULTIPLE_FACES');
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
    const documentFace = await this.images.crop(document.buffer, documentFaces.faces[0].box);
    await input.onProgress?.(55);

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
    await input.onProgress?.(70);

    // --- 6. Prueba de vida --------------------------------------------------
    const liveness: LivenessResult = input.entradaGenerada
      ? { outcome: 'NOT_RUN', provider: 'entrada-generada' }
      : await this.liveness.verify({
          selfie: selfie.buffer,
          correlationId: input.correlationId,
        });
    // Que la ejecución LLEVE la marca, y no sólo el proveedor: es lo que impide
    // leer un «VERIFICADO» de escenario como uno de una persona ante la cámara.
    if (input.entradaGenerada) riskFlags.push('GENERATED_INPUT_NO_LIVENESS');
    await input.onProgress?.(80);

    // --- 7. Comparación biométrica -----------------------------------------
    // Si la prueba de vida falló no se compara: el desenlace ya está decidido y
    // comparar sólo gastaría una llamada al proveedor. Es lo que hacía el
    // paquete original.
    /*
     * Las DOS caras se recortan igual antes de compararse.
     *
     * Antes no: el documento entraba recortado al rostro y remuestreado, y la
     * selfie entraba ENTERA. Es una asimetría que el descriptor sí ve, y lo que
     * cuesta está medido sobre el retrato de una cédula real comparado consigo
     * mismo por los dos caminos: **0,9157**. No es la diferencia entre dos
     * personas —es literalmente el mismo rostro— y el umbral de aprobación del
     * perfil de laboratorio está en 0,8824. O sea que el preprocesado se comía
     * casi todo el margen antes de que la comparación empezara.
     *
     * Y lo peor no es la media sino la INESTABILIDAD. Midiendo el mismo rostro
     * contra escenas donde ocupa distinta parte del encuadre:
     *
     *   rostro en el encuadre   selfie entera (antes)   recortada (ahora)
     *   100 %                   0,9893                  0,9652
     *    50 %                   0,9855                  0,9693
     *    25 %                   0,9759                  0,9583
     *    12 %                   0,9617                  0,9818
     *     6 %                   0,5694                  0,9322
     *
     * Con la selfie entera, el parecido de una MISMA persona depende de lo lejos
     * que sostuviera el teléfono, y a brazo extendido se desploma por debajo de
     * cualquier umbral. Recortando las dos, el peor caso de todo el barrido es
     * 0,9322. Un umbral sólo significa algo si la cifra que corta no depende del
     * encuadre.
     *
     * Si el recorte de la selfie falla —un rostro diminuto que no llega al
     * mínimo de `crop`— se compara con la imagen entera, que es lo que había:
     * un recorte imposible no puede convertir una comparación en un fallo duro.
     */
    const selfieFace = await this.recortarRostro(selfie.buffer, selfieFaces.faces[0].box);

    const match: FaceMatchResult | null =
      liveness.outcome === 'FAILED'
        ? null
        : await this.faceMatch.compare({
            documentFace,
            selfieFace,
            correlationId: input.correlationId,
          });
    await input.onProgress?.(90);

    /*
     * Que el umbral NO esté medido contra personas viaja en el resultado.
     *
     * Los cortes del compose —0,8824 y 0,7789— salieron de `calibrar-identidad`
     * sobre los rostros DIBUJADOS de `fixtures/identity-faces.ts`, y el nombre
     * del perfil lo dice. El esquema de entorno ya prohíbe ese perfil en
     * producción, pero en desarrollo y en las pruebas decidía en silencio: quien
     * leía un `AMBIGUOUS_MATCH` no tenía forma de saber que la cifra que lo
     * produjo no predice ninguna tasa de error sobre caras reales.
     *
     * Es una marca, no una escalada. Escalar por esto mandaría a revisión toda
     * verificación de todo entorno no calibrado, que es lo mismo que apagar el
     * worker; lo que hace falta es que el caso DIGA contra qué se decidió.
     */
    if (/^sintetico/i.test(this.options.thresholdProfileVersion)) {
      riskFlags.push('THRESHOLD_PROFILE_UNMEASURED');
    }

    // --- 8. Decisión --------------------------------------------------------
    const fields = parsed.fields;
    const decided = this.decisionEngine.decide({
      documentQuality: documentQuality.score,
      selfieQuality: selfieQuality.score,
      requiredFieldsPresent: requiredFieldsPresent(fields),
      liveness: liveness.outcome,
      faceSimilarity: match && match.comparable ? match.similarityScore : null,
      documentExpiresAt: isoDateToUtcDate(fields.expirationDate?.value),
      documentExpiryGraceDays: this.options.documentExpiryGraceDays,
      now: new Date(),
      ...(this.options.matchThreshold !== undefined
        ? { matchThreshold: this.options.matchThreshold }
        : {}),
      ...(this.options.reviewThreshold !== undefined
        ? { reviewThreshold: this.options.reviewThreshold }
        : {}),
      minDocumentQuality: this.options.minDocumentQuality,
      minSelfieQuality: this.options.minSelfieQuality,
    });

    /*
     * Varios rostros en el documento ESCALAN, no se anotan y ya está.
     *
     * El motor de decisión no ve esta señal —trabaja con calidades, campos,
     * prueba de vida y parecido—, así que dejarla sólo como marca de riesgo
     * permitiría un VERIFICADO sobre un documento en el que hay dos caras, que
     * es la firma de una composición. El paquete original mandaba estos casos a
     * revisión manual y aquí se conserva. Nunca al revés: un rechazo no se
     * suaviza a revisión por esto.
     *
     * `FACE_TOO_SMALL` entra por la misma puerta desde que la selfie dejó de
     * rechazarse por puntaje: el rostro se detectó y se comparó, así que hay
     * cifra, pero un rostro que ocupa una parte diminuta del encuadre no debe
     * poder cerrar un VERIFICADO él solo. Escalar conserva la cautela que hacía
     * el rechazo sin negarle un veredicto a quien mandó una foto pequeña.
     */
    /*
     * La autenticidad del documento entra por la MISMA puerta.
     *
     * El motor de decisión no ve el análisis de fraude —trabaja con calidades,
     * campos, prueba de vida y parecido—, así que dejarlo sólo como marca de
     * riesgo permitiría un VERIFICADO sobre un documento del que se sospecha que
     * está falsificado. Que sea el mismo mecanismo que ya escalaba
     * `MULTIPLE_FACES` no es casual: son la misma clase de señal —evidencia que
     * la aritmética biométrica no puede ver— y merecen el mismo trato.
     *
     * Y como allí, sólo escala hacia ARRIBA: un rechazo nunca se suaviza a
     * revisión porque el documento parezca auténtico. Que el carnet sea legítimo
     * no convierte en la misma persona a las dos caras que se compararon.
     */
    const escalantes = ['MULTIPLE_FACES', 'FACE_TOO_SMALL'].filter((flag) =>
      riskFlags.includes(flag),
    );
    if (fraude && fraude.veredicto !== 'CLEAR') {
      escalantes.push(
        fraude.veredicto === 'FRAUD_SUSPECTED'
          ? 'DOCUMENT_FRAUD_SUSPECTED'
          : 'DOCUMENT_AUTHENTICITY_DOUBTFUL',
      );
    }
    const decision =
      escalantes.length > 0 && decided.decision === IdentityDecision.VERIFIED
        ? {
            decision: IdentityDecision.REVIEW_REQUIRED,
            reasonCodes: [...decided.reasonCodes, ...escalantes],
            calibratedFaceDecision: 'REVIEW' as const,
          }
        : decided;

    return {
      decision: decision.decision,
      reasonCodes: decision.reasonCodes,
      calibratedFaceDecision: decision.calibratedFaceDecision,
      thresholdProfileVersion: this.options.thresholdProfileVersion,
      documentType: tipoResuelto,
      documentCountry: country,
      classification: {
        confidence: classification.confidence,
        signals: classification.signals,
      },
      documentEvidence: {
        confidence: evidencia.confidence,
        signals: [...evidencia.signals],
        contraindicator: evidencia.contraindicator,
      },
      // El número de documento va enmascarado también aquí, no sólo en la
      // pantalla: lo que se guarda en la fila es este objeto, y una consola de
      // base de datos leería el original.
      fields: {
        ...fields,
        ...(fields.documentNumber
          ? {
              documentNumber: {
                ...fields.documentNumber,
                value: maskDocumentNumber(fields.documentNumber.value),
              },
            }
          : {}),
      },
      quality: {
        document: { score: documentQuality.score, warnings: documentQuality.warnings },
        selfie: { score: selfieQuality.score, warnings: selfieQuality.warnings },
      },
      liveness: {
        outcome: liveness.outcome,
        ...(liveness.score !== undefined ? { score: liveness.score } : {}),
        provider: liveness.provider,
      },
      faceMatch: match
        ? {
            similarityScore: match.similarityScore,
            comparable: match.comparable,
            ...(match.notComparableReason
              ? { notComparableReason: match.notComparableReason }
              : {}),
            provider: match.provider,
            ...(match.modelVersion ? { modelVersion: match.modelVersion } : {}),
          }
        : null,
      riskFlags: [...new Set(riskFlags)],
      /*
       * El análisis de autenticidad viaja ENTERO al resultado, con su desglose y
       * con las pruebas que no se pudieron ejecutar.
       *
       * Es lo que convierte «sospecha de fraude» en algo revisable. Quien abre el
       * caso tiene que poder ver QUÉ saltó —la plantilla incompleta, la MRZ que
       * no cuadra con el anverso, el muaré de una pantalla— porque su trabajo es
       * contradecir a la máquina cuando la máquina se equivoca, y un número
       * suelto no se puede contradecir.
       */
      ...(fraude ? { fraud: fraude } : {}),
      framing: {
        recortado: encuadre.recortado,
        areaConservada: Number(encuadre.areaConservada.toFixed(3)),
      },
      providers: {
        ocr: front.provider,
        face: documentFaces.provider,
        liveness: liveness.provider,
      },
      diagnostics: {
        ocr: {
          front: resumenOcr(front),
          ...(back ? { back: resumenOcr(back) } : {}),
        },
        mrz: mrzDiagnostics(ocr.rawText),
      },
    };
  }

  /**
   * Las tres pruebas de autenticidad, en paralelo, y su fusión.
   *
   * Devuelve `null` cuando la detección está apagada por configuración: es un
   * ausente EXPLÍCITO, distinto de un análisis que salió limpio. El resultado no
   * lleva el bloque `fraud` y quien lo lea sabe que no se preguntó, en vez de
   * leer un «sin señales» que nadie midió.
   *
   * Ninguna de las tres puede tumbar la verificación. `analizarManipulacion` y
   * `clasificarSemanticamente` capturan sus propios fallos y los devuelven como
   * prueba ausente; el `catch` de aquí cubre lo que quede —un `parseMrzTd1` sobre
   * un texto degenerado, un fallo de memoria— porque tirar una verificación ya
   * calculada por un defecto del análisis forense castigaría al solicitante por
   * un problema nuestro.
   */
  private async analizarFraude(entrada: {
    textoAnverso: string;
    textoReverso: string;
    campos: ExtractedIdentityData;
    rawText: string;
    documento: Buffer;
    entradaGenerada: boolean;
  }): Promise<EvaluacionDeFraude | null> {
    if (!this.options.fraudDetectionEnabled) return null;

    try {
      const plantilla = analizarPlantilla({
        textoAnverso: entrada.textoAnverso,
        textoReverso: entrada.textoReverso,
        campos: entrada.campos,
        mrz: parseMrzTd1(entrada.rawText),
        ahora: new Date(),
      });

      /*
       * Sobre una imagen FABRICADA no se analizan los píxeles.
       *
       * No es una excepción de comodidad: es que la pregunta no aplica. Todas
       * las señales de `analizarManipulacion` miden la física de una captura
       * —el grano del sensor, la huella de la compresión, la rejilla de una
       * pantalla— y una tarjeta que dibujamos nosotros no pasó por ningún
       * sensor. Correrlas sobre ella no mide manipulación: mide que la imagen
       * es sintética, cosa que ya sabemos, y convertiría cada escenario del
       * catálogo en una sospecha de fraude hasta enseñar a quien lo lea que el
       * color rojo no significa nada.
       *
       * Se declara NO APLICABLE en vez de ausente, y la diferencia importa: una
       * prueba ausente escala el caso en modo estricto, y ésta no debe, porque
       * no falta —no procede—.
       */
      const forense = entrada.entradaGenerada
        ? Promise.resolve({
            disponible: true,
            senales: [],
            medidas: {
              periodicidad: null,
              residuoMaximoRelativo: null,
              bloquesAtipicos: null,
              variacionDelRuido: null,
              marcoUniforme: null,
            },
            indisponibilidad: 'NOT_APPLICABLE_GENERATED_INPUT',
          } as const)
        : analizarManipulacion(entrada.documento);

      const [semantica, manipulacion] = await Promise.all([
        clasificarSemanticamente({
          embedder: this.embedder,
          texto: `${entrada.textoAnverso}\n${entrada.textoReverso}`,
          umbrales: {
            sueloDeParecido: this.options.fraudSemanticFloor,
            margenMinimo: this.options.fraudSemanticMargin,
          },
        }),
        forense,
      ]);

      return evaluarFraude({
        plantilla,
        semantica,
        manipulacion,
        entradaGenerada: entrada.entradaGenerada,
        umbrales: {
          coberturaMinima: this.options.fraudTemplateCoverageMin,
          riesgoDeRevision: this.options.fraudReviewRisk,
          riesgoDeSospecha: this.options.fraudSuspicionRisk,
          estricto: this.options.fraudStrictMode,
        },
      });
    } catch {
      /*
       * El análisis se cayó entero. Eso NO es un documento limpio.
       *
       * Se devuelve una evaluación que dice exactamente lo que pasó y que, en
       * modo estricto, escala: la regla de este módulo es que una prueba que
       * falta no es una prueba superada, y vale igual cuando la que falta es
       * todo el análisis.
       */
      return {
        veredicto: this.options.fraudStrictMode ? 'REVIEW' : 'CLEAR',
        riesgo: this.options.fraudStrictMode ? this.options.fraudReviewRisk : 0,
        motivos: ['FRAUD_ANALYSIS_FAILED'],
        pruebasAusentes: ['ALL:ANALYSIS_THREW'],
        desglose: {
          conformidadDePlantilla: 0,
          generacion: 'UNKNOWN',
          conformidadSemantica: null,
          riesgoDeIncoherencias: 0,
          riesgoDeManipulacion: 0,
        },
      };
    }
  }

  /** Lee anverso y, si lo hay, reverso, y clasifica el texto de los dos juntos. */
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

  private async leerCaras(
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

  /**
   * Endereza la foto: prueba los tres cuartos de vuelta restantes y se queda
   * con el que el clasificador reconoce. `null` si ninguno lo consigue.
   *
   * ── Por qué hace falta ──────────────────────────────────────────────────
   *
   * Tesseract lee texto HORIZONTAL. Quien fotografía su cédula con el móvil en
   * vertical —o sea, casi todo el mundo— entrega la tarjeta tumbada, y eso no se
   * leía. Medido sobre la cédula sintética: derecha se lee entera y clasifica
   * BOLIVIA_CI; girada 90° devuelve 403 caracteres de ruido y CERO palabras
   * reconocibles. Fíjate en los 403 caracteres, porque explican el mensaje que
   * recibía la persona: «la imagen tiene texto, pero no corresponde a ningún
   * documento de identidad soportado». Texto había; documento, no. Es la peor
   * forma de fallar, porque el mensaje culpa al documento y el documento estaba
   * perfecto.
   *
   * ── Por qué el criterio es la COBERTURA DEL CATÁLOGO ────────────────────
   *
   * Lo primero que se probó fue puntuar cada giro por las palabras de cuatro
   * letras o más que devolvía, y NO sirve: a media vuelta la lectura da 27
   * palabras, UNA MÁS que la orientación correcta. Tesseract lee el texto
   * invertido y produce secuencias con toda la pinta de palabras, así que ese
   * criterio elegía la orientación equivocada con más confianza que la buena.
   *
   * Lo segundo fue el CLASIFICADOR, y sobre la tarjeta dibujada funcionaba: sólo
   * la orientación correcta contenía «CÉDULA». Sobre una fotografía real,
   * tampoco sirve, y por una razón que no tiene arreglo dentro de un criterio
   * booleano: a 600 px —el tamaño de la sonda— el reconocedor no llega a leer el
   * rótulo en NINGUNA orientación, así que las cuatro contestaban lo mismo. El
   * documento se rechazaba entero por no encontrar un giro que sí existía.
   *
   * El criterio de hoy es CUÁNTA plantilla del catálogo se reconoce, y se
   * comparan las cuatro orientaciones para quedarse con la mejor en vez de
   * pararse en la primera que pase un umbral. Es lo que convierte una pregunta
   * que a 600 px no tiene respuesta binaria en una que sí tiene respuesta
   * relativa. Medido sobre una cédula boliviana auténtica fotografiada en
   * vertical, a 600 px y con las dos caras:
   *
   *   giro 0°    0,000      giro 180°   0,000
   *   giro 90°   0,000      giro 270°   0,216   <- la orientación correcta
   *
   * Las tres orientaciones equivocadas dan CERO exacto, no «poco»: el catálogo
   * no reconoce nada en el texto invertido. Por eso basta con exigir que la
   * ganadora saque algo y sea la mejor — un empate a cero no elige nada.
   *
   * ── Por qué se gira la foto ORIGINAL y se vuelve a normalizar ───────────
   *
   * Girar la imagen ya normalizada es más barato y sale peor. `normalize`
   * entrega un JPEG, y la rejilla de bloques de ese JPEG queda alineada con la
   * orientación en que se codificó: al girar después, los artefactos caen
   * atravesados sobre las cifras del número y sobre el retrato. Medido: el
   * parecido bajaba de 0,9011 a 0,8707 —por debajo del umbral de aprobación, o
   * sea documento correcto a revisión manual— y a media vuelta se perdían el
   * número de cédula y la fecha de caducidad. Enderezando el original, todo lo
   * que viene después ve exactamente lo que habría visto si la foto se hubiera
   * tomado derecha.
   *
   * ── Coste ───────────────────────────────────────────────────────────────
   *
   * Cero para quien fotografía el documento derecho: esto sólo se llama cuando
   * la lectura normal ya iba a terminar en rechazo. Tres sondas de 600 px, y ya
   * no se para en la primera que pasa: se comparan las tres porque el criterio
   * es relativo. La diferencia son dos pasadas de sonda —unos 500 ms sobre una
   * imagen de ese tamaño— y a cambio deja de depender de que la primera que
   * cruce un umbral sea la buena.
   *
   * El reverso se gira lo mismo que el anverso y no por separado: son las dos
   * caras de UNA tarjeta, fotografiadas por la misma persona en la misma sesión.
   * Si aun así no coincidieran, el reverso no aporta campos —que es lo que ya
   * pasaba antes con cualquier reverso ilegible— y nunca un dato equivocado.
   */
  private async buscarOrientacion(
    input: IdentityPipelineInput,
    clasificar: Clasificador,
    yaEncuadrada: Buffer,
  ): Promise<{
    document: NormalizedImage;
    encuadre: DocumentFraming;
    reverso: Buffer | null;
    lectura: Lectura;
  } | null> {
    /*
     * La base de las sondas se reduce UNA vez y se gira en pequeño.
     *
     * Es la mitad del ahorro y no se ve en el reloj del reconocedor. Preparar
     * cada giro a partir del original —girar 12 MP, volver a normalizar,
     * encuadrar— costaba unos 1250 ms por vuelta, o sea casi cuatro segundos de
     * `sharp` para tres preguntas que se contestan con una imagen de 600 px.
     * Partiendo de la imagen que YA está normalizada y encuadrada, girar es
     * trabajo de milisegundos.
     *
     * Lo que se pierde al girar algo ya codificado en JPEG —los artefactos
     * cruzados sobre las cifras, medidos en `rotate`— aquí da igual: la sonda no
     * lee cifras, sólo tiene que reconocer el rótulo. Y cuando acierta, el giro
     * bueno se rehace desde el original, que es donde ese detalle sí importa.
     */
    const baseSonda = await this.images.downscale(yaEncuadrada, ORIENTATION_PROBE_LONG_EDGE);

    /*
     * Las TRES sondas se miden y se comparan; ninguna se acepta por llegar
     * primero.
     *
     * El reverso ni siquiera entra aquí. La sonda contesta una única pregunta
     * —«¿cuánta cédula se ve con este giro?»— y esa la contesta el anverso, que
     * es donde está el rótulo; leer la otra cara para descartarla es pagar el
     * doble por la misma respuesta.
     */
    const sondas: Array<{ grados: 90 | 180 | 270; puntos: number }> = [];
    for (const grados of [90, 180, 270] as const) {
      const sonda = await this.leerCaras(
        { anverso: await this.images.rotate(baseSonda, grados), reverso: null },
        input,
        clasificar,
        ORIENTATION_PROBE_LONG_EDGE,
      );
      sondas.push({ grados, puntos: puntuarLectura(sonda) });
    }
    sondas.sort((a, b) => b.puntos - a.puntos);

    for (const { grados, puntos } of sondas) {
      // Un empate a cero no elige nada: si el catálogo no reconoce NADA con ese
      // giro, girar la foto entera para volver a leerla sólo gastaría tiempo.
      if (puntos <= 0) break;

      /*
       * A partir de aquí se paga lo caro, y se paga sobre el ORIGINAL: girar la
       * foto tal como llegó y volver a normalizarla es lo que deja el documento
       * como si se hubiera fotografiado derecho. Esto sólo ocurre una vez por
       * ejecución y sólo cuando ya se sabe que hay algo de documento.
       */
      const document = await this.images.normalize(
        await this.images.rotate(input.documentImage, grados),
      );
      const encuadre = await this.images.frame(document.buffer);

      /*
       * La sonda decidió una ORIENTACIÓN y nada más. Los campos —número,
       * nombre, caducidad, MRZ— se rellenan con la lectura de tamaño completo,
       * que es la única calibrada contra los cortes de resolución medidos, y la
       * relectura fina de `run` la vuelve a mejorar si hay documento.
       *
       * Si con la foto entera y las dos caras el catálogo tampoco reconoce
       * nada, este giro no vale: se prueba el siguiente. Una sonda que se
       * equivoque cuesta tiempo, nunca un veredicto.
       */
      const reverso = input.documentBackImage
        ? (await this.images.normalize(await this.images.rotate(input.documentBackImage, grados)))
            .buffer
        : null;
      const lectura = await this.leerCaras(
        { anverso: encuadre.buffer, reverso },
        input,
        clasificar,
        this.options.ocrMaxLongEdge,
      );
      if (hayIndicioDeDocumento(lectura)) {
        return { document, encuadre, reverso, lectura };
      }
    }
    return null;
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
  private async recortarRostro(imagen: Buffer, caja: FaceBoundingBox): Promise<Buffer> {
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

/**
 * Distingue «no leí nada» de «leí algo que no es un documento».
 *
 * Las dos terminan en el mismo rechazo, pero no se arreglan igual: la primera
 * suele ser una foto movida o a contraluz y se cura repitiéndola; la segunda es
 * que se subió otra cosa. Decírselo al usuario es la diferencia entre que
 * reintente bien y que reintente al azar.
 */
function describeUnreadable(ocr: DocumentOcrResult): string {
  const texto = ocr.rawText.replace(/\s+/g, ' ').trim();
  if (texto.length < MIN_READABLE_CHARS) {
    return 'No se pudo leer ningún texto en la imagen. Asegúrate de que sea la foto de un documento de identidad, enfocada, con buena luz y sin reflejos.';
  }
  return 'La imagen tiene texto, pero no corresponde a ningún documento de identidad soportado. Se admiten cédula de identidad boliviana y pasaporte.';
}

/**
 * Por debajo de esto no hay texto que discutir: es ruido del reconocedor sobre
 * una imagen sin letras.
 */
const MIN_READABLE_CHARS = 12;

/**
 * Los defectos que, por sí solos, explican que no se pudiera leer.
 *
 * La lista es corta a propósito, y quién entra y quién no sale de MEDIR los
 * escenarios con `SharpImageAdapter.assess`, no de razonarlo:
 *
 * | escenario            | contraste | nitidez | avisos                        |
 * | -------------------- | --------- | ------- | ----------------------------- |
 * | cédula legible       |     0,393 |    3,56 | OVEREXPOSED                   |
 * | cédula sobre mesa    |     0,614 |    2,14 | —                             |
 * | paisaje (no es doc.) |     0,273 |    0,38 | POSSIBLE_BLUR                 |
 * | imagen plana         |     0,000 |    0,00 | LOW_CONTRAST, POSSIBLE_BLUR   |
 *
 * `POSSIBLE_BLUR` queda FUERA: salta con una nitidez de 0,38, que es lo que da
 * cualquier foto de formas lisas —un cielo con dos colinas— sin que la foto
 * tenga nada de malo. Usarlo para elegir el mensaje hacía que una imagen que
 * simplemente no es un documento recibiera «repite la foto», que manda a quien
 * la subió a arreglar lo que no estaba roto.
 *
 * `OVEREXPOSED` también queda fuera, y por lo contrario: salta en TODAS las
 * cédulas legibles (brillo 0,92 — una tarjeta es blanca). Un aviso que está
 * presente en el caso bueno no distingue nada.
 *
 * Quedan los tres que separan limpio: sin resolución, sin contraste o sin luz no
 * hay lectura posible, y los tres se arreglan repitiendo la captura.
 */
const DEFECTOS_DECISIVOS = ['LOW_RESOLUTION', 'LOW_CONTRAST', 'UNDEREXPOSED'];

/**
 * Une la lectura de las dos caras en una sola.
 *
 * Las dos caras de una cédula llevan campos distintos —el número delante, el
 * nombre y las fechas detrás— y el analizador busca sus anclajes sobre el texto
 * completo. Está extraído porque el reintento sin recorte tiene que unirlas
 * igual: dos versiones de esta costura acabarían separándose.
 */
function unirCaras(front: DocumentOcrResult, back: DocumentOcrResult): DocumentOcrResult {
  return {
    ...front,
    rawText: `${front.rawText}\n${back.rawText}`,
    lines: [...front.lines, ...back.lines],
  };
}

/** Lo mínimo para poder afirmar que se leyó un documento y no una cartulina. */
function requiredFieldsPresent(fields: ExtractedIdentityData): boolean {
  return Boolean(
    fields.documentNumber?.value &&
    (fields.fullName?.value || fields.firstNames?.value || fields.lastNames?.value),
  );
}

/** Cuánto entregó el reconocedor por cara, para la traza: volumen y confianza media. */
function resumenOcr(cara: DocumentOcrResult): {
  chars: number;
  lines: number;
  meanConfidence: number | null;
} {
  const conConfianza = cara.lines.filter((linea) => linea.confidence !== null);
  const media =
    conConfianza.length > 0
      ? conConfianza.reduce((suma, linea) => suma + (linea.confidence ?? 0), 0) /
        conConfianza.length
      : null;
  return {
    chars: cara.rawText.length,
    lines: cara.lines.length,
    meanConfidence: media === null ? null : Number(media.toFixed(3)),
  };
}
