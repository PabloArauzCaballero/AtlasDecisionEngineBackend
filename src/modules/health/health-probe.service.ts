import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CacheService } from '../../common/cache/cache.service';
import { JobSchedulerService } from '../../common/jobs/job-scheduler.service';
import { JobSignalService } from '../../common/jobs/job-signal.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { runsBackgroundJobs, workerRoleOf } from '../../common/config/worker-role';

export interface LivenessReport {
  status: 'ok';
  service: string;
  role: string;
  version: string;
  commit: string;
  uptimeSeconds: number;
  timestamp: string;
}

export interface ReadinessReport {
  ready: boolean;
  checks: Record<string, string>;
  timestamp: string;
}

/**
 * Sondas de vida y disponibilidad, fuera del controlador.
 *
 * Viven aquí porque el proceso `WORKER` no expone controladores de Nest —no sirve tráfico
 * de negocio— pero el orquestador necesita exactamente las mismas comprobaciones para
 * decidir si reiniciarlo o si sacarlo de rotación. Reimplementarlas en el arranque del
 * worker habría producido dos definiciones de «listo» que se separan con el tiempo, que es
 * la clase de divergencia que hace que una sonda mienta justo durante un incidente.
 */
@Injectable()
export class HealthProbeService {
  private readonly startedAt = Date.now();
  private readonly logger = new Logger(HealthProbeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly config: ConfigService,
    private readonly scheduler: JobSchedulerService,
    private readonly jobSignal: JobSignalService,
  ) {}

  live(): LivenessReport {
    return {
      status: 'ok',
      service: 'atlas-decision-engine-backend',
      role: workerRoleOf(this.config),
      version: this.config.get<string>('BUILD_VERSION') ?? 'unknown',
      commit: this.config.get<string>('COMMIT_SHA') ?? 'unknown',
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1_000),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Nunca lanza: devuelve el veredicto y los nombres de las comprobaciones. El detalle real
   * del fallo se registra en el servidor y jamás sale en la respuesta, porque `/health/ready`
   * es público y el texto crudo de un driver revela host, puerto y versión.
   */
  async ready(): Promise<ReadinessReport> {
    const checks: Record<string, string> = {};
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.database = 'ok';
      checks.cache = await this.cache.ping();
      if (runsBackgroundJobs(this.config)) {
        // Informativo, nunca causa de «no listo»: perder la escucha degrada la latencia de
        // los trabajos al intervalo de sondeo, pero el proceso sigue procesando. Sacar de
        // rotación un worker sano por esto sería peor que el problema que reporta.
        checks.jobs = this.scheduler.registeredJobs().join(',') || 'none';
        checks.jobSignal = !this.jobSignal.enabled
          ? 'disabled'
          : this.jobSignal.connected
            ? 'listening'
            : 'polling';
      }
      return { ready: true, checks, timestamp: new Date().toISOString() };
    } catch (error) {
      checks.database ??= 'error';
      checks.cache ??= 'error';
      this.logger.error(
        `Readiness check failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { ready: false, checks, timestamp: new Date().toISOString() };
    }
  }
}
