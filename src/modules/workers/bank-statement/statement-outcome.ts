import { StatementRejectionReason, StatementReviewReason, WorkerRunStatus } from '@prisma/client';
import { dispositionOf, type StatementDisposition } from './core/domain/errors';

/**
 * El único sitio donde se decide en qué estado termina una conversión.
 *
 * Está aparte del worker porque es una regla de negocio, no un detalle de
 * ejecución: qué se rechaza, qué se pregunta y qué se procesa es lo que se
 * discute y se recalibra, y tenerlo repartido en `catch` era lo que hacía
 * imposible responder «¿por qué acabó esto en la cola?» sin leer el worker
 * entero. Además se puede probar sin base de datos ni PDF.
 *
 * Tres invariantes que el resto del módulo da por ciertas:
 *
 * 1. `PDF_INVALID` **nunca** lleva `reviewReason`, y por tanto nunca aparece en
 *    la cola de revisión. Es la regla que impide que la cola se convierta en el
 *    basurero de lo que el algoritmo no entendió.
 * 2. `PENDING_REVIEW` **siempre** lleva `reviewReason`. Un pendiente sin motivo
 *    no se puede categorizar, y una lista sin categorías vuelve a ser la tabla
 *    gigante que ésta existe para no ser.
 * 3. La prioridad se DERIVA del motivo. Puesta a mano acabaría siendo «alta»
 *    siempre, que es lo mismo que no tenerla.
 */
export interface StatementOutcome {
  readonly status: WorkerRunStatus;
  readonly reviewReason: StatementReviewReason | null;
  readonly rejectionReason: StatementRejectionReason | null;
  /** 1 alta · 2 media · 3 baja. `null` cuando el caso no entra en la cola. */
  readonly reviewPriority: number | null;
}

/**
 * Por qué se rechaza cada código. Cinco motivos para trece códigos: varios
 * fallos técnicos distintos son, para quien subió el archivo, el mismo problema
 * y la misma acción —conseguir el documento bueno—, y multiplicar los motivos
 * sólo dificultaría medir cuál pesa.
 */
const REJECTION_BY_CODE: Readonly<Record<string, StatementRejectionReason>> = {
  EMPTY_FILE: StatementRejectionReason.EMPTY_DOCUMENT,
  EMPTY_DOCUMENT: StatementRejectionReason.EMPTY_DOCUMENT,
  FILE_TOO_LARGE: StatementRejectionReason.UNSUPPORTED_FILE,
  INVALID_PDF: StatementRejectionReason.UNSUPPORTED_FILE,
  PDF_TOO_COMPLEX: StatementRejectionReason.UNSUPPORTED_FILE,
  NOT_A_FINANCIAL_STATEMENT: StatementRejectionReason.NOT_BANK_STATEMENT,
  /*
   * Los dos del emisor comparten motivo con el anterior a propósito. Para quien
   * subió el archivo, «esto es de una telefónica» y «esto no reúne señales de
   * ser un extracto» son el mismo hecho —no es un extracto bancario— y la misma
   * acción: subir el documento correcto. El detalle de QUIÉN lo emitió viaja en
   * los `details` del error, que es donde se puede medir sin multiplicar un
   * enum del que cuelga el ciclo de vida entero.
   */
  NON_BANKING_ISSUER: StatementRejectionReason.NOT_BANK_STATEMENT,
  UNRECOGNIZED_ISSUER: StatementRejectionReason.NOT_BANK_STATEMENT,
  PDF_EXTRACTION_FAILED: StatementRejectionReason.CORRUPTED_PDF,
  ENCRYPTED_PDF: StatementRejectionReason.UNREADABLE_DOCUMENT,
  /*
   * Los tres de ADMISIÓN sí tienen motivo propio, al revés que los del emisor.
   *
   * La regla que gobierna esta tabla es «un motivo por cada ACCIÓN distinta del
   * cliente», y aquí son tres acciones distintas: subir otro documento, subir el
   * mismo sin editarlo, y subir el mismo con más meses. Colapsarlos en
   * `NOT_BANK_STATEMENT` le diría a quien manipuló un extracto que su archivo no
   * era un extracto —cuando lo era— y a quien subió un mes que consiga otro
   * documento —cuando el suyo servía—.
   */
  TAMPERED_DOCUMENT: StatementRejectionReason.TAMPERED_DOCUMENT,
  ACTIVE_CONTENT_IN_DOCUMENT: StatementRejectionReason.ACTIVE_CONTENT,
  INSUFFICIENT_STATEMENT_PERIOD: StatementRejectionReason.INSUFFICIENT_PERIOD,
};

/** Por qué se deriva a una persona cada código. */
const REVIEW_BY_CODE: Readonly<Record<string, StatementReviewReason>> = {
  DOUBTFUL_DOCUMENT: StatementReviewReason.DOUBTFUL_DOCUMENT,
  UNSUPPORTED_INSTITUTION: StatementReviewReason.UNKNOWN_BANK,
  UNLICENSED_INSTITUTION: StatementReviewReason.UNKNOWN_BANK,
  UNSUPPORTED_STATEMENT_FORMAT: StatementReviewReason.UNKNOWN_BANK,
  NO_TRANSACTIONS: StatementReviewReason.PARTIAL_EXTRACTION,
  SCANNED_PDF_UNSUPPORTED: StatementReviewReason.OCR_ERROR,
  PDF_PROCESSING_TIMEOUT: StatementReviewReason.TIMEOUT,
  SUSPECTED_TAMPERING: StatementReviewReason.SUSPECTED_TAMPERING,
};

