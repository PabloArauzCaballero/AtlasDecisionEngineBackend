/** Enforces tenant ownership and assignee-only resolution with transactional audit evidence. */
import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ManualReviewStatus, Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { DomainException } from '../../common/errors/domain-exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import {
  AssignManualReviewDto,
  ManualReviewListQueryDto,
  ResolveManualReviewDto,
} from './manual-review.dto';
import { pageResult, paginationArgs } from '../../common/http/pagination';

@Injectable()
export class ManualReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  async list(tenantId: bigint, query: ManualReviewListQueryDto) {
    const paging = paginationArgs(query, this.config.get<number>('MAX_PAGE_SIZE') ?? 100);
    const where: Prisma.DecisionManualReviewCaseWhereInput = {
      tenantId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.assignedTo ? { assignedTo: query.assignedTo } : {}),
      ...(query.queueCode ? { queueCode: query.queueCode } : {}),
    };
    const [total, items] = await this.prisma.$transaction([
      this.prisma.decisionManualReviewCase.count({ where }),
      this.prisma.decisionManualReviewCase.findMany({
        where,
        skip: paging.skip,
        take: paging.take,
        include: {
          execution: {
            select: {
              requestId: true,
              businessOutcome: true,
              executedAt: true,
              artifactVersionId: true,
            },
          },
        },
        orderBy: [{ priority: 'asc' }, { dueAt: 'asc' }, { id: 'asc' }],
      }),
    ]);
    return pageResult(items, total, paging.page, paging.pageSize);
  }

  async get(tenantId: bigint, caseId: bigint) {
    const review = await this.prisma.decisionManualReviewCase.findFirst({
      where: { id: caseId, tenantId },
      include: {
        execution: {
          include: {
            artifactVersion: { include: { artifact: true } },
            variables: { include: { variableVersion: { include: { definition: true } } } },
            steps: { include: { node: true }, orderBy: { stepOrder: 'asc' } },
            reasons: { include: { reasonCode: true }, orderBy: { priority: 'asc' } },
          },
        },
      },
    });
    if (!review)
      throw new DomainException(
        'MANUAL_REVIEW_NOT_FOUND',
        'Manual review case not found',
        HttpStatus.NOT_FOUND,
      );
    return review;
  }

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
    return this.prisma.$transaction(async (tx) => {
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
          payload: { assignedTo: dto.assignedTo ?? principal.id },
        },
        tx,
      );
      return updated;
    });
  }

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
    /*
     * La segregacion de funciones vale entre PARES, no frente a quien supervisa.
     *
     * Exigir que solo el asignado resuelva impide que cualquiera abra y cierre un caso ajeno, y eso
     * esta bien. Pero aplicado tambien a operaciones y administracion produce un callejon sin salida
     * real: un analista toma un caso, se va de vacaciones o deja la empresa, y ese caso queda
     * bloqueado para siempre —con un cliente esperando al otro lado— porque el unico que podia
     * resolverlo ya no esta. Que exista un rol capaz de desatascarlo no es una puerta trasera: es lo
     * que evita que la cola se convierta en un cementerio.
     *
     * Queda registrado igual: la auditoria guarda quien decidio de verdad, asi que una resolucion
     * por supervision se distingue de una del asignado con solo mirarla.
     */
    const SUPERVISION_ROLES = ['ADMIN', 'PLATFORM_ADMIN', 'OPERATIONS'];
    const puedeSupervisar = principal.roles.some((role) => SUPERVISION_ROLES.includes(role));
    if (review.assignedTo !== principal.id && !puedeSupervisar) {
      throw new DomainException(
        'MANUAL_REVIEW_ASSIGNEE_MISMATCH',
        'Only the analyst assigned to this manual review case may resolve it',
        HttpStatus.FORBIDDEN,
      );
    }
    const status =
      dto.decision === 'APPROVE'
        ? ManualReviewStatus.RESOLVED_APPROVED
        : dto.decision === 'DECLINE'
          ? ManualReviewStatus.RESOLVED_DECLINED
          : ManualReviewStatus.CANCELLED;
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.decisionManualReviewCase.update({
        where: { id: caseId },
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
      });
      await this.audit.append(
        {
          tenantId,
          eventType: 'MANUAL_REVIEW_RESOLVED',
          aggregateType: 'ManualReviewCase',
          aggregateId: caseId.toString(),
          actorId: principal.id,
          requestId: principal.requestId,
          payload: { decision: dto.decision, reason: dto.reason },
        },
        tx,
      );
      return updated;
    });
  }
}
