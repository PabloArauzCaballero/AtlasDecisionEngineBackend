import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, WorkerRunStatus } from '@prisma/client';
import { DomainException } from '../../../../common/errors/domain-exception';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../../../../common/security/security.types';
import { IDENTITY_REVIEW_STATUSES } from '../identity-outcome';
import { QUEUE_SELECTION, type QueueRow } from './identity-review.queue';

/** Quién tiene reclamado un caso: sólo esa persona lo puede cerrar, y sólo mientras lo siga teniendo. */
@Injectable()
export class IdentityReviewAssignment {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Cierra el caso SÓLO si sigue reclamado por quien firma.
   *
   * `asignadoA` comprueba la asignación fuera de la transacción; entre esa lectura y la escritura
   * cabe otra petición entera (doble clic, un reintento del portal, CONFIRM y REJECT a la vez). Un
   * `update` por clave escribiría encima de lo que la primera ya cerró —incluida una ejecución que
   * el worker ya tiene en RUNNING—. La guarda va en el WHERE: gana una, la otra recibe 409 y
   * ninguna auditoría de más.
   */
  async cerrarSiSigueAsignado(
    tx: Prisma.TransactionClient,
    tenantId: bigint,
    requestId: string,
    principal: AuthenticatedPrincipal,
    data: Prisma.IdentityVerificationRunUpdateManyMutationInput,
  ): Promise<void> {
    const cerrado = await tx.identityVerificationRun.updateMany({
      where: {
        tenantId,
        requestId,
        status: WorkerRunStatus.IN_REVIEW,
        reviewClaimedBy: principal.id,
      },
      data,
    });
    if (cerrado.count === 0) {
      throw new DomainException(
        'IDENTITY_REVIEW_NOT_ASSIGNED',
        'El caso ya no está reclamado por ti: otra petición lo cerró o lo liberó.',
        HttpStatus.CONFLICT,
      );
    }
  }

  async asignadoA(
    tenantId: bigint,
    requestId: string,
    principal: AuthenticatedPrincipal,
  ): Promise<QueueRow> {
    const run = await this.prisma.identityVerificationRun.findFirst({
      where: { tenantId, requestId, status: { in: [...IDENTITY_REVIEW_STATUSES] } },
      select: QUEUE_SELECTION,
    });
    if (!run) {
      throw new DomainException(
        'IDENTITY_REVIEW_NOT_FOUND',
        'No hay ningún caso de arbitraje con ese identificador.',
        HttpStatus.NOT_FOUND,
      );
    }
    if (run.status !== WorkerRunStatus.IN_REVIEW || run.reviewClaimedBy !== principal.id) {
      throw new DomainException(
        'IDENTITY_REVIEW_NOT_ASSIGNED',
        'Sólo quien reclamó el caso puede cerrarlo. Recláma1o primero.',
        HttpStatus.CONFLICT,
        { claimedBy: run.reviewClaimedBy },
      );
    }
    return run;
  }
}
