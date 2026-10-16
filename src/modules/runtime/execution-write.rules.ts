import { HttpStatus } from '@nestjs/common';
import { ExecutionStatus } from '@prisma/client';
import { DomainException } from '../../common/errors/domain-exception';
import type { EngineExecutionResult } from '../graph/graph.types';
import { isManualReviewOutcome } from './manual-review-case-code';
import type { WriteExecutionInput } from './execution-write.types';

/**
 * Invariante de negocio: una decisión que se anuncia como revisión manual TIENE que dejar un caso
 * en la cola, y un caso sólo existe si la decisión lo anuncia. Sin esto, un grafo cuyo nodo
 * RESULT devuelve «REVISION_MANUAL» quedaba SUCCEEDED sin fila en `decision_manual_review_case`:
 * el cliente veía «a revisión» y ningún analista tenía nada que revisar (hallazgo A12 del KYB,
 * 2026-09-27). Se lanza ANTES de escribir nada, dentro de la misma transacción que la ejecución,
 * la idempotencia y la auditoría: no queda decisión a medias. Es un 422 —un defecto del artefacto,
 * determinista— para que el runtime lo registre como DECISION_FAILED y no lo reintente.
 *
 * `statusOverride` (NO_DECISION por salida económica inválida o base ausente) queda fuera: ahí el
 * runtime ya quitó el caso a propósito y la ejecución no es una decisión tomada.
 */
export function assertManualReviewConsistency(
  result: EngineExecutionResult | undefined,
  statusOverride: WriteExecutionInput['statusOverride'],
): void {
  if (!result || statusOverride || result.status !== 'SUCCEEDED') return;
  const announcesReview = isManualReviewOutcome(result.outcome);
  const opensCase = Boolean(result.manualReview);
  if (announcesReview === opensCase) return;
  throw new DomainException(
    announcesReview ? 'MANUAL_REVIEW_WITHOUT_CASE' : 'MANUAL_REVIEW_CASE_WITHOUT_OUTCOME',
    announcesReview
      ? `The artifact reports outcome ${String(result.outcome)} but did not open a manual review case`
      : `The artifact opened a manual review case but its outcome is ${String(result.outcome)}`,
    HttpStatus.UNPROCESSABLE_ENTITY,
    { outcome: result.outcome ?? null, queueCode: result.manualReview?.queueCode ?? null },
  );
}

export function executionStatus(
  result?: EngineExecutionResult,
  errors?: WriteExecutionInput['errors'],
): ExecutionStatus {
  if (errors?.length && !result) return ExecutionStatus.NO_DECISION;
  if (!result) return ExecutionStatus.FAILED;
  if (result.status === 'NO_DECISION') return ExecutionStatus.NO_DECISION;
  if (result.status === 'FAILED') return ExecutionStatus.FAILED;
  return ExecutionStatus.SUCCEEDED;
}
