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
import { runsBackgroundJobs, workerRoleOf } from '../../common/config/worker-role';
import { BackgroundJob } from '../../common/jobs/background-job';
import { JobName } from '../../common/jobs/job-names';
import { JobSchedulerService } from '../../common/jobs/job-scheduler.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { LiveVersion, Measurement } from './monitoring-measurement';
import { MonitoringEvaluationWriter } from './monitoring-evaluation-writer';
import { OperationalMeasurements } from './operational-measurements';
import { PopulationMeasurements } from './population-measurements';

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
    private readonly population: PopulationMeasurements,
    private readonly operational: OperationalMeasurements,
    private readonly writer: MonitoringEvaluationWriter,
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
      ...(await this.population.stability(version)),
      await this.population.performance(version),
      ...(await this.population.adverseImpact(version)),
      await this.operational.outcomeCoverage(version),
      await this.operational.monitoringFreshness(version),
    ].filter((entry): entry is Measurement => entry !== null);

    for (const measurement of measurements) {
      await this.writer.persist(version, measurement);
    }
    return measurements.length;
  }
}
