/**
 * Calibración: ¿el NIVEL de la probabilidad es correcto?
 *
 * Es distinta de la discriminación y se confunden a menudo. Un modelo puede ordenar perfectamente
 * —el decil 10 siempre peor que el 1— y estar descalibrado por un factor de tres. Mientras la
 * decisión sea sí/no con un corte, eso da igual. En cuanto la PD entra en el precio o en la
 * pérdida esperada, el error se convierte en dinero, y encima en dinero que cuadra: los informes
 * salen bien, sólo que describen otra cartera.
 *
 * Por eso una PD sin calibrar es PEOR que ninguna PD: sin ella nadie pone precio con un número
 * inventado; con ella, todos lo hacen.
 */
import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DomainException } from '../../common/errors/domain-exception';
import { parseBigIntId } from '../../common/http/id';
import { PrismaService } from '../../common/prisma/prisma.service';
import { calibration } from '../model-monitoring/discrimination';
import { discrimination } from '../model-monitoring/discrimination';
import { METRIC, thresholdOf, verdictFor } from '../model-monitoring/monitoring-thresholds';
import type { CalibrationRequestDto } from './risk-governance.dto';

/** Techo de filas por cálculo; el mismo criterio que el resto del monitoreo. */
const MAX_ROWS = 20_000;

interface SampleRow {
  output: Prisma.JsonValue | null;
  label: string;
}

