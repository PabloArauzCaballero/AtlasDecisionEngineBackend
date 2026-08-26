export type StatementErrorCode =
  | 'EMPTY_FILE'
  | 'FILE_TOO_LARGE'
  | 'INVALID_PDF'
  | 'ENCRYPTED_PDF'
  | 'SCANNED_PDF_UNSUPPORTED'
  | 'NOT_A_FINANCIAL_STATEMENT'
  | 'DOUBTFUL_DOCUMENT'
  | 'EMPTY_DOCUMENT'
  /** El documento lo emitió alguien que no es una entidad financiera boliviana. */
  | 'NON_BANKING_ISSUER'
  /** No se atribuye a nadie y no queda ninguna señal financiera en la carátula. */
  | 'UNRECOGNIZED_ISSUER'
  /** Se atribuye a una entidad del padrón cuya licencia de ASFI no está vigente. */
  | 'UNLICENSED_INSTITUTION'
  | 'UNSUPPORTED_INSTITUTION'
  | 'UNSUPPORTED_STATEMENT_FORMAT'
  /** El contenedor demuestra que el archivo se compuso o se editó con otro programa. */
  | 'TAMPERED_DOCUMENT'
  /** Hay indicios de edición y ninguno concluyente: lo mira una persona. */
  | 'SUSPECTED_TAMPERING'
  /** El PDF lleva JavaScript, acciones de lanzamiento o archivos incrustados. */
  | 'ACTIVE_CONTENT_IN_DOCUMENT'
  /** El extracto no cubre los meses completos que exige la política. */
  | 'INSUFFICIENT_STATEMENT_PERIOD'
  | 'NO_TRANSACTIONS'
  | 'PDF_EXTRACTION_FAILED'
  | 'PDF_TOO_COMPLEX'
  | 'PDF_PROCESSING_TIMEOUT'
  | 'INTERNAL_ERROR';

/**
 * Qué se hace con el documento cuando el análisis no llega a un resultado.
 *
 * Es la pieza que separa «no pudimos» de «no era». Antes había una sola salida
 * —fallar— y las tres situaciones se contaban igual: el contrato que nadie debió
 * subir, el extracto de un banco que todavía no se sabe leer, y la base de datos
 * que se cayó a mitad. Con un solo desenlace, o se manda todo a revisión humana
 * —y la cola se llena de facturas— o no se manda nada —y el caso ambiguo se
 * pierde—.
 *
 * - `INVALID`: hay evidencia suficiente de que el documento NO es un extracto.
 *   Se cierra, se registra y se le dice al usuario. No entra en ninguna cola.
 * - `REVIEW`: podría serlo, y la duda es real. Va a la cola de revisión humana.
 * - `FAILED`: el análisis no pudo completarse por una causa que no habla del
 *   documento. Es el único que puede reintentarse.
 */
export type StatementDisposition = 'INVALID' | 'REVIEW' | 'FAILED';

/**
 * Desenlace por defecto de cada código, cuando el sitio que lanza el error no
 * sabe más que su código.
 *
 * `NOT_A_FINANCIAL_STATEMENT` está aquí como `INVALID` porque el clasificador ya
 * lo dice con su veredicto: cuando la confianza cae en la franja de duda, quien
 * lanza usa `DOUBTFUL_DOCUMENT`, que es un código distinto justamente para no
 * tener que confiar en que alguien se acuerde de pasar el desenlace a mano.
 */
