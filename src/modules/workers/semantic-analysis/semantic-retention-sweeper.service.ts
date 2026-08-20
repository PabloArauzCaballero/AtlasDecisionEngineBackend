import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { runsBackgroundJobs, workerRoleOf } from '../../../common/config/worker-role';
import { BackgroundJob } from '../../../common/jobs/background-job';
import { JobName } from '../../../common/jobs/job-names';
import { JobSchedulerService } from '../../../common/jobs/job-scheduler.service';
import { AuditRetentionService } from './core/application/audit-retention.service';

/**
 * Aplica la retención del texto analizado por el worker semántico.
 *
 * El núcleo absorbido ya traía la política completa —minimizar primero,
 * purgar después— en `AuditRetentionService`, con sus dos plazos configurables.
 * Lo que no traía era **quién la dispara**: en el paquete original la invocaba
 * su propio planificador, que se descartó junto con pg-boss. Sin este trabajo,
 * `SEMANTIC_ANALYSIS_MINIMIZE_AFTER_DAYS` y `SEMANTIC_ANALYSIS_AUDIT_RETENTION_DAYS`
 * quedaban como configuración que no gobierna nada y `input_text` se conservaba
 * indefinidamente — justo lo que la política existía para evitar.
 *
 * Es puramente periódico (`wakeChannel: null`): nada lo hace urgente salvo el
 * paso del tiempo. Se registra aunque el worker de análisis esté apagado, porque
 * un despliegue que deja de clasificar sigue teniendo texto retenido de antes y
 * ese texto debe seguir venciendo.
 */
@Injectable()
export class SemanticRetentionSweeperService implements OnModuleInit, BackgroundJob {
  private readonly logger = new Logger(SemanticRetentionSweeperService.name);
  private readonly role: string;
  private readonly enabled: boolean;

  readonly name = JobName.SemanticRetention;
  readonly wakeChannel = null;
  readonly minIdleIntervalMs: number;
  readonly maxIdleIntervalMs: number;
  readonly initialDelayMs: number;

  constructor(
    config: ConfigService,
    private readonly scheduler: JobSchedulerService,
    private readonly retention: AuditRetentionService,
  ) {
    this.role = workerRoleOf(config);
    this.enabled = runsBackgroundJobs(config);
    const intervalMs =
      config.get<number>('SEMANTIC_ANALYSIS_RETENTION_SWEEP_INTERVAL_MS') ?? 3_600_000;
    // Cadencia fija: una purga no gana nada con el retroceso adaptativo, que
    // existe para trabajos que drenan una cola.
    this.minIdleIntervalMs = intervalMs;
    this.maxIdleIntervalMs = intervalMs;
    this.initialDelayMs = Math.min(intervalMs, 60_000);
  }

  onModuleInit(): void {
    if (!this.enabled) {
      this.logger.log(`Barrida de retención semántica no arrancada: WORKER_ROLE=${this.role}`);
      return;
    }
    // Ambos plazos a cero significa «no retener nada por tiempo», que es una
    // decisión válida: registrarse igualmente haría una consulta por hora para
    // no borrar nunca nada.
    if (!this.retention.isEnabled) {
      this.logger.log('Barrida de retención semántica deshabilitada: ambos plazos son 0');
      return;
    }
    this.scheduler.register(this);
  }

  /**
   * Una pasada. Devuelve cuántas filas tocó para que el orquestador encadene
   * otra si quedaba trabajo.
   *
   * Un fallo es benigno en términos operativos —las mismas filas vencen igual en
   * la pasada siguiente—, así que se registra y se devuelve `0`: propagarlo
   * tumbaría el orquestador por una purga que puede esperar una hora.
   */
  async runOnce(): Promise<number> {
    try {
      const { minimized, deleted } = await this.retention.apply();
      return minimized + deleted;
    } catch (error) {
      this.logger.error(
        `Barrida de retención semántica fallida: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 0;
    }
  }
}
