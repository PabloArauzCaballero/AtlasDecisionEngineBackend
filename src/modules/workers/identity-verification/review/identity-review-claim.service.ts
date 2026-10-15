import { HttpStatus, Injectable } from '@nestjs/common';
import { WorkerRunStatus } from '@prisma/client';
import { AuditService } from '../../../../common/audit/audit.service';
import { DomainException } from '../../../../common/errors/domain-exception';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../../../../common/security/security.types';
import { IdentityReviewQueueService } from './identity-review-queue.service';

@Injectable()
export class IdentityReviewClaimService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly queue: IdentityReviewQueueService,
  ) {}

  /**
   * Reclama un caso.
   *
   * `updateMany` con el estado en el `WHERE` y no `update`: un reclamo que no es
   * atómico no es un reclamo, y dos peticiones simultáneas pasan las dos por un
   * `findFirst` que ve el caso libre.
   */
  async claim(tenantId: bigint, requestId: string, principal: AuthenticatedPrincipal) {
    const reclamado = await this.prisma.$transaction(async (tx) => {
      const resultado = await tx.identityVerificationRun.updateMany({
        where: { tenantId, requestId, status: WorkerRunStatus.PENDING_REVIEW },
        data: {
          status: WorkerRunStatus.IN_REVIEW,
          reviewClaimedBy: principal.id,
          reviewClaimedAt: new Date(),
        },
      });
      if (resultado.count === 0) return false;
      await this.audit.append(
        {
          tenantId,
          eventType: 'IDENTITY_REVIEW_CLAIMED',
          aggregateType: 'IdentityVerificationRun',
          aggregateId: requestId,
          actorId: principal.id,
          requestId: principal.requestId,
          payload: { requestId },
        },
        tx,
      );
      return true;
    });
    if (!reclamado) {
      const actual = await this.currentStatus(tenantId, requestId);
      throw new DomainException(
        'IDENTITY_REVIEW_NOT_CLAIMABLE',
        actual === WorkerRunStatus.IN_REVIEW
          ? 'Otra persona ya está revisando este caso.'
          : 'Este caso ya no está esperando revisión.',
        HttpStatus.CONFLICT,
        { status: actual },
      );
    }
    return this.queue.get(tenantId, requestId);
  }

  private async currentStatus(tenantId: bigint, requestId: string) {
    const run = await this.prisma.identityVerificationRun.findFirst({
      where: { tenantId, requestId },
      select: { status: true },
    });
    return run?.status ?? null;
  }
}
