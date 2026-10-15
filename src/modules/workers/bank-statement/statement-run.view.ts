import { Prisma, WorkerRunStatus } from '@prisma/client';

/**
 * Estados terminales SIN resultado: subir otra vez el mismo documento vuelve a
 * intentarlo en lugar de devolver el intento anterior. Ver `createRun`.
 */
export const RETRYABLE_STATUSES: readonly WorkerRunStatus[] = [
  WorkerRunStatus.FAILED,
  WorkerRunStatus.CANCELLED,
  /*
   * `PDF_INVALID` está aquí por el MISMO motivo que `FAILED`, y es fácil de
   * pasar por alto: un rechazo es un veredicto del clasificador de ese día. Si
   * no fuera reintentable, ninguna recalibración de los umbrales ni ninguna
   * señal nueva alcanzaría jamás a los documentos que la motivaron —se afina el
   * triage, el mismo archivo sigue devolviendo «PDF no válido», y lo razonable
   * es concluir que el arreglo no sirvió—. Volver a subirlo es exactamente lo
   * que hace quien no está de acuerdo con el rechazo.
   */
  WorkerRunStatus.PDF_INVALID,
];

/** Estados desde los que ya no puede pasar nada más. */
export const TERMINAL_STATUSES: readonly WorkerRunStatus[] = [
  WorkerRunStatus.SUCCEEDED,
  WorkerRunStatus.SUCCEEDED_WITH_WARNINGS,
  WorkerRunStatus.FAILED,
  WorkerRunStatus.CANCELLED,
  WorkerRunStatus.PDF_INVALID,
];

/** Columnas que se devuelven al cliente. `fileBytes` NUNCA está entre ellas. */
export const RUN_SELECTION = {
  requestId: true,
  status: true,
  progress: true,
  inputSource: true,
  fixtureCode: true,
  fileName: true,
  fileHash: true,
  fileSizeBytes: true,
  resultJson: true,
  provisionalResultJson: true,
  warningsJson: true,
  confidence: true,
  documentTypeConfidence: true,
  institutionId: true,
  transactionCount: true,
  errorCode: true,
  errorMessage: true,
  reviewReason: true,
  rejectionReason: true,
  reviewPriority: true,
  reviewOpenedAt: true,
  reviewClaimedBy: true,
  reviewClaimedAt: true,
  reviewResolvedBy: true,
  reviewResolvedAt: true,
  reviewNotes: true,
  attemptCount: true,
  queuedAt: true,
  startedAt: true,
  finishedAt: true,
  requestedBy: true,
  correlationId: true,
} satisfies Prisma.BankStatementRunSelect;

export type BankStatementRunView = Prisma.BankStatementRunGetPayload<{
  select: typeof RUN_SELECTION;
}>;
