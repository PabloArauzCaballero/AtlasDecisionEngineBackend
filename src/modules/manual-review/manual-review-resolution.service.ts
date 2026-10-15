import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ManualReviewStatus, Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { DomainException } from '../../common/errors/domain-exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import { AtlasCallbackService } from '../atlas-callback/atlas-callback.service';
import { ResolveManualReviewDto } from './manual-review.dto';
import { rutaDeCallback, supervisa } from './manual-review.policy';

/** Enforces tenant ownership and assignee-only resolution with transactional audit evidence. */
@Injectable()
export class ManualReviewResolutionService {
  private readonly logger = new Logger(ManualReviewResolutionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly callbacks: AtlasCallbackService,
  ) {}

  async resolve(
    tenantId: bigint,
    caseId: bigint,
    dto: ResolveManualReviewDto,
    principal: AuthenticatedPrincipal,
  ) {
    const review = await this.prisma.decisionManualReviewCase.findFirst({
      where: { id: caseId, tenantId },
    });
    if (!review)
      throw new DomainException(
        'MANUAL_REVIEW_NOT_FOUND',
        'Manual review case not found',
        HttpStatus.NOT_FOUND,
      );
    const openStatuses: ManualReviewStatus[] = [
      ManualReviewStatus.OPEN,
      ManualReviewStatus.ASSIGNED,
    ];
    if (!openStatuses.includes(review.status)) {
      throw new DomainException(
        'MANUAL_REVIEW_CLOSED',
        'Manual review case is already closed',
        HttpStatus.CONFLICT,
      );
    }
    // Segregation of duties: resolving a fraud/AML/credit review is a one-person decision with
    // real financial consequence, so it requires an explicit prior `assign()` call — never
    // auto-self-assigned here — and only the assigned analyst may resolve it. Without this, any
    // principal holding the review role could open and close any case unilaterally in one call.
    if (!review.assignedTo) {
      throw new DomainException(
        'MANUAL_REVIEW_NOT_ASSIGNED',
        'Manual review case must be assigned before it can be resolved',
        HttpStatus.CONFLICT,
      );
    }
    if (review.assignedTo !== principal.id && !supervisa(principal)) {
      throw new DomainException(
        'MANUAL_REVIEW_ASSIGNEE_MISMATCH',
        'Only the analyst assigned to this manual review case may resolve it',
        HttpStatus.FORBIDDEN,
      );
    }
    /*
      Que quien resuelve NO sea el asignado es exactamente lo que la segregación de funciones
      permite sólo a supervisión, y hasta ahora no se distinguía de una resolución corriente:
      el guard de arriba la dejaba pasar y la auditoría escribía la misma fila que en el caso
      normal. Auditar un override exige poder encontrarlo, y para encontrarlo hay que marcarlo.
    */
    const porSupervision = review.assignedTo !== principal.id;
    const status =
      dto.decision === 'APPROVE'
        ? ManualReviewStatus.RESOLVED_APPROVED
        : dto.decision === 'DECLINE'
          ? ManualReviewStatus.RESOLVED_DECLINED
          : ManualReviewStatus.CANCELLED;
    const ruta = rutaDeCallback(review.queueCode);
    const resuelto = await this.prisma.$transaction(async (tx) => {
      /*
       * La transición es CONDICIONAL al estado: el `findFirst` de arriba va fuera de la
       * transacción, así que dos resoluciones simultáneas (doble clic, o analista y supervisor a
       * la vez) leían las dos ASSIGNED y las dos escribían, y cada una encolaba su aviso a
       * AtlasBackend: APPROVE y DECLINE para la misma ejecución. Con el estado en el `where`, la
       * segunda espera el bloqueo de fila, ve el caso ya cerrado y falla con P2025 ANTES de
       * encolar nada; la transacción se deshace entera.
       */
      const updated = await tx.decisionManualReviewCase
        .update({
          where: { id: caseId, tenantId, status: { in: openStatuses } },
          data: {
            status,
            assignedTo: review.assignedTo,
            resolutionJson: {
              decision: dto.decision,
              reason: dto.reason,
              metadata: dto.metadata ?? {},
              resolvedBy: principal.id,
            } as Prisma.InputJsonValue,
            resolvedAt: new Date(),
          },
        })
        .catch((error: unknown) => {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
            throw new DomainException(
              'MANUAL_REVIEW_CLOSED',
              'Manual review case is already closed',
              HttpStatus.CONFLICT,
            );
          }
          throw error;
        });
      /*
       * Y se le dice a AtlasBackend, que es donde vive el cliente o la solicitud.
       *
       * El motor no sabe de que CLIENTE es el caso —no tiene por que—, solo de que ejecucion: el
       * puente es `executionId`, que AtlasBackend guarda al pedir la decision. La ruta la decide la
       * cola (`rutaDeCallback`).
       *
       * El aviso se ENCOLA aqui, dentro de la transaccion, y no se envia: antes se mandaba despues
       * del commit y, si AtlasBackend no contestaba, se anotaba el fallo y nadie lo reintentaba. El
       * cliente quedaba `IN_REVIEW` con la decision ya tomada. Ahora o quedan la resolucion y el
       * aviso, o ninguno; y la entrega —con reintentos— es cosa del outbox. Va ANTES de la
       * auditoria porque la auditoria toma el cerrojo de la cadena y tiene que ser lo ultimo.
       */
      if (ruta) {
        /*
         * `requestId` y `correlationId` de la ejecucion viajan en el aviso: son como AtlasBackend
         * reconoce al cliente cuando su intento no guardo el `executionId` (2026-10-02: el cliente
         * 53 tenia cuatro revisiones aprobadas aqui y seguia «en revision» alli, porque el aviso
         * solo llevaba `executionId` y AtlasBackend respondia 404).
         */
        const ejecucion = await tx.decisionExecution.findUnique({
          where: { id: review.executionId },
          select: { requestId: true, correlationId: true },
        });
        await this.callbacks.solicitar(tx, {
          tenantId,
          ruta,
          cuerpo: {
            executionId: review.executionId.toString(),
            requestId: ejecucion?.requestId ?? null,
            correlationId: ejecucion?.correlationId ?? null,
            decision: dto.decision,
            reason: dto.reason,
            resolvedByInternalUserId: principal.id,
          },
          aggregateType: 'ManualReviewCase',
          aggregateId: caseId.toString(),
          actorId: principal.id,
          correlationId: principal.requestId,
        });
      }
      await this.audit.append(
        {
          tenantId,
          eventType: 'MANUAL_REVIEW_RESOLVED',
          aggregateType: 'ManualReviewCase',
          aggregateId: caseId.toString(),
          actorId: principal.id,
          requestId: principal.requestId,
          payload: {
            decision: dto.decision,
            reason: dto.reason,
            assignedTo: review.assignedTo,
            supervisorOverride: porSupervision,
          },
        },
        tx,
      );
      return updated;
    });

    if (!ruta) {
      this.logger.log(
        `Revision ${resuelto.id} resuelta en la cola ${review.queueCode}: esa cola no se devuelve por callback.`,
      );
    }

    return resuelto;
  }
}
