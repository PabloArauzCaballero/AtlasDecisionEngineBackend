export type StatementErrorCode =
  | 'EMPTY_FILE'
  | 'FILE_TOO_LARGE'
  | 'INVALID_PDF'
  | 'ENCRYPTED_PDF'
  | 'SCANNED_PDF_UNSUPPORTED'
  | 'NOT_A_FINANCIAL_STATEMENT'
  | 'DOUBTFUL_DOCUMENT'
  | 'EMPTY_DOCUMENT'
  | 'UNSUPPORTED_INSTITUTION'
  | 'UNSUPPORTED_STATEMENT_FORMAT'
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
