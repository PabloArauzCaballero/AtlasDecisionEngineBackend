import { Injectable } from '@nestjs/common';
import { ModelMonitoringMetrics } from '../../common/observability/model-monitoring-metrics';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  adverseImpactRatios,
  bucketOfSnapshot,
  isApproval,
  psiAgainstBaseline,
  summarizePerformance,
} from './monitoring-analytics';
import type { LiveVersion, Measurement } from './monitoring-measurement';
import { METRIC } from './monitoring-thresholds';

/** Techo de filas por analisis; el mismo criterio que el monitoreo bajo demanda. */
const MAX_ANALYSIS_ROWS = 20_000;
/** Ventana «actual» de la estabilidad: treinta dias es el horizonte con el que se decide hoy. */
const CURRENT_WINDOW_MS = 30 * 24 * 60 * 60 * 1_000;

/** Mediciones que salen de mirar las ejecuciones: estabilidad, desempeño e impacto adverso. */
@Injectable()
export class PopulationMeasurements {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: ModelMonitoringMetrics,
  ) {}

  /**
   * Le siguen llegando los mismos solicitantes? Una medicion por variable con linea base.
   *
   * Sin linea base no se mide y no se inventa una: una version promovida por primera vez no tiene
   * poblacion previa, y compararla contra sus propias primeras ejecuciones seria medir la deriva
   * contra si misma y dar cero siempre.
   */
  async stability(version: LiveVersion): Promise<Measurement[]> {
    const baselines = await this.prisma.monitoringBaseline.findMany({
      where: { tenantId: version.tenantId, artifactVersionId: version.artifactVersionId },
      select: { variableCode: true, bucketsJson: true },
    });
    if (!baselines.length) return [];

    const rows = await this.prisma.decisionExecution.findMany({
      where: {
        tenantId: version.tenantId,
        artifactVersionId: version.artifactVersionId,
        executedAt: { gte: new Date(Date.now() - CURRENT_WINDOW_MS) },
      },
      // Las MÁS RECIENTES: sin orden, Postgres devolvía las primeras que encontraba (las más
      // viejas) y la degradación reciente no entraba nunca en la muestra.
      orderBy: { executedAt: 'desc' },
      take: MAX_ANALYSIS_ROWS,
      select: { inputSnapshotJson: true },
    });
    if (!rows.length) return [];

    return baselines
      .map((baseline): Measurement | null => {
        const current = rows
          .map((row) => bucketOfSnapshot(row.inputSnapshotJson, baseline.variableCode))
          .filter((bucket): bucket is string => bucket !== null);
        if (!current.length) return null;
        const result = psiAgainstBaseline(baseline.bucketsJson as Record<string, number>, current);
        this.metrics.setModelPsi(
          version.artifactVersionId.toString(),
          baseline.variableCode,
          result.psi,
        );
        return {
          metricCode: METRIC.psi,
          scope: baseline.variableCode,
          value: result.psi,
          sampleSize: current.length,
          details: { verdict: result.verdict, topBuckets: result.buckets.slice(0, 3) },
        };
      })
      .filter((entry): entry is Measurement => entry !== null);
  }

  /** Sigue acertando? Tasa de malos sobre los aprobados con desenlace conocido. */
  async performance(version: LiveVersion): Promise<Measurement | null> {
    const rows = await this.prisma.decisionExecution.findMany({
      where: {
        tenantId: version.tenantId,
        artifactVersionId: version.artifactVersionId,
        outcomeObservations: { some: {} },
      },
      // Las MÁS RECIENTES: sin orden, Postgres devolvía las primeras que encontraba (las más
      // viejas) y la degradación reciente no entraba nunca en la muestra.
      orderBy: { executedAt: 'desc' },
      take: MAX_ANALYSIS_ROWS,
      select: {
        businessOutcome: true,
        outcomeObservations: { orderBy: { windowDays: 'desc' }, take: 1 },
      },
    });
    if (!rows.length) return null;

    const summary = summarizePerformance(
      rows.map((row) => ({
        outcome: row.businessOutcome,
        label: row.outcomeObservations[0].label,
      })),
    );
    if (summary.badRate === null) return null;
    this.metrics.setModelBadRate(version.artifactVersionId.toString(), summary.badRate);
    return {
      metricCode: METRIC.badRate,
      scope: '-',
      value: summary.badRate,
      sampleSize: summary.conclusive,
      details: { approved: summary.approved, declined: summary.declined },
    };
  }

  /**
   * Trata igual a grupos comparables? Una medicion por grupo de cada atributo bajo examen.
   *
   * Los atributos NO se enumeran en configuracion: se descubren de lo que quien audita haya
   * cargado. Una lista fija en el codigo haria que un atributo nuevo -el que alguien anade
   * justamente porque sospecha algo- no se midiera hasta que un desarrollador lo anadiese.
   */
  async adverseImpact(version: LiveVersion): Promise<Measurement[]> {
    const attributes = await this.prisma.decisionMonitoringAttribute.findMany({
      where: {
        tenantId: version.tenantId,
        execution: { artifactVersionId: version.artifactVersionId },
      },
      distinct: ['attribute'],
      select: { attribute: true },
    });
    if (!attributes.length) return [];

    const measurements: Measurement[] = [];
    for (const { attribute } of attributes) {
      const rows = await this.prisma.decisionExecution.findMany({
        where: {
          tenantId: version.tenantId,
          artifactVersionId: version.artifactVersionId,
          monitoringAttributes: { some: { attribute } },
        },
        // Las MÁS RECIENTES: sin orden, Postgres devolvía las primeras que encontraba (las más
        // viejas) y la degradación reciente no entraba nunca en la muestra.
        orderBy: { executedAt: 'desc' },
        take: MAX_ANALYSIS_ROWS,
        select: {
          businessOutcome: true,
          monitoringAttributes: { where: { attribute }, take: 1 },
        },
      });
      if (!rows.length) continue;

      const result = adverseImpactRatios(
        attribute,
        rows.map((row) => ({
          group: row.monitoringAttributes[0].groupValue,
          approved: isApproval(row.businessOutcome),
        })),
      );
      for (const group of result.groups) {
        this.metrics.setAdverseImpactRatio(
          version.artifactVersionId.toString(),
          attribute,
          group.group,
          group.impactRatio,
        );
        measurements.push({
          metricCode: METRIC.adverseImpactRatio,
          // Atributo Y grupo: el ratio del grupo de referencia es 1 por construccion y no dice
          // nada; el que importa es el de cada grupo comparado con el.
          scope: attribute + ':' + group.group,
          value: group.impactRatio,
          sampleSize: group.total,
          details: { approvalRate: group.approvalRate, reference: result.referenceGroup },
        });
      }
    }
    return measurements;
  }
}
