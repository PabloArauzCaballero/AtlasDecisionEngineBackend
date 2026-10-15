import type { Prisma, QaRunStatus } from '@prisma/client';
import { fakersOf, plannedCasesOf } from './qa-run-config';
import { readRunSummary } from './qa-run-summary';

/** La forma pública de una corrida (`run` 202 y `getRun` 200), con sus contraejemplos. */
export function presentRun(
  run: {
    id: bigint;
    artifactVersionId: bigint;
    environmentCode: string;
    status: QaRunStatus;
    seed: string;
    generatorVersion: string;
    toolingJson: Prisma.JsonValue;
    totalCases: number;
    passedCases: number;
    failedCases: number;
    erroredCases: number;
    durationMs: number;
    configJson: Prisma.JsonValue;
    summaryJson: Prisma.JsonValue;
    startedAt: Date;
    finishedAt: Date | null;
  },
  counterexamples: Array<Record<string, unknown>>,
) {
  return {
    id: run.id.toString(),
    artifactVersionId: run.artifactVersionId.toString(),
    environmentCode: run.environmentCode,
    status: run.status,
    seed: run.seed,
    generatorVersion: run.generatorVersion,
    tooling: run.toolingJson,
    totalCases: run.totalCases,
    passedCases: run.passedCases,
    failedCases: run.failedCases,
    erroredCases: run.erroredCases,
    durationMs: run.durationMs,
    // Cuántos casos se van a ejecutar en total. Sale de la configuración archivada y se
    // publica aparte porque es lo único con lo que se puede dibujar un avance: mientras
    // la corrida vive, `totalCases` sólo cuenta los ya ejecutados, y un número que sube
    // sin un techo al lado no dice si falta un segundo o cinco minutos.
    plannedCases: plannedCasesOf(run.configJson),
    // Conteo por propiedad, con la misma forma de siempre; en una corrida FALLIDA,
    // `{ failureCode, failureMessage }`.
    summary: readRunSummary(run.summaryJson).summary,
    stoppedReason: readRunSummary(run.summaryJson).stoppedReason,
    executedCases: readRunSummary(run.summaryJson).executedCases ?? run.totalCases,
    fakers: fakersOf(run.configJson),
    // La configuración ARCHIVADA completa: es lo que el portal devuelve al formulario para
    // reproducir la corrida. La semilla sola no basta: el lote depende también del número
    // de casos, la mezcla, los pesos, las distribuciones y los casos por desenlace.
    config: run.configJson,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    counterexamples,
  };
}
