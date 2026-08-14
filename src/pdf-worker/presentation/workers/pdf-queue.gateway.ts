/**
 * Puerta de entrada al modo asíncrono y consumidor de la cola (§17).
 *
 * El consumidor llama al MISMO `GeneratePdfUseCase` que el controlador síncrono. Ésa es toda la
 * gracia del diseño: no hay una ruta «rápida» y otra «de fondo» que puedan desviarse; hay un
 * caso de uso y dos maneras de invocarlo.
 *
 * Con `PDF_QUEUE_ENABLED=false` el módulo no registra la cola, y `enqueue` responde 503 en vez
 * de aceptar trabajos que nadie va a procesar. Un 202 sobre una cola sin consumidor es la peor
 * respuesta posible: el llamante se queda esperando un evento que no llegará nunca.
 */
import {
  Inject,
  Injectable,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ServiceUnavailableException } from '@nestjs/common';
import type { GeneratePdfCommand } from '../../application/dto/generate-pdf.command';
import {
  PDF_JOB_QUEUE_PORT,
  type EnqueueResult,
  type PdfJob,
  type PdfJobQueuePort,
  type QueueStats,
} from '../../application/ports/job-queue.port';
import { LOGGER_PORT, type LoggerPort } from '../../application/ports/runtime.ports';
import { GeneratePdfUseCase } from '../../application/use-cases/generate-pdf/generate-pdf.use-case';

@Injectable()
export class PdfQueueGateway implements OnModuleInit, OnModuleDestroy {
  constructor(
    private readonly generate: GeneratePdfUseCase,
    @Inject(LOGGER_PORT) private readonly logger: LoggerPort,
    @Optional() @Inject(PDF_JOB_QUEUE_PORT) private readonly queue?: PdfJobQueuePort,
  ) {}

  onModuleInit(): void {
    this.queue?.consume((job) => this.process(job));
  }

  async onModuleDestroy(): Promise<void> {
    // Drenar antes de morir: un trabajo a medias en una cola en memoria se pierde entero, y
    // quien lo encoló ya recibió un 202 que decía lo contrario.
    await this.queue?.drain(10_000);
  }

  get enabled(): boolean {
    return this.queue !== undefined;
  }

  stats(): QueueStats | undefined {
    return this.queue?.stats();
  }

  async enqueue(command: GeneratePdfCommand): Promise<EnqueueResult> {
    if (!this.queue) {
      throw new ServiceUnavailableException(
        'El procesamiento asíncrono está desactivado. Active PDF_QUEUE_ENABLED o use /pdf/generate.',
      );
    }
    return this.queue.enqueue(command);
  }

  /**
   * Procesa un trabajo. No relanza: el caso de uso ya registró el fallo, lo contó y publicó
   * `PDF_GENERATION_FAILED`. Propagarlo aquí sólo produciría un rechazo no capturado.
   */
  private async process(job: PdfJob): Promise<void> {
    try {
      const result = await this.generate.execute(job.command);
      this.logger.info('Trabajo de PDF completado', {
        jobId: job.jobId,
        documentId: result.documentId,
        template: `${result.template.id}@${result.template.version}`,
        storageKey: result.storage?.key,
        enqueuedAt: job.enqueuedAt,
      });
    } catch (error) {
      this.logger.error('Trabajo de PDF fallido', {
        jobId: job.jobId,
        templateId: job.command.templateId,
        attempts: job.attempts,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
