/**
 * El titular que exige quien sube un extracto, tal como llega en la petición y tal como se guarda.
 */
import { WorkerRunStatus } from '@prisma/client';
import type { BankStatementRunView } from './statement-run.view';
import { REVIEW_STATUSES } from './statement-outcome';
import { nameTokens } from './core/engine/holder/holder-match';

/** El titular que exige quien sube el extracto. `null`: no se exige (Consola del portal, llamadas antiguas). */
export interface ExpectedHolderInput {
  readonly name: string;
  readonly givenNames: string | null;
  readonly surnames: string | null;
}

/** Del cuerpo de la petición al titular exigido; vacío o en blanco es «no se exige». */
export function expectedHolderOf(dto: {
  expectedHolderName?: string;
  expectedHolderGivenNames?: string;
  expectedHolderSurnames?: string;
}): ExpectedHolderInput | null {
  const name = dto.expectedHolderName?.trim() ?? '';
  if (nameTokens(name).length === 0) return null;
  return {
    name,
    givenNames: dto.expectedHolderGivenNames?.trim() || null,
    surnames: dto.expectedHolderSurnames?.trim() || null,
  };
}

/** La forma comparable de un nombre: dos subidas del mismo cliente dan la misma clave. */
export function holderKey(name: string | null | undefined): string | null {
  const tokens = name ? nameTokens(name) : [];
  return tokens.length === 0 ? null : [...tokens].sort().join(' ');
}

export function holderColumns(expected: ExpectedHolderInput | null) {
  return {
    expectedHolderName: expected?.name ?? null,
    expectedHolderGivenNames: expected?.givenNames ?? null,
    expectedHolderSurnames: expected?.surnames ?? null,
  };
}

/** El titular que ya exigía una ejecución, para conservarlo al reencolarla sin uno nuevo. */
export function holderInputOf(run: BankStatementRunView): ExpectedHolderInput | null {
  if (!run.expectedHolderName) return null;
  return {
    name: run.expectedHolderName,
    givenNames: run.expectedHolderGivenNames ?? null,
    surnames: run.expectedHolderSurnames ?? null,
  };
}

/**
 * El mismo PDF, pedido para OTRO titular (2026-10-16).
 *
 * La huella es única por tenant, así que el extracto de una persona subido por otra caía en la
 * deduplicación y devolvía la ejecución de la primera —con su capacidad de pago—. Un extracto es de una sola
 * cuenta: si quien lo pide ahora exige otro titular, no se le sirve la ejecución ajena.
 *
 * - `requeue`: la ejecución ya terminó (y no la resolvió una persona para otro titular): se reanaliza contra
 *   el titular nuevo, y la comparación lo rechazará si no es suyo.
 * - `pin`: nadie exigía titular (la subió la Consola) y sigue en curso: se le fija y se compara al terminar.
 * - `conflict`: sigue en curso o resuelta para OTRO titular: no se toca y la petición se rechaza (409).
 * - `null`: mismo titular, o ninguno exigido ahora: la deduplicación de siempre.
 */
export function holderConflict(
  existing: Pick<BankStatementRunView, 'status' | 'expectedHolderName' | 'reviewResolvedAt'>,
  expected: ExpectedHolderInput | null,
): 'requeue' | 'pin' | 'conflict' | null {
  const nuevo = holderKey(expected?.name);
  const previo = holderKey(existing.expectedHolderName);
  if (!nuevo || nuevo === previo) return null;
  const enCurso =
    existing.status === WorkerRunStatus.QUEUED ||
    existing.status === WorkerRunStatus.RUNNING ||
    REVIEW_STATUSES.includes(existing.status);
  if (!enCurso && !(previo && existing.reviewResolvedAt)) return 'requeue';
  return previo ? 'conflict' : 'pin';
}