const DEFAULT_DISPOSITION: Readonly<Record<StatementErrorCode, StatementDisposition>> = {
  // Fallos del ARCHIVO: no hay documento que analizar y no lo habrá al reintentar.
  EMPTY_FILE: 'INVALID',
  FILE_TOO_LARGE: 'INVALID',
  INVALID_PDF: 'INVALID',
  EMPTY_DOCUMENT: 'INVALID',
  PDF_TOO_COMPLEX: 'INVALID',
  // Fallos del CONTENIDO: es un PDF legítimo y no es un extracto.
  NOT_A_FINANCIAL_STATEMENT: 'INVALID',
  /*
   * Los dos del EMISOR se rechazan, y es deliberado que no vayan a la cola.
   *
   * `NON_BANKING_ISSUER` se apoya en evidencia positiva: la carátula nombra a
   * una telefónica, una aseguradora o un banco extranjero. Preguntarle eso a
   * una persona sería pedirle que confirme lo que el documento dice de sí mismo.
   *
   * `UNRECOGNIZED_ISSUER` es el otro extremo: no hay atribución NI ninguna señal
   * financiera —ni ASFI, ni dominio bancario, ni seguro de depósitos—. Mandarlo a
   * revisión pondría delante de un analista un documento sobre el que no hay
   * nada que decidir, y el trabajo que mueve el caso —conseguir el extracto de
   * verdad— sólo puede hacerlo quien lo subió.
   */
  NON_BANKING_ISSUER: 'INVALID',
  UNRECOGNIZED_ISSUER: 'INVALID',
  /*
   * Los tres del CONTENEDOR. Se rechazan y no se encolan, y el motivo es el
   * mismo que en `NON_BANKING_ISSUER`: la evidencia es POSITIVA y está en el
   * archivo, no en su interpretación. Preguntarle a un analista si un PDF
   * producido con Photoshop es el que emitió el banco sería pedirle que
   * confirme lo que el archivo declara de sí mismo — y encima con el documento
   * delante, donde no se ve nada raro: la manipulación vive en la estructura,
   * no en la página.
   *
   * `ACTIVE_CONTENT_IN_DOCUMENT` además no se abre NUNCA: un PDF con JavaScript
   * incrustado no es un extracto dudoso, es un archivo que no debe llegar al
   * escritorio de nadie.
   */
  TAMPERED_DOCUMENT: 'INVALID',
  ACTIVE_CONTENT_IN_DOCUMENT: 'INVALID',
  /*
   * La cobertura insuficiente se RECHAZA y no se revisa, y es la más discutible
   * de la tabla. Va aquí porque la acción que resuelve el caso sólo la puede
   * hacer quien subió el archivo —volver a su banca por internet y pedir el
   * periodo de tres meses—, y porque ningún analista puede suplir con criterio
   * los meses que faltan: no es una duda sobre el documento, es una ausencia de
   * datos que ninguna revisión rellena.
   */
  INSUFFICIENT_STATEMENT_PERIOD: 'INVALID',
  /*
   * Un PDF que pdf.js no consigue abrir, o que pide contraseña, se RECHAZA y no
   * se encola. Es la corrección menos obvia de esta tabla y la que más cola
   * ahorra: mandarlo a revisión pone delante de una persona un archivo que
   * tampoco ella puede abrir, y el trabajo que en realidad hace falta —conseguir
   * la versión legible— sólo puede hacerlo quien lo subió. Decírselo en el
   * momento es la única acción que mueve el caso.
   */
  PDF_EXTRACTION_FAILED: 'INVALID',
  ENCRYPTED_PDF: 'INVALID',
  // Duda razonable: se parece a un extracto y no se pudo confirmar.
  DOUBTFUL_DOCUMENT: 'REVIEW',
  /*
   * Una entidad intervenida sí va a la cola, y es la diferencia con los dos de
   * arriba: el documento es auténtico y sus movimientos son ciertos. Lo que hace
   * falta es que alguien decida qué peso darle sabiendo que la entidad ya no
   * opera, y eso no lo puede resolver quien subió el archivo.
   */
  UNLICENSED_INSTITUTION: 'REVIEW',
  /*
   * La sospecha SÍ va a la cola. Es la franja donde vive el «Guardar como PDF»
   * del navegador y el archivo con una revisión incremental: rechazarlos
   * castigaría a clientes honestos por la costumbre de su banco, y aceptarlos
   * sería mirar para otro lado. Es exactamente el caso para el que existe la
   * revisión humana.
   */
  SUSPECTED_TAMPERING: 'REVIEW',
  UNSUPPORTED_INSTITUTION: 'REVIEW',
  UNSUPPORTED_STATEMENT_FORMAT: 'REVIEW',
  NO_TRANSACTIONS: 'REVIEW',
  // Un escaneado SÍ es probablemente un extracto: hay capa de imagen que una
  // persona lee de un vistazo y el motor no.
  SCANNED_PDF_UNSUPPORTED: 'REVIEW',
  // El usuario no debe esperar más; el documento sigue siendo válido.
  PDF_PROCESSING_TIMEOUT: 'REVIEW',
  INTERNAL_ERROR: 'FAILED',
};

export class StatementProcessingError extends Error {
  /** Qué hacer con el documento. Se deriva del código salvo indicación expresa. */
  readonly disposition: StatementDisposition;

  constructor(
    readonly code: StatementErrorCode,
    message: string,
    readonly httpStatus: number,
    readonly details?: Readonly<Record<string, unknown>>,
    disposition?: StatementDisposition,
  ) {
    super(message);
    this.name = 'StatementProcessingError';
    this.disposition = disposition ?? DEFAULT_DISPOSITION[code] ?? 'FAILED';
  }
}

/** Desenlace por defecto de un código, para quien sólo tiene el código. */
export function dispositionOf(code: string): StatementDisposition {
  return DEFAULT_DISPOSITION[code as StatementErrorCode] ?? 'FAILED';
}
