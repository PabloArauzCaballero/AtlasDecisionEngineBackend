import { Prisma, WorkerRunStatus } from '@prisma/client';

/** Estados desde los que ya no puede pasar nada más. */
export const TERMINAL_STATUSES: readonly WorkerRunStatus[] = [
  WorkerRunStatus.SUCCEEDED,
  WorkerRunStatus.SUCCEEDED_WITH_WARNINGS,
  WorkerRunStatus.FAILED,
  WorkerRunStatus.CANCELLED,
];

/**
 * Columnas que se devuelven al cliente.
 *
 * Las tres columnas de imágenes NUNCA están entre ellas. No es una precaución
 * de más: son la foto de la cara y del documento de una persona, y basta con
 * que una consulta las seleccione «por comodidad» para que viajen en cada
 * sondeo del portal mientras la ejecución corre.
 */
export const RUN_SELECTION = {
  requestId: true,
  status: true,
  progress: true,
  inputSource: true,
  fixtureCode: true,
  documentCountry: true,
  documentFileName: true,
  selfieFileName: true,
  imageSizeBytes: true,
  resultJson: true,
  warningsJson: true,
  decision: true,
  documentType: true,
  similarityScore: true,
  errorCode: true,
  errorMessage: true,
  attemptCount: true,
  queuedAt: true,
  startedAt: true,
  finishedAt: true,
  requestedBy: true,
  correlationId: true,
} satisfies Prisma.IdentityVerificationRunSelect;

export type IdentityVerificationRunView = Prisma.IdentityVerificationRunGetPayload<{
  select: typeof RUN_SELECTION;
}>;
