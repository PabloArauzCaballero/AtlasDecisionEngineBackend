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

import { IdentityDocumentType } from './domain/identity-enums';
import { DEFAULT_IDENTITY_THRESHOLDS } from './engine/identity-triage';
import { UMBRALES_DE_FRAUDE_POR_DEFECTO } from './forensics/identity-fraud.scorer';
import { UMBRALES_SEMANTICOS_POR_DEFECTO } from './forensics/identity-semantic.classifier';

export const IDENTITY_OPTIONS = Symbol('IDENTITY_OPTIONS');
export const IDENTITY_OCR_PORT = Symbol('IDENTITY_OCR_PORT');
export const IDENTITY_CLASSIFIER_PORT = Symbol('IDENTITY_CLASSIFIER_PORT');
export const IDENTITY_FACE_DETECTOR_PORT = Symbol('IDENTITY_FACE_DETECTOR_PORT');
export const IDENTITY_FACE_MATCH_PORT = Symbol('IDENTITY_FACE_MATCH_PORT');
export const IDENTITY_LIVENESS_PORT = Symbol('IDENTITY_LIVENESS_PORT');
export const IDENTITY_NORMALIZER_PORT = Symbol('IDENTITY_NORMALIZER_PORT');
export const IDENTITY_ARBITRATION_PORT = Symbol('IDENTITY_ARBITRATION_PORT');
/**
 * El codificador de textos que sostiene la detección de fraude documental.
 *
 * Se declara como PUERTO —y opcional— y no como una dependencia dura por lo que
 * pasa cuando falta: sin servidor de embeddings el worker tiene que seguir
 * verificando identidades, sólo que sin una de sus pruebas y sabiendo que le
 * falta. Un `undefined` inyectado aquí es un despliegue sin transformers, y el
 * fusor lo trata como prueba ausente — que en producción escala el caso.
 */
export const IDENTITY_EMBEDDER_PORT = Symbol('IDENTITY_EMBEDDER_PORT');

