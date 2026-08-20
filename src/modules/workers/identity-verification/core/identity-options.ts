/**
 * Ajustes del worker de identidad, ya resueltos.
 *
 * El paquete original leía cada valor de su propio `IdentityConfigService`, que
 * validaba un esquema de entorno entero al arrancar. Aquí llega como un objeto
 * plano construido una vez por `buildIdentityOptions`, por el mismo motivo por
 * el que el worker semántico recibe `SEMANTIC_WORKER_CONFIG` en vez de un
 * `ConfigService`: el núcleo absorbido no debe saber de dónde salen los valores,
 * y así las pruebas lo ejercitan con un literal en vez de con variables de
 * entorno.
 */

export const IDENTITY_OPTIONS = Symbol('IDENTITY_OPTIONS');
export const IDENTITY_OCR_PORT = Symbol('IDENTITY_OCR_PORT');
export const IDENTITY_CLASSIFIER_PORT = Symbol('IDENTITY_CLASSIFIER_PORT');
export const IDENTITY_FACE_DETECTOR_PORT = Symbol('IDENTITY_FACE_DETECTOR_PORT');
export const IDENTITY_FACE_MATCH_PORT = Symbol('IDENTITY_FACE_MATCH_PORT');
export const IDENTITY_LIVENESS_PORT = Symbol('IDENTITY_LIVENESS_PORT');
export const IDENTITY_NORMALIZER_PORT = Symbol('IDENTITY_NORMALIZER_PORT');

export interface IdentityOptions {
  /**
   * Umbrales de la comparación biométrica. **Opcionales y acoplados**: o están
   * los dos o no está ninguno.
   *
   * Sin ellos el motor de decisión devuelve `REVIEW_REQUIRED` con
   * `THRESHOLD_PROFILE_MISSING`, que es el comportamiento seguro que el paquete
   * original eligió a propósito: un umbral inventado decide sobre la identidad
   * de una persona con una cifra que nadie calibró.
   */
  readonly matchThreshold?: number;
  readonly reviewThreshold?: number;
  /** Nombre del perfil calibrado del que salen los umbrales. Viaja al resultado. */
  readonly thresholdProfileVersion: string;

  readonly minDocumentQuality: number;
  readonly minSelfieQuality: number;
  readonly minFaceAreaRatio: number;
  readonly documentExpiryGraceDays: number;

  readonly maxImagePixels: number;
  /**
   * Por debajo de esto la medida AVISA `LOW_RESOLUTION`. Es una señal, no una
   * puerta: quien decide si la imagen servía es la lectura, más abajo.
   */
  readonly minImageWidth: number;
  readonly minImageHeight: number;
  readonly minImagePixels: number;
  /**
   * El SUELO: por debajo no hay lectura posible y se rechaza sin gastar OCR.
   *
   * Medido, no supuesto (`scripts/medir-resolucion-identidad.ts`, cédula
   * sintética bajada a una escalera de anchos con el gate apagado):
   *
   * | tamaño   | qué se leyó                                  |
   * | -------- | -------------------------------------------- |
   * | 450×289  | número, nombre y caducidad — **VERIFICADO**   |
   * | 360×231  | sólo el nombre                               |
   * | 280×180  | sólo el número                               |
   * | 220×141  | nada: no clasifica                           |
   *
   * El suelo se pone justo donde dejó de leerse algo, y por eje: una cédula es
   * apaisada, así que exigir el mismo mínimo a lo alto que a lo ancho —lo que
   * hacía `minImageWidth`/`minImageHeight` a 480— pedía en realidad 761 px de
   * ancho para una tarjeta que se lee entera con 450.
   */
  readonly minReadableLongEdge: number;
  readonly minReadableShortEdge: number;
  readonly faceCropPaddingRatio: number;
  readonly minDocumentFacePx: number;

  readonly livenessEnabled: boolean;
  /**
   * Cortes de la prueba de vida, sobre el MÍNIMO de antispoof y vida. Entre los
   * dos queda la franja no concluyente, que va a revisión humana en vez de
   * resolverse a la fuerza como un sí o un no.
   */
  readonly livenessPassScore: number;
  readonly livenessFailScore: number;
  readonly documentClassificationEnabled: boolean;

  readonly ocrProvider: string;
  readonly faceProvider: string;
  readonly livenessProvider: string;

  /** Tamaño máximo por imagen, en bytes. Lo publica el catálogo. */
  readonly maxUploadBytes: number;
  /** País de emisión asumido cuando quien llama no declara otro. */
  readonly defaultDocumentCountry: string;
}

/**
 * Valores por omisión, los mismos que el esquema de entorno del paquete
 * original. Se conservan aquí para que las pruebas del núcleo no dependan del
 * puente con `ConfigService`.
 */
export const IDENTITY_DEFAULTS: IdentityOptions = {
  thresholdProfileVersion: 'unconfigured',
  minDocumentQuality: 0.5,
  minSelfieQuality: 0.5,
  // 0,03 del área exigía que el rostro llenara más del 17 % del ancho Y del
  // alto, que rechaza una selfie normal a un brazo de distancia.
  minFaceAreaRatio: 0.012,
  documentExpiryGraceDays: 0,
  maxImagePixels: 25_000_000,
  minImageWidth: 480,
  minImageHeight: 480,
  minImagePixels: 230_400,
  minReadableLongEdge: 240,
  minReadableShortEdge: 150,
  faceCropPaddingRatio: 0.25,
  minDocumentFacePx: 80,
  livenessEnabled: true,
  livenessPassScore: 0.55,
  livenessFailScore: 0.35,
  documentClassificationEnabled: true,
  ocrProvider: 'tesseract',
  faceProvider: 'human',
  livenessProvider: 'human',
  maxUploadBytes: 10_485_760,
  defaultDocumentCountry: 'BO',
};
