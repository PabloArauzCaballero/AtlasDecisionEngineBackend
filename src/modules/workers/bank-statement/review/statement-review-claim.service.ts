import { HttpStatus, Injectable } from '@nestjs/common';
import { WorkerRunStatus } from '@prisma/client';
import { AuditService } from '../../../../common/audit/audit.service';
import { DomainException } from '../../../../common/errors/domain-exception';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../../../../common/security/security.types';
import { StatementReviewQueueService } from './statement-review-queue.service';

@Injectable()
export class StatementReviewClaimService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly queue: StatementReviewQueueService,
  ) {}

  /**
   * Reclama un caso. Es el equivalente al `assign` de la revisión manual de
   * decisiones y existe por lo mismo: sin él, dos analistas gastan su tiempo en
   * el mismo documento y el segundo descubre que ya estaba resuelto al pulsar.
   *
   * `updateMany` con el estado en el `WHERE` y no `update`: es un reclamo, y un
   * reclamo que no es atómico no es un reclamo. Dos peticiones simultáneas pasan
   * las dos por un `findFirst` que ve el caso libre.
   */
  async claim(tenantId: bigint, requestId: string, principal: AuthenticatedPrincipal) {
    const claimed = await this.prisma.$transaction(async (tx) => {
      const result = await tx.bankStatementRun.updateMany({
        where: { tenantId, requestId, status: WorkerRunStatus.PENDING_REVIEW },
        data: {
          status: WorkerRunStatus.IN_REVIEW,
          reviewClaimedBy: principal.id,
          reviewClaimedAt: new Date(),
        },
      });
      if (result.count === 0) return false;
      await this.audit.append(
        {
          tenantId,
          eventType: 'BANK_STATEMENT_REVIEW_CLAIMED',
          aggregateType: 'BankStatementRun',
          aggregateId: requestId,
          actorId: principal.id,
          requestId: principal.requestId,
          payload: { requestId },
        },
        tx,
      );
      return true;
    });
    if (!claimed) {
      const current = await this.currentStatus(tenantId, requestId);
      throw new DomainException(
        'BANK_STATEMENT_REVIEW_NOT_CLAIMABLE',
        current === WorkerRunStatus.IN_REVIEW
          ? 'Otra persona ya está revisando este caso.'
          : 'Este caso ya no está esperando revisión.',
        HttpStatus.CONFLICT,
        { status: current },
      );
    }
    return this.queue.get(tenantId, requestId);
  }

  private async currentStatus(tenantId: bigint, requestId: string): Promise<WorkerRunStatus> {
    const run = await this.prisma.bankStatementRun.findFirst({
      where: { tenantId, requestId },
      select: { status: true },
    });
    if (!run) {
      throw new DomainException(
        'BANK_STATEMENT_REVIEW_NOT_FOUND',
        'No hay ningún caso de revisión con ese identificador.',
        HttpStatus.NOT_FOUND,
      );
    }
    return run.status;
  }
}
