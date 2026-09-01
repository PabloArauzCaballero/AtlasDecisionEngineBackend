import type { IdentityDocumentType } from '../domain/identity-enums';

/**
 * Puertos de salida del worker de identidad, absorbidos del paquete original.
 *
 * Viven en un solo archivo porque juntos son el contrato COMPLETO con el
 * proveedor biométrico: quien quiera enchufar Textract, Rekognition o cualquier
 * otro sólo tiene que leer esto. En el paquete original eran catorce archivos
 * de una interfaz cada uno, repartidos entre `ports/outbound/`; lo que se
 * conserva es la forma, que es lo que hace intercambiable al proveedor, no el
 * número de archivos.
 *
 * Se dejan fuera los puertos que aquí no tienen sentido —repositorio, cola,
 * almacén de objetos, reloj, trazador y publicador de eventos—: de esos se
 * encarga el motor con su Prisma, su `JobSchedulerService` y su
 * `ObservabilityModule`, que es justo lo que la arquitectura hexagonal del
 * paquete permitía sustituir sin tocar el núcleo.
 */

// --- OCR -------------------------------------------------------------------

export interface DocumentOcrInput {
  image: Buffer;
  correlationId: string;
}

export interface DocumentOcrLine {
  text: string;
  confidence: number | null;
}

export interface DocumentOcrResult {
  rawText: string;
  lines: DocumentOcrLine[];
  provider: string;
  modelVersion?: string;
}

export interface DocumentOcrPort {
  extract(input: DocumentOcrInput): Promise<DocumentOcrResult>;
  health(): Promise<{ ready: boolean; detail?: string }>;
}

// --- Clasificación del documento -------------------------------------------

export interface DocumentClassificationInput {
  /** Las dos caras unidas. Es lo que ve un clasificador que no distingue caras. */
  rawText: string;
  documentCountry: string;
  /**
   * El texto de CADA cara, cuando quien llama las tiene por separado.
   *
   * El catálogo de la cédula sitúa cada anclaje en su cara —`SERIE` va delante,
   * la MRZ detrás— y medirlo sobre las dos juntas convierte la plantilla en una
   * bolsa de palabras: un anclaje de reverso encontrado en el anverso deja de
   * significar lo que el catálogo dice. Opcionales porque una captura de sólo
   * anverso es legítima y frecuente, y porque un clasificador que no los use
   * sigue siendo un clasificador válido.
   */
  frontText?: string;
  backText?: string;
}

export interface DocumentClassificationResult {
  type: IdentityDocumentType;
  confidence: number;
  signals: string[];
}

export interface DocumentClassifierPort {
  classify(input: DocumentClassificationInput): Promise<DocumentClassificationResult>;
}

// --- Arbitraje de la duda ---------------------------------------------------

/**
 * Quién resuelve lo que la puerta de documentos no supo resolver sola.
 *
 * Es un PUERTO y no una llamada directa a la bandeja por una razón concreta: el
 * factor que decide va a cambiar. Hoy es una persona mirando la foto en el
 * portal; mañana puede ser un modelo que la clasifique en un segundo, y el día
 * que eso ocurra el pipeline no debería enterarse. Lo único que el pipeline sabe
 * es que hay una duda razonable y que alguien —humano o no— tiene que cerrarla.
 *
 * Nótese que un veredicto puede ser DIFERIDO, y no es un fallo del adaptador: un
 * humano no contesta dentro de la petición HTTP que le pregunta. El adaptador
 * humano deja el caso en la cola y contesta `DEFERRED`; el resultado del worker
 * queda en `REVIEW_REQUIRED` y se cierra más tarde, desde la pestaña. Un
 * adaptador de IA sí podría contestar en línea, y por eso el contrato admite las
 * dos formas en vez de obligar a la más pobre.
 */
export interface IdentityArbitrationRequest {
  readonly correlationId: string;
  /** Por qué se pregunta, con el vocabulario cerrado de la cola. */
  readonly reason: string;
  /** Qué vio la puerta, en una frase que una persona pueda leer. */
  readonly detail: string;
  readonly documentType: IdentityDocumentType;
  readonly evidenceConfidence: number;
  readonly signals: readonly string[];
}

export type IdentityArbitrationOutcome =
  /** Sí es un documento admisible: el worker sigue. */
  | 'ACCEPT_DOCUMENT'
  /** No lo es: el worker rechaza, con el motivo del árbitro. */
  | 'REJECT_DOCUMENT'
  /** Nadie ha contestado todavía. El caso queda abierto en la cola. */
  | 'DEFERRED';

export interface IdentityArbitrationVerdict {
  readonly outcome: IdentityArbitrationOutcome;
  readonly decidedBy: 'HUMAN' | 'AI';
  /** Adaptador concreto que contestó, para la traza y el tablero. */
  readonly provider: string;
  readonly rationale: string;
}

export interface IdentityArbitrationPort {
  readonly mode: 'HUMAN' | 'AI';
  arbitrate(request: IdentityArbitrationRequest): Promise<IdentityArbitrationVerdict>;
  health(): Promise<{ ready: boolean; detail?: string }>;
}

// --- Imagen ----------------------------------------------------------------

export interface FaceBoundingBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ImageQuality {
  score: number;
  width: number;
  height: number;
  brightness: number;
  contrast: number;
  sharpness: number | null;
  warnings: string[];
}

