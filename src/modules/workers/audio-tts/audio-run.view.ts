import { Prisma, WorkerRunStatus } from '@prisma/client';

export const TERMINAL_STATUSES: readonly WorkerRunStatus[] = [
  WorkerRunStatus.SUCCEEDED,
  WorkerRunStatus.SUCCEEDED_WITH_WARNINGS,
  WorkerRunStatus.FAILED,
  WorkerRunStatus.CANCELLED,
];

/** Lo que se devuelve al cliente. El audio NUNCA está aquí: se pide aparte. */
/** Terminales SIN resultado: reenviar la misma locución vuelve a intentarla. */
export const RETRYABLE_STATUSES: readonly WorkerRunStatus[] = [
  WorkerRunStatus.FAILED,
  WorkerRunStatus.CANCELLED,
];

export const RUN_SELECTION = {
  requestId: true,
  status: true,
  progress: true,
  inputSource: true,
  fixtureCode: true,
  templateCode: true,
  variablesJson: true,
  language: true,
  outcome: true,
  assetId: true,
  cacheHit: true,
  resultJson: true,
  warningsJson: true,
  errorCode: true,
  errorMessage: true,
  attemptCount: true,
  queuedAt: true,
  startedAt: true,
  finishedAt: true,
  requestedBy: true,
  correlationId: true,
} satisfies Prisma.AudioTtsRunSelect;

export type AudioTtsRunView = Prisma.AudioTtsRunGetPayload<{ select: typeof RUN_SELECTION }>;