@Injectable()
export class CalibrationService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Calcula la curva de calibración y la persiste, con su veredicto.
   *
   * Se guarda decil a decil y no sólo el estadístico agregado: el Hosmer-Lemeshow dice que el
   * ajuste es malo y no dónde. La curva enseña si el modelo se equivoca en la cola de riesgo alto
   * —donde se pierde dinero— o en la de riesgo bajo —donde se pierde negocio—, que son dos
   * problemas con dos remedios distintos.
   */
  async calibrate(tenantId: bigint, dto: CalibrationRequestDto) {
    const artifactVersionId = parseBigIntId(dto.artifactVersionId, 'artifactVersionId');
    await this.assertVersion(tenantId, artifactVersionId);

    const rows = await this.prisma.$queryRaw<SampleRow[]>`
      SELECT e."output_json" AS output, o."label"::text AS label
      FROM "decision_execution" e
      JOIN "decision_outcome_observation" o
        ON o."execution_id" = e."id" AND o."window_days" = ${dto.windowDays}
      WHERE e."tenant_id" = ${tenantId}
        AND e."artifact_version_id" = ${artifactVersionId}
        -- Sólo lo OBSERVADO. Un desenlace inferido calibra el modelo contra la población que ya
        -- se aprobó y lo hace parecer mejor de lo que es.
        AND o."inference_method" IS NULL
        AND o."label" IN ('GOOD', 'BAD')
      LIMIT ${MAX_ROWS}
    `;

    const samples = rows
      .map((row) => ({
        predicted: this.numberAt(row.output, dto.predictionField),
        bad: row.label === 'BAD',
      }))
      .filter((sample): sample is { predicted: number; bad: boolean } => sample.predicted !== null);

    const result = calibration(samples);
    const discriminationResult = discrimination(
      samples.map((sample) => ({ score: sample.predicted, bad: sample.bad })),
    );

    if (result.buckets.length) {
      await this.persist(tenantId, artifactVersionId, dto.windowDays, result.buckets);
      await this.persistVerdicts(tenantId, artifactVersionId, {
        hl: result.hosmerLemeshow,
        auc: discriminationResult.auc,
        ks: discriminationResult.ks,
        sampleSize: samples.length,
      });
    }

    return {
      artifactVersionId: dto.artifactVersionId,
      windowDays: dto.windowDays,
      predictionField: dto.predictionField,
      analyzed: samples.length,
      ...result,
      discrimination: discriminationResult,
    };
  }

  /** La última curva guardada de una versión, para pintarla sin recalcular. */
  async storedCurve(tenantId: bigint, artifactVersionId: string, windowDays: number) {
    const versionId = parseBigIntId(artifactVersionId, 'artifactVersionId');
    await this.assertVersion(tenantId, versionId);
    const buckets = await this.prisma.calibrationBucket.findMany({
      where: { tenantId, artifactVersionId: versionId, windowDays },
      orderBy: { decile: 'asc' },
    });
    return {
      artifactVersionId,
      windowDays,
      buckets: buckets.map((bucket) => ({
        decile: bucket.decile,
        predictedRate: Number(bucket.predictedRate),
        observedRate: Number(bucket.observedRate),
        sampleSize: bucket.sampleSize,
        computedAt: bucket.computedAt.toISOString(),
      })),
    };
  }

  private async persist(
    tenantId: bigint,
    artifactVersionId: bigint,
    windowDays: number,
    buckets: Array<{ decile: number; predictedRate: number; observedRate: number; sampleSize: number }>,
  ): Promise<void> {
    await this.prisma.$transaction(
      buckets.map((bucket) =>
        this.prisma.calibrationBucket.upsert({
          where: {
            artifactVersionId_windowDays_decile: {
              artifactVersionId,
              windowDays,
              decile: bucket.decile,
            },
          },
          create: {
            tenantId,
            artifactVersionId,
            windowDays,
            decile: bucket.decile,
            predictedRate: new Prisma.Decimal(bucket.predictedRate),
            observedRate: new Prisma.Decimal(bucket.observedRate),
            sampleSize: bucket.sampleSize,
          },
          update: {
            predictedRate: new Prisma.Decimal(bucket.predictedRate),
            observedRate: new Prisma.Decimal(bucket.observedRate),
            sampleSize: bucket.sampleSize,
            computedAt: new Date(),
          },
        }),
      ),
    );
  }

  /**
   * Deja las tres medidas en la serie de vigilancia.
   *
   * Se reutiliza `monitoring_evaluation` en vez de inventar otra tabla: así la calibración
   * aparece en el mismo semáforo que la estabilidad y el impacto adverso, y la métrica que vigila
   * a la vigilancia (`MONITORING_FRESHNESS_HOURS`) la cuenta también.
   */
  private async persistVerdicts(
    tenantId: bigint,
    artifactVersionId: bigint,
    input: { hl: number | null; auc: number | null; ks: number | null; sampleSize: number },
  ): Promise<void> {
    const entries: Array<{ metricCode: string; value: number }> = [];
    if (input.hl !== null) entries.push({ metricCode: METRIC.calibrationHl, value: input.hl });
    if (input.auc !== null) entries.push({ metricCode: METRIC.auc, value: input.auc });
    if (input.ks !== null) entries.push({ metricCode: METRIC.ks, value: input.ks });
    if (!entries.length) return;

    await this.prisma.monitoringEvaluation.createMany({
      data: entries.map((entry) => ({
        tenantId,
        artifactVersionId,
        metricCode: entry.metricCode,
        scope: '-',
        value: new Prisma.Decimal(entry.value),
        threshold: new Prisma.Decimal(thresholdOf(entry.metricCode)),
        verdict: verdictFor(entry.metricCode, entry.value, input.sampleSize),
        sampleSize: input.sampleSize,
      })),
    });
  }

  /** Lee un número del JSON de salida sin suponer su forma. */
  private numberAt(output: Prisma.JsonValue | null, field: string): number | null {
    if (!output || typeof output !== 'object' || Array.isArray(output)) return null;
    const value = (output as Record<string, unknown>)[field];
    const numeric = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }

  private async assertVersion(tenantId: bigint, artifactVersionId: bigint): Promise<void> {
    const version = await this.prisma.decisionArtifactVersion.findFirst({
      where: { id: artifactVersionId, artifact: { tenantId } },
      select: { id: true },
    });
    if (!version) {
      throw new DomainException('VERSION_NOT_FOUND', 'Artifact version not found', HttpStatus.NOT_FOUND);
    }
  }
}