export interface NormalizedImage {
  buffer: Buffer;
  mimeType: 'image/jpeg';
  quality: ImageQuality;
}

export interface ImageNormalizerPort {
  normalize(input: Buffer): Promise<NormalizedImage>;
  assess(input: Buffer): Promise<ImageQuality>;
}

export interface FaceCropPort {
  crop(input: Buffer, box: FaceBoundingBox): Promise<Buffer>;
}

export interface DocumentFraming {
  buffer: Buffer;
  /** Si se llegó a recortar algo, o la imagen salió tal cual entró. */
  recortado: boolean;
  /** Proporción del área que sobrevivió al recorte, en [0,1]. */
  areaConservada: number;
}

/**
 * Quita el fondo que rodea al documento antes de leerlo.
 *
 * Una foto de una cédula sobre un escritorio trae mesa, sombras y a veces otros
 * papeles. Todo eso entra al reconocedor: baja la precisión sobre el documento
 * y, en el peor caso, le da letras de otro sitio que confunden al clasificador.
 *
 * Es un puerto aparte y no un método más del normalizador porque es una
 * decisión distinta —qué parte de la imagen es el documento— y un despliegue
 * puede querer resolverla con un detector de bordes de verdad sin tocar el
 * remuestreo.
 */
export interface DocumentFramerPort {
  frame(input: Buffer): Promise<DocumentFraming>;
  /**
   * Gira la imagen un múltiplo de 90°.
   *
   * Existe porque el reconocedor de texto lee UNA orientación: la horizontal.
   * Quien fotografía su cédula con el móvil en vertical entrega una tarjeta
   * tumbada, y sobre ella Tesseract no devuelve nada aprovechable. Medido con la
   * cédula sintética de `fixtures/identity-card.ts`: derecha se lee entera y
   * clasifica como BOLIVIA_CI; girada 90° devuelve 403 caracteres de ruido y
   * CERO palabras reconocibles. El pipeline necesita poder probar las otras
   * orientaciones, y necesita el buffer girado —no sólo el texto— porque después
   * hay que recortar el retrato de esa misma imagen.
   */
  rotate(input: Buffer, degrees: 90 | 180 | 270): Promise<Buffer>;
  /**
   * Reduce la imagen a un lado largo dado, sin ampliarla nunca.
   *
   * Existe para las SONDAS: los intentos que sólo tienen que contestar «¿esto
   * clasifica?» y cuyo texto no se usa para rellenar ningún campo. El coste del
   * reconocedor crece con los píxeles y la pregunta de la sonda no los necesita
   * —el rótulo de una cédula es lo más grande que hay impreso en ella—, así que
   * pagarlos es tiempo que se le cobra a quien está esperando una respuesta.
   *
   * Medido sobre una foto de móvil que NO es un documento: 6516 ms a 1350x1800,
   * 1038 ms a 600x800. El mismo texto que decide la clasificación sobrevive: la
   * cédula sintética reducida a 1000 px de lado largo entrega las mismas señales
   * y la misma evidencia (0,75) que a tamaño completo.
   */
  downscale(input: Buffer, longEdge: number): Promise<Buffer>;
}

// --- Rostros ---------------------------------------------------------------

export interface DetectedFace {
  box: FaceBoundingBox;
  quality: number | null;
}

export interface FaceDetectionResult {
  faces: DetectedFace[];
  provider: string;
  modelVersion?: string;
}

export interface FaceDetectorPort {
  detectFaces(input: { image: Buffer; correlationId: string }): Promise<FaceDetectionResult>;
  health(): Promise<{ ready: boolean; detail?: string }>;
}

export interface FaceMatchResult {
  /**
   * Parecido en [0,1], o `null` cuando el proveedor no pudo comparar las dos
   * imágenes —normalmente porque no halló un rostro utilizable en el recorte
   * del documento—. `null` NUNCA debe colapsarse a `0`: «no pudimos mirar» y
   * «es otra persona» tienen consecuencias opuestas para quien se verifica.
   */
  similarityScore: number | null;
  /** `false` cuando la comparación no llegó a ocurrir; ver `similarityScore`. */
  comparable: boolean;
  notComparableReason?: 'NO_FACE_IN_DOCUMENT' | 'NO_FACE_IN_SELFIE' | 'PROVIDER_REJECTED_INPUT';
  providerDecision?: string;
  calibratedDecision?: 'MATCH' | 'REVIEW' | 'NO_MATCH';
  quality?: { documentFace?: number; selfieFace?: number };
  provider: string;
  modelVersion?: string;
  metadata?: Record<string, unknown>;
}

export interface FaceMatchPort {
  compare(input: {
    documentFace: Buffer;
    selfieFace: Buffer;
    correlationId: string;
  }): Promise<FaceMatchResult>;
  health(): Promise<{ ready: boolean; detail?: string }>;
}

// --- Prueba de vida --------------------------------------------------------

export interface LivenessResult {
  outcome: 'PASSED' | 'FAILED' | 'NOT_RUN' | 'INCONCLUSIVE';
  score?: number;
  provider: string;
  modelVersion?: string;
}

export interface LivenessPort {
  verify(input: { selfie: Buffer; correlationId: string }): Promise<LivenessResult>;
  health(): Promise<{ ready: boolean; detail?: string }>;
}
