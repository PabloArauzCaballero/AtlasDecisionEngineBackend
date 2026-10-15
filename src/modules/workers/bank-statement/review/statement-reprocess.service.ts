import { HttpStatus, Injectable } from '@nestjs/common';
import { WorkerRunStatus } from '@prisma/client';
import { AuditService } from '../../../../common/audit/audit.service';
import { DomainException } from '../../../../common/errors/domain-exception';
import { JobName } from '../../../../common/jobs/job-names';
import { JobSignalService } from '../../../../common/jobs/job-signal.service';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../../../../common/security/security.types';
import { StatementReviewAssignment } from './statement-review-assignment.service';
import type { StatementReprocessedDto } from './statement-review.dto';

@Injectable()
export class StatementReprocessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly jobSignal: JobSignalService,
    private readonly assignment: StatementReviewAssignment,
  ) {}

  /**
   * Devuelve el caso a la cola del worker para volver a intentarlo.
   *
   * Es la acción que da sentido a conservar el documento mientras el caso está
   * abierto: sin bytes no hay reproceso, y pedirle a quien subió el extracto que
   * vuelva a buscarlo en su disco para que el motor lo intente otra vez con los
   * umbrales ya corregidos es trasladarle el trabajo de arreglar el motor.
   */
  async reprocess(tenantId: bigint, requestId: string, principal: AuthenticatedPrincipal) {
    const current = await this.assignment.assertAssignee(tenantId, requestId, principal);
    if (!(await current.documentAvailable())) {
      throw new DomainException(
        'BANK_STATEMENT_DOCUMENT_UNAVAILABLE',
        'El documento original ya no está disponible: hay que volver a subirlo.',
        HttpStatus.CONFLICT,
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.bankStatementRun.update({
        where: { tenantId_requestId: { tenantId, requestId } },
        data: {
          status: WorkerRunStatus.QUEUED,
          progress: 0,
          // El expediente entero vuelve a cero: una fila en cola que conserve el
          // motivo de revisión describe un caso que ya no existe, y la base lo
          // rechaza.
          reviewReason: null,
          rejectionReason: null,
          reviewPriority: null,
          reviewOpenedAt: null,
          reviewClaimedBy: null,
          reviewClaimedAt: null,
          errorCode: null,
          errorMessage: null,
          // Los intentos se reponen: los que gastó fueron contra la versión
          // anterior del análisis, y arrastrarlos haría que el reproceso naciera
          // ya agotado.
          attemptCount: 0,
          leaseExpiresAt: null,
          queuedAt: new Date(),
          startedAt: null,
          finishedAt: null,
        },
      });
      await this.audit.append(
        {
          tenantId,
          eventType: 'BANK_STATEMENT_REVIEW_REPROCESSED',
          aggregateType: 'BankStatementRun',
          aggregateId: requestId,
          actorId: principal.id,
          requestId: principal.requestId,
          payload: { requestId, previousReviewReason: current.reviewReason },
        },
        tx,
      );
      // Dentro de la transacción por lo mismo que en el alta: Postgres sólo
      // entrega el aviso si esto confirma.
      await this.jobSignal.notify(tx, JobName.BankStatement);
    });
    const reencolado: StatementReprocessedDto = {
      requestId,
      status: WorkerRunStatus.QUEUED,
    };
    return reencolado;
  }
}
