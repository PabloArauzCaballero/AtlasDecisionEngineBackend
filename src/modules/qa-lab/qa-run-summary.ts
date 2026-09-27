/**
 * Lectura del resumen archivado de una corrida, con sus tres formas históricas.
 *
 * - Corridas COMPLETED antiguas: `{ PROPIEDAD: n, … }`, el conteo por propiedad a secas.
 * - Corridas COMPLETED desde que existe `stoppedReason`:
 *   `{ byProperty, stoppedReason, executedCases, plannedCases }`.
 * - Corridas FAILED: `{ failureCode, failureMessage }`.
 *
 * La respuesta pública conserva `summary` como el conteo por propiedad (o el motivo del
 * fallo) para no romper a quien ya la lee, y publica aparte si la corrida se cortó.
 */
import type { Prisma } from '@prisma/client';
import type { CaseKind } from './contract-generator';

/**
 * Por qué una corrida TERMINADA no recorrió el lote entero.
 *
 * `TIMEOUT`: agotó el tiempo máximo. `FIRST_FAILURE`: se pidió parar en el primer
 * contraejemplo y apareció. `null`: ejecutó todos los casos planificados.
 */
export type StoppedReason = 'TIMEOUT' | 'FIRST_FAILURE';

export interface RunSummaryReading {
  summary: Record<string, unknown> | null;
  stoppedReason: StoppedReason | null;
  executedCases: number | null;
}

export function readRunSummary(raw: Prisma.JsonValue | null | undefined): RunSummaryReading {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { summary: null, stoppedReason: null, executedCases: null };
  }
  const record = raw as Record<string, unknown>;
  const byProperty = record.byProperty;
  if (!byProperty || typeof byProperty !== 'object' || Array.isArray(byProperty)) {
    return { summary: record, stoppedReason: null, executedCases: null };
  }
  const reason = record.stoppedReason;
  const executed = record.executedCases;
  return {
    summary: byProperty as Record<string, unknown>,
    stoppedReason: reason === 'TIMEOUT' || reason === 'FIRST_FAILURE' ? reason : null,
    executedCases: typeof executed === 'number' && Number.isFinite(executed) ? executed : null,
  };
}

/**
 * La clase del caso que produjo un contraejemplo, leída de su `replayPath`
 * (`índice/CLASE[/mutación]`). Lo que no se reconoce se trata como VÁLIDO, que es lo que
 * son los casos por desenlace.
 */
export function parseReplayKind(replayPath: string | null | undefined): CaseKind {
  const kind = String(replayPath ?? '').split('/')[1];
  return kind === 'BOUNDARY' || kind === 'INVALID' ? kind : 'VALID';
}