/**
 * Prioridad por motivo, y el criterio es cuánto cuesta NO mirarlo.
 *
 * Arriba lo que tiene a alguien esperando o publica cifras que no cuadran; en
 * medio lo que ya tiene dato pero no se puede firmar; abajo lo que probablemente
 * no sea ni un extracto —barato de descartar, y descartarlo no desbloquea a
 * nadie—.
 */
const PRIORITY_BY_REASON: Readonly<Record<StatementReviewReason, number>> = {
  [StatementReviewReason.TIMEOUT]: 1,
  [StatementReviewReason.AMBIGUOUS_DATA]: 1,
  /*
   * La sospecha de manipulación entra ARRIBA, y es el único motivo de la lista
   * que sube por lo que cuesta acertar y no por quién está esperando. Un
   * documento con indicios que se queda dos días en la cola se acaba aprobando
   * por antigüedad —«lleva mucho, será que está bien»—, que es exactamente la
   * forma en que una cola de fraude deja de servir para nada.
   */
  [StatementReviewReason.SUSPECTED_TAMPERING]: 1,
  [StatementReviewReason.LOW_CONFIDENCE]: 2,
  [StatementReviewReason.PARTIAL_EXTRACTION]: 2,
  [StatementReviewReason.OCR_ERROR]: 2,
  [StatementReviewReason.UNKNOWN_BANK]: 2,
  [StatementReviewReason.MANUAL_REQUEST]: 2,
  [StatementReviewReason.DOUBTFUL_DOCUMENT]: 3,
};

const FAILED: StatementOutcome = {
  status: WorkerRunStatus.FAILED,
  reviewReason: null,
  rejectionReason: null,
  reviewPriority: null,
};

/** Deriva el caso a una persona con el motivo dado. */
export function toReview(reason: StatementReviewReason): StatementOutcome {
  return {
    status: WorkerRunStatus.PENDING_REVIEW,
    reviewReason: reason,
    rejectionReason: null,
    reviewPriority: PRIORITY_BY_REASON[reason],
  };
}

/** Rechaza el documento con el motivo dado. Terminal, y fuera de la cola. */
export function toInvalid(reason: StatementRejectionReason): StatementOutcome {
  return {
    status: WorkerRunStatus.PDF_INVALID,
    reviewReason: null,
    rejectionReason: reason,
    reviewPriority: null,
  };
}

/**
 * Qué hacer con una conversión que terminó en error de negocio.
 *
 * `disposition` la trae el propio error; se acepta por separado para que quien
 * sólo conserva el código —una fila ya escrita, un reintento— obtenga el mismo
 * desenlace sin tener la excepción delante.
 */
export function outcomeForError(
  code: string,
  disposition: StatementDisposition = dispositionOf(code),
): StatementOutcome {
  if (disposition === 'INVALID') {
    // Un código sin motivo declarado se rechaza igual, pero como «no es un
    // extracto»: es la afirmación más débil de las cinco, y equivocarse hacia
    // la más débil es lo correcto cuando falta información.
    return toInvalid(REJECTION_BY_CODE[code] ?? StatementRejectionReason.NOT_BANK_STATEMENT);
  }
  if (disposition === 'REVIEW') {
    /*
     * Sin motivo declarado NO se inventa uno: se falla. Un pendiente con un
     * motivo elegido al azar contamina la categoría en la que cae, y la
     * categoría es lo que hace la cola legible. Prefiero un fallo visible —que
     * se reintenta y se arregla— a un pendiente mal clasificado, que nadie
     * detecta porque la lista sigue pintándose igual.
     */
    const reason = REVIEW_BY_CODE[code];
    return reason ? toReview(reason) : FAILED;
  }
  return FAILED;
}

export interface ExtractionQuality {
  readonly overallConfidence: number;
  /** Comprobaciones contables que NO pasaron, ya redactadas. */
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

/**
 * Qué hacer con una conversión que SÍ produjo movimientos.
 *
 * Terminar con filas no basta para darla por buena, y las dos razones son
 * distintas entre sí:
 *
 * - Las comprobaciones contables **fallaron**: los saldos o los totales que
 *   imprime el banco no cuadran con lo leído. Hay dato y es sospechoso, que es
 *   peor que no tenerlo — se publicaría como cierto. Va primero porque es
 *   evidencia contra el resultado, no una medida de incertidumbre.
 * - La confianza cayó por debajo del corte: se leyó algo y no se puede afirmar
 *   qué. Entre el corte y la banda «aceptable» sí se entrega, con advertencias:
 *   ahí hay dato utilizable y avisado, y mandarlo a una persona sería gastar
 *   revisión humana en algo que la pantalla ya rotula.
 */
export function outcomeForResult(
  quality: ExtractionQuality,
  minimumConfidence: number,
): StatementOutcome {
  if (quality.errors.length > 0) return toReview(StatementReviewReason.AMBIGUOUS_DATA);
  if (quality.overallConfidence < minimumConfidence) {
    return toReview(StatementReviewReason.LOW_CONFIDENCE);
  }
  return {
    status:
      quality.warnings.length > 0
        ? WorkerRunStatus.SUCCEEDED_WITH_WARNINGS
        : WorkerRunStatus.SUCCEEDED,
    reviewReason: null,
    rejectionReason: null,
    reviewPriority: null,
  };
}

/** Estados en los que un caso está esperando —o recibiendo— atención humana. */
export const REVIEW_STATUSES: readonly WorkerRunStatus[] = [
  WorkerRunStatus.PENDING_REVIEW,
  WorkerRunStatus.IN_REVIEW,
];
