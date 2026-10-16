import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DomainException } from '../../common/errors/domain-exception';
import { parseBigIntId } from '../../common/http/id';
import { ModelMonitoringMetrics } from '../../common/observability/model-monitoring-metrics';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  adverseImpactRatios,
  bucketOfSnapshot,
  isApproval,
  populationStabilityIndex,
  summarizePerformance,
  type GroupOutcome,
  type ObservedDecision,
} from './monitoring-analytics';
import {
  AdverseImpactQueryDto,
  MonitoringWindowQueryDto,
  StabilityQueryDto,
} from './model-monitoring.dto';

/** Techo de ejecuciones por análisis; ver la nota en `executionsIn`. */
const MAX_ANALYSIS_ROWS = 20_000;

@Injectable()
export class ModelMonitoringQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: ModelMonitoringMetrics,
  ) {}

  /** ¿El modelo sigue acertando? */
  async performance(tenantId: bigint, query: MonitoringWindowQueryDto) {
    const artifactVersionId = parseBigIntId(query.artifactVersionId, 'artifactVersionId');
    await this.assertVersionBelongsToTenant(tenantId, artifactVersionId);

    const rows = await this.prisma.decisionExecution.findMany({
      where: {
        tenantId,
        artifactVersionId,
        ...this.executedAtFilter(query),
        // Solo lo observado: una ejecución sin desenlace no dice nada del desempeño.
        outcomeObservations: { some: {} },
      },
      // Las MÁS RECIENTES: sin orden, Postgres devolvía las primeras que encontraba (las más
      // viejas) y la degradación reciente no entraba nunca en la muestra.
      orderBy: { executedAt: 'desc' },
      take: MAX_ANALYSIS_ROWS,
      select: {
        businessOutcome: true,
        outputJson: true,
        outcomeObservations: { orderBy: { windowDays: 'desc' }, take: 1 },
      },
    });

    const decisions: ObservedDecision[] = rows.map((row) => ({
      outcome: row.businessOutcome,
      label: row.outcomeObservations[0].label,
      score: this.scoreOf(row.outputJson),
    }));
    const summary = summarizePerformance(decisions);
    if (summary.badRate !== null) {
      this.metrics.setModelBadRate(query.artifactVersionId, summary.badRate);
    }
    return { artifactVersionId: query.artifactVersionId, ...summary };
  }

  /** ¿Le siguen llegando los mismos solicitantes? */
  async stability(tenantId: bigint, query: StabilityQueryDto) {
    const artifactVersionId = parseBigIntId(query.artifactVersionId, 'artifactVersionId');
    await this.assertVersionBelongsToTenant(tenantId, artifactVersionId);

    const bucketsOf = async (from: Date, to: Date) => {
      const rows = await this.prisma.decisionExecution.findMany({
        where: { tenantId, artifactVersionId, executedAt: { gte: from, lte: to } },
        // Las MÁS RECIENTES: sin orden, Postgres devolvía las primeras que encontraba (las más
        // viejas) y la degradación reciente no entraba nunca en la muestra.
        orderBy: { executedAt: 'desc' },
        take: MAX_ANALYSIS_ROWS,
        select: { inputSnapshotJson: true },
      });
      return rows
        .map((row) => this.bucketOf(row.inputSnapshotJson, query.variableCode))
        .filter((bucket): bucket is string => bucket !== null);
    };

    const reference = await bucketsOf(new Date(query.referenceFrom), new Date(query.referenceTo));
    const current = await bucketsOf(
      query.from ? new Date(query.from) : new Date(query.referenceTo),
      query.to ? new Date(query.to) : new Date(),
    );
    const result = populationStabilityIndex(reference, current);
    this.metrics.setModelPsi(query.artifactVersionId, query.variableCode, result.psi);
    return {
      artifactVersionId: query.artifactVersionId,
      variableCode: query.variableCode,
      ...result,
    };
  }

  /** ¿Trata igual a grupos comparables? */
  async adverseImpact(tenantId: bigint, query: AdverseImpactQueryDto) {
    const artifactVersionId = parseBigIntId(query.artifactVersionId, 'artifactVersionId');
    await this.assertVersionBelongsToTenant(tenantId, artifactVersionId);

    const rows = await this.prisma.decisionExecution.findMany({
      where: {
        tenantId,
        artifactVersionId,
        ...this.executedAtFilter(query),
        monitoringAttributes: { some: { attribute: query.attribute } },
      },
      // Las MÁS RECIENTES: sin orden, Postgres devolvía las primeras que encontraba (las más
      // viejas) y la degradación reciente no entraba nunca en la muestra.
      orderBy: { executedAt: 'desc' },
      take: MAX_ANALYSIS_ROWS,
      select: {
        businessOutcome: true,
        monitoringAttributes: { where: { attribute: query.attribute }, take: 1 },
      },
    });

    const outcomes: GroupOutcome[] = rows.map((row) => ({
      group: row.monitoringAttributes[0].groupValue,
      approved: isApproval(row.businessOutcome),
    }));
    const result = adverseImpactRatios(query.attribute, outcomes);
    for (const group of result.groups) {
      this.metrics.setAdverseImpactRatio(
        query.artifactVersionId,
        query.attribute,
        group.group,
        group.impactRatio,
      );
    }
    return { artifactVersionId: query.artifactVersionId, analyzed: outcomes.length, ...result };
  }

  // ---------------------------------------------------------------------------

  private async assertVersionBelongsToTenant(
    tenantId: bigint,
    artifactVersionId: bigint,
  ): Promise<void> {
    const version = await this.prisma.decisionArtifactVersion.findFirst({
      where: { id: artifactVersionId, artifact: { tenantId } },
      select: { id: true },
    });
    if (!version) {
      throw new DomainException(
        'VERSION_NOT_FOUND',
        'Artifact version not found',
        HttpStatus.NOT_FOUND,
      );
    }
  }

  private executedAtFilter(query: MonitoringWindowQueryDto) {
    if (!query.from && !query.to) return {};
    return {
      executedAt: {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      },
    };
  }

  /** Puntaje publicado por la decisión, cuando el artefacto lo produce. */
  private scoreOf(output: Prisma.JsonValue | null): number | null {
    if (!output || typeof output !== 'object' || Array.isArray(output)) return null;
    const score = (output as Record<string, unknown>).score;
    return typeof score === 'number' && Number.isFinite(score) ? score : null;
  }

  /**
   * Categoría de una variable en una ejecución, para el índice de estabilidad.
   *
   * Delega en `bucketOfSnapshot`, que es la ÚNICA definición. Tenerla duplicada aquí y en la
   * captura de la línea base era una bomba de relojería: en cuanto las dos se separasen, el
   * índice compararía dos alfabetos distintos y saldría altísimo siempre.
   */
  private bucketOf(snapshot: Prisma.JsonValue | null, variableCode: string): string | null {
    return bucketOfSnapshot(snapshot, variableCode);
  }
}