/** Quién arbitra la franja de duda de la puerta de documentos. */
export type IdentityArbitrationMode = 'HUMAN' | 'AI';

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
  /**
   * Tope del lado largo de lo que se le entrega al RECONOCEDOR, en píxeles.
   *
   * No es un mínimo de calidad ni una puerta: es cuánta imagen vale la pena
   * pagar. Y lo que se paga NO es proporcional a los píxeles: el coste de
   * Tesseract lo marca cuántos candidatos a texto encuentra, así que sobre una
   * foto que no es un documento hay un ACANTILADO. Medido sobre ruido de 12 MP,
   * con el reconocedor ya caliente y dos pasadas por tamaño:
   *
   *   1350x1800  18205 / 21333 ms   719 caracteres de ruido
   *   1050x1400   7938 /  7764 ms   344
   *    900x1200   5569 /  5200 ms   156
   *    750x1000   5872 /  5617 ms   197
   *    600x800    4753 /  4527 ms   167
   *    450x600     513 /   382 ms    11   <- aquí deja de ver texto donde no lo hay
   *
   * Por eso 600 y no 800: entre esas dos filas hay un factor de nueve, y no lo
   * compra la resolución sino dejar de perseguir fantasmas. El sitio exacto del
   * acantilado es de ESTA imagen —ruido puro, el peor caso—; con una foto real
   * cae en otro punto, y por eso el número es configurable y no una constante.
   *
   * **Este valor es una CONCESIÓN, y hay que saber a cambio de qué.** Los campos
   * —número, nombre, nacimiento, caducidad— sobreviven hasta 600 px en la cédula
   * sintética de `fixtures/`, que es un SVG nítido que no pasó por ningún
   * sensor. Una foto real se degrada antes, y lo que primero se pierde es la
   * MRZ, que es la letra más pequeña de la tarjeta y de donde salen el número y
   * las fechas. Cuando eso pasa el caso NO se aprueba mal: le faltan campos y
   * cae en la bandeja de revisión. O sea, el precio de este número lo paga quien
   * hace las cosas bien, en forma de espera humana.
   *
   * **Ya no es el tope de la lectura, sino el de la primera pasada.** La
   * concesión de arriba se cobró exactamente donde el comentario avisaba: sobre
   * una cédula boliviana real, a 600 px el reconocedor lee la `7` del dígito de
   * control del primer renglón de la MRZ como una `T`, y con el control roto se
   * descartan el número de documento y la fecha de nacimiento enteros. El caso
   * no se aprobaba mal: caía en la bandeja de una persona por «campos
   * ausentes», que es el precio que pagaba quien hacía las cosas bien.
   *
   * Este número se queda donde estaba porque su trabajo sigue siendo el mismo
   * —rechazar barato lo que no es un documento— y quien lee de verdad ahora es
   * `ocrFineLongEdge`, que sólo se paga cuando ya hay un documento a la vista.
   */
  readonly ocrMaxLongEdge: number;
  /**
   * Lado largo de la RELECTURA, cuando el catálogo ya reconoció algo.
   *
   * Es la otra mitad del reparto. `ocrMaxLongEdge` está calibrado para dejar de
   * perseguir texto en el ruido de una foto que no es un documento; éste, para
   * leer los campos de una que sí lo es. Medido sobre una cédula boliviana
   * auténtica fotografiada con un móvil, en su orientación correcta:
   *
   *   lado   cobertura   ms/cara   qué aparece
   *    600     0,216      ~235     nada del rótulo, ninguna fecha
   *    900     0,463      ~240     las tres fechas y sus rótulos
   *   1200     0,515      ~290     «IDENTIDAD» y el control del número en la MRZ
   *   1600     0,664      ~400     «IDENTIFICACIÓN PERSONAL», «DOMICILIO»
   *
   * 1200 y no 1600 porque lo que hay que comprar es el DÍGITO DE CONTROL de la
   * MRZ —de ahí salen el número y el nacimiento—, y eso ya se compra en la
   * tercera fila. La cuarta añade dos rótulos que sólo suben la cobertura, a
   * cambio de un 38 % más de reloj en el camino caliente de cada verificación.
   *
   * Ponlo igual o por debajo de `ocrMaxLongEdge` para desactivar la relectura.
   */
  readonly ocrFineLongEdge: number;
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
  /**
   * Qué tipos de documento admite este despliegue.
   *
   * Por omisión, sólo el carnet boliviano: es el único con analizador verificado
   * y es lo que el flujo móvil pide. Un pasaporte legítimo se rechaza —con ese
   * motivo y no con «no es un documento»— hasta que alguien lo habilite aquí.
   */
  readonly acceptedDocumentTypes: readonly IdentityDocumentType[];
  /**
   * Fronteras de la evidencia de identidad: por encima de `accept` se procesa,
   * entre las dos se pregunta a un factor externo, y por debajo se rechaza.
   */
  readonly documentAcceptConfidence: number;
  readonly documentReviewConfidence: number;
  /**
   * Quién resuelve la franja de duda. `HUMAN` la manda a la bandeja del portal;
   * `AI` a un modelo, cuando lo haya. Es una decisión de despliegue, no de
   * código: la elige el entorno y el pipeline no sabe cuál está puesta.
   */
  readonly arbitrationMode: IdentityArbitrationMode;

  readonly maxUploadBytes: number;
  /** País de emisión asumido cuando quien llama no declara otro. */
  readonly defaultDocumentCountry: string;

  /*
   * ── Detección de fraude documental ──────────────────────────────────────
   *
   * La puerta de documentos contesta «¿es un carnet?». Esto contesta la
   * siguiente, que es la que separa el fraude: «¿es un carnet AUTÉNTICO?». Son
   * ajustes aparte porque se calibran contra otra población —documentos
   * falsificados, no documentos mal fotografiados— y porque un despliegue puede
   * querer la primera sin la segunda mientras monta el servidor de embeddings.
   */
  /** Si se ejecutan las pruebas forenses. Apagarlo deja el worker como estaba. */
  readonly fraudDetectionEnabled: boolean;
  /**
   * En estricto, una prueba que NO se pudo ejecutar escala el caso a una
   * persona en vez de dejarlo pasar. Es lo que debe estar puesto en producción:
   * la alternativa convierte una caída del servidor de embeddings en una puerta
   * abierta.
   */
  readonly fraudStrictMode: boolean;
  /** Cobertura mínima de la plantilla del catálogo. */
  readonly fraudTemplateCoverageMin: number;
  /** Riesgo a partir del cual el caso va a revisión humana. */
  readonly fraudReviewRisk: number;
  /** Riesgo a partir del cual el caso se marca como sospecha de fraude. */
  readonly fraudSuspicionRisk: number;
  /** Suelo de coseno del clasificador semántico. Propiedad del MODELO servido. */
  readonly fraudSemanticFloor: number;
  /** Margen mínimo entre la mejor sonda positiva y la mejor negativa. */
  readonly fraudSemanticMargin: number;
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
  ocrMaxLongEdge: 600,
  ocrFineLongEdge: 1200,
  faceCropPaddingRatio: 0.25,
  minDocumentFacePx: 80,
  livenessEnabled: true,
  livenessPassScore: 0.55,
  livenessFailScore: 0.35,
  documentClassificationEnabled: true,
  ocrProvider: 'tesseract',
  faceProvider: 'human',
  livenessProvider: 'human',
  acceptedDocumentTypes: [IdentityDocumentType.BOLIVIA_CI],
  documentAcceptConfidence: DEFAULT_IDENTITY_THRESHOLDS.accept,
  documentReviewConfidence: DEFAULT_IDENTITY_THRESHOLDS.review,
  // Humana mientras no haya un modelo calibrado para esto. El seam existe desde
  // hoy para que enchufarlo sea cambiar una variable, no reescribir el pipeline.
  arbitrationMode: 'HUMAN',
  maxUploadBytes: 10_485_760,
  defaultDocumentCountry: 'BO',
  fraudDetectionEnabled: true,
  // Apagado por omisión y ENCENDIDO por el esquema de entorno en cuanto el
  // worker se habilita en producción: en desarrollo no siempre hay servidor de
  // embeddings, y mandar cada prueba a una cola humana inexistente sólo
  // impediría recorrer el flujo.
  fraudStrictMode: false,
  fraudTemplateCoverageMin: UMBRALES_DE_FRAUDE_POR_DEFECTO.coberturaMinima,
  fraudReviewRisk: UMBRALES_DE_FRAUDE_POR_DEFECTO.riesgoDeRevision,
  fraudSuspicionRisk: UMBRALES_DE_FRAUDE_POR_DEFECTO.riesgoDeSospecha,
  fraudSemanticFloor: UMBRALES_SEMANTICOS_POR_DEFECTO.sueloDeParecido,
  fraudSemanticMargin: UMBRALES_SEMANTICOS_POR_DEFECTO.margenMinimo,
};
