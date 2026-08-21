import { Inject, Injectable } from '@nestjs/common';
import { IdentityDecisionEngine } from './core/domain/identity-decision.engine';
import { IdentityDecision, IdentityDocumentType } from './core/domain/identity-enums';
import { identityErrors } from './core/domain/identity-domain.error';
import type { ExtractedIdentityData } from './core/domain/extracted-identity.types';
import { ImageQualityAssessmentService } from './core/image-quality-assessment.service';
import {
  IDENTITY_ARBITRATION_PORT,
  IDENTITY_CLASSIFIER_PORT,
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
import { triageIdentityDocument, type IdentityGateOutcome } from './core/engine/identity-triage';
import { mrzDiagnostics } from './core/parsers/mrz-td1';
import { isoDateToUtcDate } from './core/parsers/spanish-date';
import type { DocumentParser } from './core/parsers/document-parser';
import type {
  DocumentClassificationResult,
  DocumentClassifierPort,
  DocumentFraming,
  DocumentFramerPort,
  DocumentOcrPort,
  DocumentOcrResult,
  FaceCropPort,
  FaceDetectorPort,
  FaceMatchPort,
  FaceMatchResult,
  IdentityArbitrationPort,
  ImageNormalizerPort,
  LivenessPort,
  LivenessResult,
  NormalizedImage,
} from './core/ports/identity.ports';

/** Lo que sale de leer una o las dos caras y clasificarlas juntas. */
interface Lectura {
  ocr: DocumentOcrResult;
  front: DocumentOcrResult;
  back: DocumentOcrResult | null;
  classification: DocumentClassificationResult;
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

    const clasificar = (texto: string) =>
      this.options.documentClassificationEnabled
        ? this.classifier.classify({
            rawText: texto,
            documentCountry: country,
          })
        : Promise.resolve({
            type: IdentityDocumentType.UNKNOWN,
            confidence: 1,
            signals: ['classification-disabled'],
          });

    /*
     * Lectura, reintento sin recorte y, por último, búsqueda de orientación.
     *
     * Las tres redes se cobran SÓLO cuando ya íbamos a rechazar. La primera
     * lectura es la imagen recortada tal cual llegó: el camino de siempre, sin
     * un milisegundo de más para quien fotografía el documento derecho.
     *
     * El reintento sin recorte estaba ya y sigue: un recorte demasiado agresivo
     * deja de ser un rechazo y pasa a ser, como mucho, una lectura más lenta.
     */
    let lectura = await this.leerCaras(encuadre.buffer, reverso, input, clasificar);
    if (lectura.classification.type === IdentityDocumentType.UNKNOWN && encuadre.recortado) {
      lectura = await this.leerCaras(document.buffer, reverso, input, clasificar);
    }
    if (lectura.classification.type === IdentityDocumentType.UNKNOWN) {
      const enderezado = await this.buscarOrientacion(input, clasificar);
      if (enderezado) {
        ({ document, encuadre, reverso, lectura } = enderezado);
      }
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

    // --- 5. Selfie: normalizar, detectar y medir ----------------------------
    const selfie = await this.images.normalize(input.selfieImage);
    const selfieFaces = await this.faces.detectFaces({
      image: selfie.buffer,
      correlationId: input.correlationId,
    });
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
    const match: FaceMatchResult | null =
      liveness.outcome === 'FAILED'
        ? null
        : await this.faceMatch.compare({
            documentFace,
            selfieFace: selfie.buffer,
            correlationId: input.correlationId,
          });
    await input.onProgress?.(90);

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
    const escalantes = ['MULTIPLE_FACES', 'FACE_TOO_SMALL'].filter((flag) =>
      riskFlags.includes(flag),
    );
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

  /** Lee anverso y, si lo hay, reverso, y clasifica el texto de los dos juntos. */
  private async leerCaras(
    anverso: Buffer,
    reverso: Buffer | null,
    input: IdentityPipelineInput,
    clasificar: (texto: string) => Promise<DocumentClassificationResult>,
  ): Promise<Lectura> {
    const front = await this.ocr.extract({
      image: anverso,
      correlationId: input.correlationId,
    });
    const back = reverso
      ? await this.ocr.extract({ image: reverso, correlationId: input.correlationId })
      : null;
    // Las dos caras de una cédula llevan campos distintos; el análisis corre
    // sobre las dos juntas.
    const ocr = back ? unirCaras(front, back) : front;
    return { ocr, front, back, classification: await clasificar(ocr.rawText) };
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
   * ── Por qué el criterio es el CLASIFICADOR y no «cuánto texto salió» ────
   *
   * Lo primero que se probó fue puntuar cada giro por las palabras de cuatro
   * letras o más que devolvía, y NO sirve: a media vuelta la lectura da 27
   * palabras, UNA MÁS que la orientación correcta. Tesseract lee el texto
   * invertido y produce secuencias con toda la pinta de palabras, así que ese
   * criterio elegía la orientación equivocada con más confianza que la buena.
   * El clasificador sí separa limpio —sólo la orientación correcta contiene
   * «CÉDULA»— y además es exactamente la pregunta que hay que responder.
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
   * la lectura normal ya iba a terminar en rechazo. Como mucho tres vueltas, y
   * se para en la primera que clasifica.
   *
   * El reverso se gira lo mismo que el anverso y no por separado: son las dos
   * caras de UNA tarjeta, fotografiadas por la misma persona en la misma sesión.
   * Si aun así no coincidieran, el reverso no aporta campos —que es lo que ya
   * pasaba antes con cualquier reverso ilegible— y nunca un dato equivocado.
   */
  private async buscarOrientacion(
    input: IdentityPipelineInput,
    clasificar: (texto: string) => Promise<DocumentClassificationResult>,
  ): Promise<{
    document: NormalizedImage;
    encuadre: DocumentFraming;
    reverso: Buffer | null;
    lectura: Lectura;
  } | null> {
    for (const grados of [90, 180, 270] as const) {
      const document = await this.images.normalize(
        await this.images.rotate(input.documentImage, grados),
      );
      const reverso = input.documentBackImage
        ? (await this.images.normalize(await this.images.rotate(input.documentBackImage, grados)))
            .buffer
        : null;
      const encuadre = await this.images.frame(document.buffer);
      const lectura = await this.leerCaras(encuadre.buffer, reverso, input, clasificar);
      if (lectura.classification.type !== IdentityDocumentType.UNKNOWN) {
        return { document, encuadre, reverso, lectura };
      }
    }
    return null;
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
