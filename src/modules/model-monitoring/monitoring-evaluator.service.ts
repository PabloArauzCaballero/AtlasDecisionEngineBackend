/**
 * La vigilancia deja de depender de que alguien pregunte.
 *
 * El motor sabía CALCULAR estabilidad, desempeño e impacto adverso desde `20260808140000`. Los
 * calculaba cuando alguien mandaba un POST, y nadie lo mandaba nunca: un cálculo bajo demanda que
 * nadie pide es un cálculo que no ocurre. Este trabajo lo hace solo, guarda cada medición con su
 * umbral y su veredicto, y emite el aviso cuando algo se sale.
 *
 * Y hace una cosa más, que es la que cierra el círculo: **se vigila a sí mismo**. Si la última
 * evaluación de una versión en producción tiene más de 48 h, eso es un `BREACH` por derecho
 * propio. Sin esa métrica, una vigilancia detenida deja el tablero en verde enseñando la última
 * foto buena, que es indistinguible de que todo vaya bien.
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MonitoringVerdict, Prisma } from '@prisma/client';
import { runsBackgroundJobs, workerRoleOf } from '../../common/config/worker-role';
import { BackgroundJob } from '../../common/jobs/background-job';
import { JobName } from '../../common/jobs/job-names';
import { JobSchedulerService } from '../../common/jobs/job-scheduler.service';
import { MetricsService } from '../../common/observability/metrics.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OutboxPublisherService } from '../../common/events/outbox-publisher.service';
import {
  adverseImpactRatios,
  bucketOfSnapshot,
  isApproval,
  psiAgainstBaseline,
  summarizePerformance,
} from './monitoring-analytics';
import { METRIC, thresholdOf, verdictFor } from './monitoring-thresholds';

/** Una versión desplegada en producción, que es lo único que se vigila. */
interface LiveVersion {
  tenantId: bigint;
  artifactVersionId: bigint;
  artifactCode: string;
}

interface CoverageRow {
  due: bigint;
  observed: bigint;
}

/** Techo de filas por analisis; el mismo criterio que el monitoreo bajo demanda. */
const MAX_ANALYSIS_ROWS = 20_000;
/** Ventana «actual» de la estabilidad: treinta dias es el horizonte con el que se decide hoy. */
const CURRENT_WINDOW_MS = 30 * 24 * 60 * 60 * 1_000;

interface LastEvaluationRow {
  hours: number | null;
}

@Injectable()
export class MonitoringEvaluatorService implements OnModuleInit, BackgroundJob {
  private readonly logger = new Logger(MonitoringEvaluatorService.name);
  private readonly enabled: boolean;
  private readonly role: string;

