import { IdentityReviewReason, Prisma } from '@prisma/client';
import type { IdentityReviewItemDto } from './identity-review.dto';

/**
 * Columnas que la cola necesita.
 *
 * Las IMÁGENES no están, y no es una omisión: `documentBytes` y `selfieBytes`
 * pesan megas cada una, y traerlas para pintar una lista de veinticinco filas
 * convertiría abrir la bandeja en descargar el carnet de veinticinco personas.
 * Quien arbitra las ve de una en una, por el endpoint de miniaturas que ya
 * existe para las ejecuciones.
 */
export const QUEUE_SELECTION = {
  requestId: true,
  requestedBy: true,
  status: true,
  reviewReason: true,
  reviewPriority: true,
  reviewOpenedAt: true,
  reviewClaimedBy: true,
  reviewClaimedAt: true,
  arbitrationMode: true,
  documentType: true,
  documentCountry: true,
  documentTypeConfidence: true,
  // El veredicto del worker y su cifra: es lo que separa un caso de la PUERTA (sin veredicto) de
  // uno del VEREDICTO, y lo que la persona necesita ver antes de firmar.
  decision: true,
  similarityScore: true,
  errorCode: true,
  errorMessage: true,
  queuedAt: true,
} satisfies Prisma.IdentityVerificationRunSelect;

export type QueueRow = Prisma.IdentityVerificationRunGetPayload<{ select: typeof QUEUE_SELECTION }>;

export function toReviewItem(row: QueueRow, now: number): IdentityReviewItemDto {
  return {
    requestId: row.requestId,
    requestedBy: row.requestedBy,
    status: row.status,
    reviewReason: row.reviewReason as IdentityReviewReason,
    reviewPriority: row.reviewPriority,
    arbitrationMode: row.arbitrationMode,
    documentType: row.documentType,
    documentCountry: row.documentCountry,
    documentTypeConfidence:
      row.documentTypeConfidence === null ? null : Number(row.documentTypeConfidence),
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    reviewOpenedAt: row.reviewOpenedAt,
    pendingMs: transcurrido(row.reviewOpenedAt, now),
    reviewClaimedBy: row.reviewClaimedBy,
    reviewClaimedAt: row.reviewClaimedAt,
    queuedAt: row.queuedAt,
  };
}

/** Milisegundos desde una marca, o `null` si la marca no existe. */
export function transcurrido(desde: Date | null, ahora: number): number | null {
  return desde === null ? null : Math.max(0, ahora - desde.getTime());
}
