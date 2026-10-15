import { HttpStatus, Injectable } from '@nestjs/common';
import { ManualReviewStatus } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { DomainException } from '../../common/errors/domain-exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import { AssignManualReviewDto } from './manual-review.dto';
import { supervisa } from './manual-review.policy';

@Injectable()
export class ManualReviewAssignmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async assign(
    tenantId: bigint,
    caseId: bigint,
    dto: AssignManualReviewDto,
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
    /*
     * Un caso que YA es de otra persona sólo lo mueve quien supervisa.
     *
     * Sin esta comprobación la segregación de `resolve()` es decorativa: bastaba con reasignarse el
     * caso ajeno y resolverlo a continuación —dos llamadas que cualquier rol de la ruta podía
     * hacer—. El comentario de abajo ya decía «para que un SUPERVISOR pueda asignar el caso a otro
     * analista» y nada comprobaba que quien llamaba lo fuera.
     *
     * Lo que se prohíbe es QUITAR, no dar: ceder el caso propio a un compañero y repartir un caso
     * que todavía no es de nadie siguen abiertos a cualquiera, porque los dos entregan la decisión
     * en vez de apropiársela.
     */
    if (review.assignedTo && review.assignedTo !== principal.id && !supervisa(principal)) {
      throw new DomainException(
        'MANUAL_REVIEW_ASSIGN_FORBIDDEN',
        'Only a supervisor may reassign a case already held by another analyst',
        HttpStatus.FORBIDDEN,
      );
    }
    const resuelto = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.decisionManualReviewCase.update({
        where: { id: caseId },
        /*
         * Se guarda la identidad del PRINCIPAL, no la que mande el cliente.
         *
         * `resolve()` compara `review.assignedTo !== principal.id`, asi que si aqui se guarda otra
         * cosa —el correo del analista, por ejemplo, que es lo que enviaba el portal— el caso queda
         * asignado a una identidad que nunca va a coincidir: se puede tomar el caso y despues es
         * imposible resolverlo, con el mensaje «solo el analista asignado puede resolverlo»
         * senalando a quien SI lo tiene asignado. Las dos operaciones tienen que hablar de la misma
         * persona con el mismo nombre.
         *
         * `dto.assignedTo` se sigue aceptando para que un supervisor pueda asignar el caso a OTRO
         * analista; cuando no viene, el caso es de quien lo toma.
         */
        data: { assignedTo: dto.assignedTo ?? principal.id, status: ManualReviewStatus.ASSIGNED },
      });
      await this.audit.append(
        {
          tenantId,
          eventType: 'MANUAL_REVIEW_ASSIGNED',
          aggregateType: 'ManualReviewCase',
          aggregateId: caseId.toString(),
          actorId: principal.id,
          requestId: principal.requestId,
          /*
            `previousAssignee` es la mitad que faltaba.

            Sin él, reasignar un caso deja en la auditoría «ahora es de Ana» y ningún rastro de que
            antes era de Luis. Justo la operación que sólo un supervisor puede hacer —quitarle un
            caso a otro analista— era la que menos evidencia dejaba. Va `null` cuando el caso no
            era de nadie, que es el gesto normal de tomarlo.
          */
          payload: {
            assignedTo: dto.assignedTo ?? principal.id,
            previousAssignee: review.assignedTo ?? null,
          },
        },
        tx,
      );
      return updated;
    });

    // El controlador hace `return this.reviews.assign(...)`, así que sin esto la respuesta del
    // endpoint salía vacía: el portal reasignaba el caso y no recibía el caso reasignado.
    return resuelto;
  }
}
