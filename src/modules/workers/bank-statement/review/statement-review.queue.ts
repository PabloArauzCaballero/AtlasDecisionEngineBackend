import { Prisma, StatementReviewReason } from '@prisma/client';
import type { StatementReviewItemDto } from './statement-review.dto';

/** Columnas que la cola necesita. `fileBytes` NUNCA sale de aquí. */
export const QUEUE_SELECTION = {
  requestId: true,
  fileName: true,
  requestedBy: true,
  status: true,
  reviewReason: true,
  reviewPriority: true,
  reviewOpenedAt: true,
  reviewClaimedBy: true,
  reviewClaimedAt: true,
  errorCode: true,
  errorMessage: true,
  institutionId: true,
  confidence: true,
  documentTypeConfidence: true,
  transactionCount: true,
  queuedAt: true,
} satisfies Prisma.BankStatementRunSelect;

export function toReviewItem(
  row: Prisma.BankStatementRunGetPayload<{ select: typeof QUEUE_SELECTION }>,
  now: number,
): StatementReviewItemDto {
  return {
    requestId: row.requestId,
    fileName: row.fileName,
    requestedBy: row.requestedBy,
    status: row.status,
    // No puede ser nulo en la cola —la base lo impide— pero el tipo de Prisma
    // sí lo admite: el respaldo evita un `!` que mentiría sobre el esquema.
    reviewReason: row.reviewReason ?? StatementReviewReason.MANUAL_REQUEST,
    reviewPriority: row.reviewPriority ?? 3,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    institutionId: row.institutionId,
    documentTypeConfidence: toNumber(row.documentTypeConfidence),
    extractionConfidence: toNumber(row.confidence),
    transactionCount: row.transactionCount,
    reviewOpenedAt: row.reviewOpenedAt,
    pendingMs: elapsed(row.reviewOpenedAt, now),
    reviewClaimedBy: row.reviewClaimedBy,
    reviewClaimedAt: row.reviewClaimedAt,
    queuedAt: row.queuedAt,
  };
}

export function elapsed(from: Date | null, now: number): number | null {
  return from ? Math.max(0, now - from.getTime()) : null;
}

function toNumber(value: Prisma.Decimal | null): number | null {
  return value === null ? null : Number(value);
}
