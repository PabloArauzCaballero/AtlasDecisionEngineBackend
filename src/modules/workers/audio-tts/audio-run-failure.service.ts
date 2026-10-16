import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WorkerRunStatus } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { AudioDomainError } from './core/domain/errors';
import { describeError } from './describe-error';

/** Cómo termina una locución que no se generó: fallo definitivo, o vuelta a la cola mientras queden intentos. */
@Injectable()
export class AudioRunFailureService {
  private readonly logger = new Logger(AudioRunFailureService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Distingue el fallo que no tiene arreglo del que sí.
   *
   * Una plantilla que no existe o una variable inválida van a fallar igual las
   * tres veces: reintentarlas sólo gasta el worker. Un fallo de red con el
   * proveedor se cura solo. Tratarlos igual es lo que convierte una cola en un
   * bucle — y aquí, además, en una factura.
   */
  async recordFailure(runId: bigint, error: unknown): Promise<void> {
    if (error instanceof AudioDomainError) {
      await this.failRun(runId, error.code, error.message);
      return;
    }

    const maxAttempts = this.maxAttempts();
    const current = await this.prisma.audioTtsRun.findUnique({
      where: { id: runId },
      select: { attemptCount: true },
    });
    const exhausted = (current?.attemptCount ?? maxAttempts) >= maxAttempts;
    this.logger.error(
      `Locución ${runId.toString()} falló (intento ${current?.attemptCount ?? 0}/${maxAttempts}): ` +
        describeError(error),
    );

    if (exhausted) {
      await this.failRun(
        runId,
        'AUDIO_GENERATION_FAILED',
        'La locución falló tras agotar los reintentos.',
      );
      return;
    }
    await this.prisma.audioTtsRun.updateMany({
      where: { id: runId, status: WorkerRunStatus.RUNNING },
      data: {
        status: WorkerRunStatus.QUEUED,
        startedAt: null,
        leaseExpiresAt: null,
        progress: 0,
      },
    });
  }

  async isLastAttempt(runId: bigint): Promise<boolean> {
    const current = await this.prisma.audioTtsRun.findUnique({
      where: { id: runId },
      select: { attemptCount: true },
    });
    return (current?.attemptCount ?? this.maxAttempts()) >= this.maxAttempts();
  }

  async failRun(runId: bigint, code: string, message: string): Promise<void> {
    await this.prisma.audioTtsRun.updateMany({
      where: { id: runId, status: WorkerRunStatus.RUNNING },
      data: {
        status: WorkerRunStatus.FAILED,
        errorCode: code,
        errorMessage: message,
        finishedAt: new Date(),
        leaseExpiresAt: null,
      },
    });
  }

  private maxAttempts(): number {
    return this.config.get<number>('AUDIO_TTS_MAX_ATTEMPTS') ?? 3;
  }
}
