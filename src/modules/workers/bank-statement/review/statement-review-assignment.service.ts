import { HttpStatus, Injectable } from '@nestjs/common';
import { WorkerRunStatus } from '@prisma/client';
import { DomainException } from '../../../../common/errors/domain-exception';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../../../../common/security/security.types';
import { StatementReviewDocuments } from './statement-review-documents.service';

@Injectable()
export class StatementReviewAssignment {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: StatementReviewDocuments,
  ) {}

  /** Comprueba que quien actúa es quien reclamó el caso. */
  async assertAssignee(tenantId: bigint, requestId: string, principal: AuthenticatedPrincipal) {
    const run = await this.prisma.bankStatementRun.findFirst({
      where: { tenantId, requestId },
      select: {
        status: true,
        reviewReason: true,
        reviewClaimedBy: true,
        transactionCount: true,
      },
    });
    if (!run) {
      throw new DomainException(
        'BANK_STATEMENT_REVIEW_NOT_FOUND',
        'No hay ningún caso de revisión con ese identificador.',
        HttpStatus.NOT_FOUND,
      );
    }
    if (run.status !== WorkerRunStatus.IN_REVIEW) {
      throw new DomainException(
        'BANK_STATEMENT_REVIEW_NOT_CLAIMED',
        'Hay que reclamar el caso antes de resolverlo.',
        HttpStatus.CONFLICT,
        { status: run.status },
      );
    }
    if (run.reviewClaimedBy !== principal.id) {
      throw new DomainException(
        'BANK_STATEMENT_REVIEW_ASSIGNEE_MISMATCH',
        'Sólo quien reclamó este caso puede resolverlo.',
        HttpStatus.FORBIDDEN,
      );
    }
    return {
      reviewReason: run.reviewReason,
      transactionCount: run.transactionCount,
      documentAvailable: () => this.documents.isAvailable(tenantId, requestId),
    };
  }
}
