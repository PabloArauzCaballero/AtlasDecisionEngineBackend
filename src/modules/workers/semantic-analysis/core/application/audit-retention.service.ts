import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  AUDIT_RETENTION_REPOSITORY,
  AuditRetentionRepository,
  RetentionOutcome,
  SEMANTIC_WORKER_CONFIG,
} from './ports';
import { SemanticWorkerConfig } from '../config/semantic-worker.config';

@Injectable()
export class AuditRetentionService {
  private readonly logger = new Logger(AuditRetentionService.name);

  public constructor(
    @Inject(AUDIT_RETENTION_REPOSITORY)
    private readonly repository: AuditRetentionRepository,
    @Inject(SEMANTIC_WORKER_CONFIG)
    private readonly config: SemanticWorkerConfig,
  ) {}

  /**
   * Aplica minimización y purga en ese orden.
   *
   * El orden importa: minimizar primero deja el texto fuera de la base cuanto antes, y purgar
   * después elimina filas que ya no contienen contenido sensible. Al revés, una purga lenta
   * mantendría texto íntegro más tiempo del debido.
   */
  public async apply(): Promise<RetentionOutcome> {
    const minimized = await this.repository.minimizeOlderThan(this.config.auditMinimizeAfterDays);
    const deleted = await this.repository.purgeOlderThan(this.config.auditRetentionDays);

    if (minimized > 0 || deleted > 0) {
      this.logger.log(
        `Retención aplicada: ${String(minimized)} decisiones minimizadas, ${String(deleted)} purgadas.`,
      );
    }
    return { deleted, minimized };
  }

  public get isEnabled(): boolean {
    return this.config.auditRetentionDays > 0 || this.config.auditMinimizeAfterDays > 0;
  }
}
