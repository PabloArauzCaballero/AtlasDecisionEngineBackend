import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, WorkerRunStatus } from '@prisma/client';
import { DomainException } from '../../../common/errors/domain-exception';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RUN_SELECTION, TERMINAL_STATUSES, type BankStatementRunView } from './statement-run.view';

/** Consulta y cancelación de las ejecuciones del worker de extractos de un tenant. */
@Injectable()
export class StatementRunService {
  constructor(private readonly prisma: PrismaService) {}

  /** Una ejecución del tenant. Ajena o inexistente responden igual: 404. */
  async getRun(tenantId: bigint, requestId: string): Promise<BankStatementRunView> {
    const run = await this.prisma.bankStatementRun.findFirst({
      where: { tenantId, requestId },
      select: RUN_SELECTION,
    });
    if (!run) {
      // 404 y no 403: un 403 confirmaría que la ejecución existe y que es de
      // otro, que es justo lo que no debe poder averiguarse desde fuera.
      throw new DomainException(
        'BANK_STATEMENT_RUN_NOT_FOUND',
        'No existe esa ejecución.',
        HttpStatus.NOT_FOUND,
      );
    }
    return run;
  }

  async listRuns(
    tenantId: bigint,
    params: { page: number; pageSize: number; status?: WorkerRunStatus },
  ): Promise<{ items: BankStatementRunView[]; total: number }> {
    const where: Prisma.BankStatementRunWhereInput = {
      tenantId,
      ...(params.status ? { status: params.status } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.bankStatementRun.findMany({
        where,
        select: RUN_SELECTION,
        orderBy: { queuedAt: 'desc' },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
      this.prisma.bankStatementRun.count({ where }),
    ]);
    return { items, total };
  }

  /**
   * Cancela una ejecución que todavía nadie reclamó.
   *
   * Sólo desde `QUEUED`. Cancelar algo ya en curso exigiría que el processor
   * cooperase y una señal entre procesos que el motor no tiene; ofrecerlo en la
   * interfaz sería prometer algo que no se cumple.
   */
  async cancelRun(tenantId: bigint, requestId: string): Promise<BankStatementRunView> {
    const updated = await this.prisma.bankStatementRun.updateMany({
      where: { tenantId, requestId, status: WorkerRunStatus.QUEUED },
      data: {
        status: WorkerRunStatus.CANCELLED,
        finishedAt: new Date(),
        // El documento deja de hacer falta en cuanto se cancela.
        fileBytes: null,
      },
    });
    if (updated.count === 0) {
      const current = await this.getRun(tenantId, requestId);
      throw new DomainException(
        'BANK_STATEMENT_RUN_NOT_CANCELLABLE',
        TERMINAL_STATUSES.includes(current.status)
          ? 'La ejecución ya terminó.'
          : 'La ejecución ya está siendo procesada y no puede cancelarse.',
        HttpStatus.CONFLICT,
        { status: current.status },
      );
    }
    return this.getRun(tenantId, requestId);
  }
}
