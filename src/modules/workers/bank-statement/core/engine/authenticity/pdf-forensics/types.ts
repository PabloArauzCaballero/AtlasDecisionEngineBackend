/**
 * En qué EJE vive un hallazgo.
 *
 * Es la corrección de arquitectura que el corpus pide con nombre propio: la
 * seguridad del archivo y la procedencia del documento son preguntas
 * independientes y no se compensan. Un PDF con JavaScript incrustado es
 * peligroso de abrir aunque lo haya producido el motor de informes de un banco;
 * un PDF compuesto en Photoshop es dudoso aunque sea inofensivo de abrir.
 *
 * Mezclarlas en un solo número deja la puerta abierta a la peor operación
 * posible: que una señal FAVORABLE de procedencia —el generador institucional,
 * que vale −25— reste de un fallo de seguridad. Con dos ejes, no puede.
 */
export type ForensicAxis =
  /** Qué le hace este archivo a quien lo abra. */
  | 'SECURITY'
  /** Qué dice el archivo sobre quién lo fabricó y si se tocó después. */
  | 'PROVENANCE';

/** Cada hallazgo, con su peso y su explicación. Es lo que queda en la traza. */
export interface ForensicSignal {
  readonly code: string;
  /**
   * 0..100. Cuánta sospecha aporta por sí solo.
   *
   * **Ninguno de estos pesos está calibrado.** Son los que declaró el encargo, y
   * la auditoría del corpus devolvió `recommended_numeric_weight: null` en las
   * diez señales: no hay una tasa publicada de detección ni de falso positivo
   * que los sostenga, porque no existe un corpus de extractos bolivianos
   * alterados con verdad conocida contra el que medirlos.
   */
  readonly weight: number;
  /** `CRITICAL` cierra el documento por sí sola, sin sumar con nada. */
  readonly severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  readonly axis: ForensicAxis;
  readonly detail: string;
}

/** Lo que se pudo leer de la estructura del contenedor. */
export interface PdfProvenance {
  readonly producer: string | null;
  readonly creator: string | null;
  readonly creationDate: Date | null;
  readonly modificationDate: Date | null;
  /** Cuántas veces se ha reescrito el archivo por encima de su versión original. */
  readonly incrementalUpdates: number;
  readonly hasAcroForm: boolean;
  readonly annotationSubtypes: readonly string[];
  readonly hasActiveContent: boolean;
  readonly embeddedFileCount: number;
  /** Fuentes declaradas y cuántas de ellas viajan incrustadas en el archivo. */
  readonly fontsDeclared: number;
  readonly fontsEmbedded: number;
  /**
   * Fuentes declaradas que NO son de las catorce estándar del formato.
   *
   * La distinción es la que hace útil la señal. Helvetica, Times y Courier no se
   * incrustan nunca —el visor las tiene— así que su ausencia no dice nada; una
   * Calibri o una Arial Narrow declarada y no incrustada sí, porque es lo que
   * ocurre cuando el documento se compuso en un equipo que las tenía instaladas.
   */
  readonly nonStandardFonts: number;
  readonly pdfVersion: string | null;
}

export interface ForensicReport {
  readonly provenance: PdfProvenance;
  readonly signals: readonly ForensicSignal[];
  /** 0..100. La suma acotada de los pesos; 100 cuando hay una señal crítica. */
  readonly suspicionScore: number;
  /**
   * 0..100, sólo del eje de SEGURIDAD.
   *
   * Nunca recibe créditos: aquí no entra el peso negativo del generador
   * institucional ni ningún otro descuento. Un archivo que ejecuta código lo
   * ejecuta igual lo haya escrito quien lo haya escrito.
   */
  readonly securityScore: number;
  /** 0..100, sólo del eje de PROCEDENCIA. Aquí sí se aplican los créditos. */
  readonly provenanceScore: number;
  /** Qué clase de números son los de arriba. */
  readonly calibration: 'UNCALIBRATED_WEIGHTS_DECLARED_IN_BRIEF';
}
