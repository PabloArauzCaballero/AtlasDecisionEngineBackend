import type {
  StatementRejectionReason,
  StatementReviewReason,
  WorkerInputSource,
  WorkerRunStatus,
} from '@prisma/client';
import type { WorkerRunDto } from './workers.dto';

/**
 * Forma común de una fila de ejecución, sea del worker que sea.
 *
 * Se declara estructuralmente y no como unión de los dos tipos de Prisma para
 * que el mapeador no tenga que saber de qué tabla viene la fila: lo que el
 * frontend pinta es exactamente esto, y es idéntico en las dos vistas.
 */
export interface WorkerRunRow {
  requestId: string;
  status: WorkerRunStatus;
  progress: number;
  inputSource: WorkerInputSource;
  fixtureCode: string | null;
  attemptCount: number;
  queuedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  requestedBy: string;
  correlationId: string;
  resultJson?: unknown;
  warningsJson?: unknown;
  errorCode: string | null;
  errorMessage: string | null;
  /*
   * Opcionales porque sólo el worker de extractos los tiene. Un worker sin
   * franja de revisión no los envía en vez de mandarlos como `null`: `null`
   * afirmaría «no hay motivo», y lo cierto es «esta pregunta no aplica aquí».
   */
  reviewReason?: StatementReviewReason | null;
  rejectionReason?: StatementRejectionReason | null;
  reviewPriority?: number | null;
}

/**
 * Traduce una fila a lo que se publica.
 *
 * El resultado y las advertencias se omiten mientras no existan, en vez de
 * viajar como `null`: un cliente que recibe `result: null` mientras la
 * ejecución corre tiene que distinguir «todavía no» de «no hubo», y esa
 * distinción ya la da `status`.
 */
export function toWorkerRunDto(row: WorkerRunRow): WorkerRunDto {
  return {
    requestId: row.requestId,
    status: row.status,
    progress: row.progress,
    inputSource: row.inputSource,
    fixtureCode: row.fixtureCode,
    attemptCount: row.attemptCount,
    queuedAt: row.queuedAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    requestedBy: row.requestedBy,
    correlationId: row.correlationId,
    ...(row.resultJson ? { result: row.resultJson } : {}),
    ...(row.warningsJson ? { warnings: row.warningsJson } : {}),
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    ...(row.reviewReason === undefined ? {} : { reviewReason: row.reviewReason }),
    ...(row.rejectionReason === undefined ? {} : { rejectionReason: row.rejectionReason }),
    ...(row.reviewPriority === undefined ? {} : { reviewPriority: row.reviewPriority }),
  };
}
