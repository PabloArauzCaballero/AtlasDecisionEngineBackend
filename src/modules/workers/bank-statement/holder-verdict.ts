/**
 * El veredicto del titular, en el idioma del worker: qué se compara, qué se guarda en la fila y qué
 * desenlace es una revisión. La regla en sí vive en `core/engine/holder/holder-match.ts`.
 */
import { WorkerRunStatus } from '@prisma/client';
import type { HolderColumns } from './bank-statement-run.store';
import type { StatementOutcome } from './statement-outcome';
import { assessHolder, type HolderAssessment } from './core/engine/holder/holder-match';
import type { NormalizedBankStatement } from './core/engine/normalized/normalized-model';

/** Mensajes que quedan en la ejecución; los que lee el cliente los escribe AtlasBackend. */
export const HOLDER_MISMATCH_MESSAGE =
  'El titular del extracto no coincide con el cliente que lo subió.';
export const HOLDER_UNREADABLE_MESSAGE =
  'No se pudo leer el titular del extracto; una persona confirma que la cuenta es del cliente.';

export type ExpectedHolderRow = {
  expectedHolderName: string | null;
  expectedHolderGivenNames: string | null;
  expectedHolderSurnames: string | null;
};

export function holderOf(
  run: ExpectedHolderRow,
  statement: NormalizedBankStatement | undefined,
): HolderAssessment {
  const expected = run.expectedHolderName
    ? {
        fullName: run.expectedHolderName,
        givenNames: run.expectedHolderGivenNames,
        surnames: run.expectedHolderSurnames,
      }
    : null;
  return assessHolder(statement?.account.holderName ?? null, expected);
}

export function holderColumns(holder: HolderAssessment): HolderColumns {
  return {
    holderNameRead:
      holder.holdersRead.length > 0 ? holder.holdersRead.join(' · ').slice(0, 300) : null,
    holderVerdict: holder.verdict,
  };
}

export function isReview(outcome: StatementOutcome): boolean {
  return outcome.status === WorkerRunStatus.PENDING_REVIEW;
}
