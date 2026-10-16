import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, WorkerRunStatus } from '@prisma/client';
import { DomainException } from '../../../common/errors/domain-exception';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RUN_SELECTION, TERMINAL_STATUSES, type AudioTtsRunView } from './audio-run.view';

/** Consulta y cancelación de las locuciones de un tenant. */
@Injectable()
export class AudioRunService {
  constructor(private readonly prisma: PrismaService) {}

  async getRun(tenantId: bigint, requestId: string): Promise<AudioTtsRunView> {
    const run = await this.prisma.audioTtsRun.findFirst({
      where: { tenantId, requestId },
      select: RUN_SELECTION,
    });
    if (!run) {
      // 404 y no 403: un 403 confirmaría que la ejecución existe y que es de
      // otro, que es justo lo que no debe poder averiguarse desde fuera.
      throw new DomainException(
        'AUDIO_RUN_NOT_FOUND',
        'No existe esa locución.',
        HttpStatus.NOT_FOUND,
      );
    }
    return run;
  }

  async listRuns(
    tenantId: bigint,
    params: { page: number; pageSize: number; status?: WorkerRunStatus },
  ): Promise<{ items: AudioTtsRunView[]; total: number }> {
    const where: Prisma.AudioTtsRunWhereInput = {
      tenantId,
      ...(params.status ? { status: params.status } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.audioTtsRun.findMany({
        where,
        select: RUN_SELECTION,
        orderBy: { queuedAt: 'desc' },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
      this.prisma.audioTtsRun.count({ where }),
    ]);
    return { items, total };
  }

  /**
   * Cancela una locución que todavía nadie reclamó.
   *
   * Sólo desde `QUEUED`, igual que en los otros workers: cancelar algo ya en
   * curso exigiría que el proveedor cooperase, y ofrecerlo en la interfaz sería
   * prometer algo que no se cumple. Además, a mitad de una síntesis el dinero
   * ya está gastado.
   */
  async cancelRun(tenantId: bigint, requestId: string): Promise<AudioTtsRunView> {
    const updated = await this.prisma.audioTtsRun.updateMany({
      where: { tenantId, requestId, status: WorkerRunStatus.QUEUED },
      data: { status: WorkerRunStatus.CANCELLED, finishedAt: new Date() },
    });
    if (updated.count === 0) {
      const current = await this.getRun(tenantId, requestId);
      throw new DomainException(
        'AUDIO_RUN_NOT_CANCELLABLE',
        TERMINAL_STATUSES.includes(current.status)
          ? 'La locución ya terminó.'
          : 'La locución ya está en proceso y no puede cancelarse.',
        HttpStatus.CONFLICT,
        { status: current.status },
      );
    }
    return this.getRun(tenantId, requestId);
  }
}
