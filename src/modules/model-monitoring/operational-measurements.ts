import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { consultaCrudaConTenant } from '../../common/prisma/tenant-scoped-raw';
import type { LiveVersion, Measurement } from './monitoring-measurement';
import { METRIC } from './monitoring-thresholds';

interface CoverageRow {
  due: bigint;
  observed: bigint;
}

interface LastEvaluationRow {
  hours: number | null;
}

/** Mediciones que salen de las tablas operativas: cobertura de desenlace y frescura de la vigilancia. */
@Injectable()
export class OperationalMeasurements {
  constructor(private readonly prisma: PrismaService) {}

  /**   * Cobertura de desenlace de esta versión: ventanas vencidas que alguien cerró.
   *
   * Se evalúa por versión y no sólo globalmente porque el fallo real es parcial: un integrador
   * deja de reportar los créditos de UN producto y la cifra global apenas se mueve.
   */
  async outcomeCoverage(version: LiveVersion): Promise<Measurement | null> {
    const [row] = await consultaCrudaConTenant(
      this.prisma,
      (tx) => tx.$queryRaw<CoverageRow[]>`
      SELECT
        COUNT(*)::bigint                                            AS due,
        COUNT(*) FILTER (WHERE w."observed_at" IS NOT NULL)::bigint AS observed
      FROM "outcome_window_schedule" w
      JOIN "decision_execution" e ON e."id" = w."execution_id"
      WHERE w."tenant_id" = ${version.tenantId}
        AND e."artifact_version_id" = ${version.artifactVersionId}
        AND w."due_at" <= now()
    `,
    );
    const due = Number(row?.due ?? 0);
    if (due === 0) return null;
    return {
      metricCode: METRIC.outcomeCoverage,
      scope: '-',
      value: Number(row.observed) / due,
      sampleSize: due,
      details: { due, observed: Number(row.observed) },
    };
  }

  /**
   * Cuántas horas lleva sin evaluarse esta versión.
   *
   * Se emite SIEMPRE, incluso cuando no hay ninguna otra medición posible, y ese es el punto: es
   * la única fila que puede aparecer en una versión sin datos, y su ausencia sería exactamente el
   * silencio que hay que romper. La primera vez sale 0 h, porque acaba de evaluarse — el valor no
   * dice «hace cuánto se midió algo» sino «hace cuánto dejó de mirarse».
   */
  async monitoringFreshness(version: LiveVersion): Promise<Measurement> {
    const [row] = await consultaCrudaConTenant(
      this.prisma,
      (tx) => tx.$queryRaw<LastEvaluationRow[]>`
      SELECT EXTRACT(EPOCH FROM (now() - MAX("evaluated_at"))) / 3600 AS hours
      FROM "monitoring_evaluation"
      WHERE "tenant_id" = ${version.tenantId}
        AND "artifact_version_id" = ${version.artifactVersionId}
        AND "metric_code" <> ${METRIC.monitoringFreshness}
    `,
    );
    const hours = row?.hours === null || row?.hours === undefined ? 0 : Number(row.hours);
    return {
      metricCode: METRIC.monitoringFreshness,
      scope: '-',
      value: hours,
      sampleSize: 1,
      details: { hoursSinceLastMeasurement: hours },
    };
  }
}
