import { StatementProcessingError } from '../domain/errors';
import type { NormalizedBankStatement } from '../engine/normalized/normalized-model';
import type { StatementAnalysis } from '../engine/statement-analysis';

/**
 * El análisis PROVISIONAL de un extracto que va a revisión humana (2026-10-15).
 *
 * Pablo: «que haga el ejercicio que ya sabe hacer —identificar los ingresos, gastos y categorías— sin
 * fijarse si es o no entidad validada». Antes, un emisor no reconocido cortaba el proceso ANTES de leer
 * los movimientos: el caso llegaba a la cola sin nada que mirar, y quien revisaba tenía que decidir a
 * ciegas. Ahora el motor lee el documento igual y adjunta lo leído al motivo de revisión.
 *
 * Lo que NO cambia: el documento no se admite. El desenlace sigue siendo el del motivo (la cola), y el
 * análisis viaja aparte (`provisional_result_json`), nunca como resultado aplicable.
 */
export function attachProvisional(
  error: StatementProcessingError,
  analysis: StatementAnalysis,
): StatementProcessingError {
  error.provisional = { kind: 'analysis', analysis };
  return error;
}

/** Sustituye el análisis interno por el contrato normalizado, que es lo que se guarda y se enseña. */
export function normalizeProvisional(
  error: unknown,
  normalize: (analysis: StatementAnalysis) => NormalizedBankStatement,
): void {
  if (!(error instanceof StatementProcessingError)) return;
  const provisional = error.provisional as
    { kind?: string; analysis?: StatementAnalysis } | undefined;
  if (provisional?.kind !== 'analysis' || !provisional.analysis) return;
  error.provisional = { kind: 'normalized', statement: normalize(provisional.analysis) };
}

/** El análisis provisional ya normalizado, si el error lo trae. */
export function provisionalStatementOf(error: unknown): NormalizedBankStatement | undefined {
  if (!(error instanceof StatementProcessingError)) return undefined;
  const provisional = error.provisional as
    { kind?: string; statement?: NormalizedBankStatement } | undefined;
  return provisional?.kind === 'normalized' ? provisional.statement : undefined;
}