  readonly name = JobName.MonitoringEvaluation;
  /** Nadie lo hace urgente: sólo pasa el tiempo, como la purga de retención. */
  readonly wakeChannel = null;
  readonly minIdleIntervalMs: number;
  readonly maxIdleIntervalMs: number;
  readonly initialDelayMs: number;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
    private readonly scheduler: JobSchedulerService,
    private readonly outbox: OutboxPublisherService,
    private readonly metrics: MetricsService,
  ) {
    this.role = workerRoleOf(config);
    this.enabled =
      runsBackgroundJobs(config) && (config.get<boolean>('MONITORING_EVALUATION_ENABLED') ?? true);
    const intervalMs = config.get<number>('MONITORING_EVALUATION_INTERVAL_MS') ?? 21_600_000;
    this.minIdleIntervalMs = intervalMs;
    this.maxIdleIntervalMs = intervalMs;
    // Dos minutos de retraso inicial: el arranque tiene cosas más urgentes que hacer.
    this.initialDelayMs = Math.min(intervalMs, 120_000);
  }

  onModuleInit(): void {
    if (!this.enabled) {
      this.logger.log(`Monitoring evaluation not started (WORKER_ROLE=${this.role})`);
      return;
    }
    this.scheduler.register(this);
  }

  /**
   * Un ciclo: evalúa todas las versiones vivas.
   *
   * Devuelve 0 siempre, a diferencia de la purga: no hay backlog que drenar lote a lote, y
   * devolver `>0` haría que el orquestador encadenara ciclos, reevaluando lo mismo en bucle.
   */
  async runOnce(): Promise<number> {
    await this.evaluateAll();
    return 0;
  }

  async evaluateAll(): Promise<number> {
    let written = 0;
    for (const version of await this.liveVersions()) {
      try {
        written += await this.evaluateVersion(version);
      } catch (error) {
        // Una versión que falla no puede impedir que se evalúen las demás: si la que rompe es
        // justo la de un tenant con datos raros, callar a las otras veinte sería el peor
        // resultado posible para un mecanismo cuya única función es avisar.
        this.logger.error(
          `Monitoring evaluation failed for version ${version.artifactVersionId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    return written;
  }

  /**
   * Versiones con despliegue activo en un ambiente de producción.
   *
   * Sólo producción: vigilar una versión de sandbox produciría alarmas por poblaciones de prueba
   * y enseñaría a quien las lee a ignorarlas.
   */
  private async liveVersions(): Promise<LiveVersion[]> {
    const rows = await this.prisma.decisionDeployment.findMany({
      where: {
        isActive: true,
        deploymentStatus: 'ACTIVE',
        environment: { isProduction: true },
      },
      select: {
        artifactVersionId: true,
        // El tenant NO cuelga del despliegue: llega por el artefacto. Leerlo de aquí y no de
        // una columna propia es lo que garantiza que coincida con el dueño del artefacto.
        artifactVersion: {
          select: { artifact: { select: { tenantId: true, artifactCode: true } } },
        },
      },
    });
    return rows.map((row) => ({
      tenantId: row.artifactVersion.artifact.tenantId,
      artifactVersionId: row.artifactVersionId,
      artifactCode: row.artifactVersion.artifact.artifactCode,
    }));
  }

  private async evaluateVersion(version: LiveVersion): Promise<number> {
    /*
     * El ORDEN importa: `monitoringFreshness` va la ULTIMA porque mide cuanto hace que se midio
     * cualquier otra cosa. Puesta antes, se leeria a si misma como «recien medido» y declararia
     * fresca una vigilancia que lleva un mes parada.
     */
    const measurements = [
      ...(await this.stability(version)),
      await this.performance(version),
      ...(await this.adverseImpact(version)),
      await this.outcomeCoverage(version),
      await this.monitoringFreshness(version),
    ].filter((entry): entry is Measurement => entry !== null);

    for (const measurement of measurements) {
      await this.persist(version, measurement);
    }
    return measurements.length;
  }

  /**
   * Le siguen llegando los mismos solicitantes? Una medicion por variable con linea base.
   *
   * Sin linea base no se mide y no se inventa una: una version promovida por primera vez no tiene
   * poblacion previa, y compararla contra sus propias primeras ejecuciones seria medir la deriva
   * contra si misma y dar cero siempre.
   */
  private async stability(version: LiveVersion): Promise<Measurement[]> {
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
  private async performance(version: LiveVersion): Promise<Measurement | null> {
    const rows = await this.prisma.decisionExecution.findMany({
      where: {
        tenantId: version.tenantId,
        artifactVersionId: version.artifactVersionId,
        outcomeObservations: { some: {} },
      },
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
  private async adverseImpact(version: LiveVersion): Promise<Measurement[]> {
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

  /**   * Cobertura de desenlace de esta versión: ventanas vencidas que alguien cerró.
   *
   * Se evalúa por versión y no sólo globalmente porque el fallo real es parcial: un integrador
   * deja de reportar los créditos de UN producto y la cifra global apenas se mueve.
   */
  private async outcomeCoverage(version: LiveVersion): Promise<Measurement | null> {
    const [row] = await this.prisma.$queryRaw<CoverageRow[]>`
      SELECT
        COUNT(*)::bigint                                            AS due,
        COUNT(*) FILTER (WHERE w."observed_at" IS NOT NULL)::bigint AS observed
      FROM "outcome_window_schedule" w
      JOIN "decision_execution" e ON e."id" = w."execution_id"
      WHERE w."tenant_id" = ${version.tenantId}
        AND e."artifact_version_id" = ${version.artifactVersionId}
        AND w."due_at" <= now()
    `;
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
  private async monitoringFreshness(version: LiveVersion): Promise<Measurement> {
    const [row] = await this.prisma.$queryRaw<LastEvaluationRow[]>`
      SELECT EXTRACT(EPOCH FROM (now() - MAX("evaluated_at"))) / 3600 AS hours
      FROM "monitoring_evaluation"
      WHERE "tenant_id" = ${version.tenantId}
        AND "artifact_version_id" = ${version.artifactVersionId}
        AND "metric_code" <> ${METRIC.monitoringFreshness}
    `;
    const hours = row?.hours === null || row?.hours === undefined ? 0 : Number(row.hours);
    return {
      metricCode: METRIC.monitoringFreshness,
      scope: '-',
      value: hours,
      sampleSize: 1,
      details: { hoursSinceLastMeasurement: hours },
    };
  }

  /**
   * Guarda la medición y avisa si es un `BREACH`.
   *
   * El aviso va por el outbox transaccional que ya alimenta `Notification`, no por una tubería
   * nueva: un canal de avisos propio sería otra cosa que puede callarse sin que nadie lo note.
   */
  private async persist(version: LiveVersion, measurement: Measurement): Promise<void> {
    const verdict = verdictFor(measurement.metricCode, measurement.value, measurement.sampleSize);
    await this.prisma.$transaction(async (tx) => {
      await tx.monitoringEvaluation.create({
        data: {
          tenantId: version.tenantId,
          artifactVersionId: version.artifactVersionId,
          metricCode: measurement.metricCode,
          scope: measurement.scope,
          value: new Prisma.Decimal(measurement.value),
          threshold: new Prisma.Decimal(thresholdOf(measurement.metricCode)),
          verdict,
          sampleSize: measurement.sampleSize,
          detailsJson: measurement.details as Prisma.InputJsonValue,
        },
      });
      if (verdict === MonitoringVerdict.BREACH) {
        await this.outbox.publish(tx, {
          tenantId: version.tenantId,
          eventType: 'MONITORING_BREACH_DETECTED',
          aggregateType: 'MonitoringEvaluation',
          aggregateId: version.artifactVersionId.toString(),
          // El actor es el propio trabajo. Poner aquí un usuario sería mentir sobre quién lo
          // detectó, y el valor de este aviso es justamente que no lo detectó nadie.
          actorId: JobName.MonitoringEvaluation,
          payload: {
            artifactCode: version.artifactCode,
            metricCode: measurement.metricCode,
            scope: measurement.scope,
            value: measurement.value,
            threshold: thresholdOf(measurement.metricCode),
            sampleSize: measurement.sampleSize,
          },
        });
      }
    });
  }
}

interface Measurement {
  metricCode: string;
  scope: string;
  value: number;
  sampleSize: number;
  details: Record<string, unknown>;
}
