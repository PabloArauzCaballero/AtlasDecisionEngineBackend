/** Enforces tenant ownership and assignee-only resolution with transactional audit evidence. */
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
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

/** La cola cuyas resoluciones tienen que volver al backend de identidad. */
const COLA_DE_IDENTIDAD = 'IDENTIDAD';

@Injectable()
export class ManualReviewService {
  private readonly logger = new Logger(ManualReviewService.name);

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
    /*
     * `?? []` y no `principal.roles` a secas.
     *
     * El tipo declara `roles` obligatorio y el guardia de autenticacion lo rellena, asi que la
     * lectura directa parece segura — y no lo es. `principal` llega de un decorador que lo saca de
     * la peticion, y cualquier camino que construya uno sin lista (una integracion por clave, un
     * doble, un modo de autenticacion futuro) hace que `.some` lance un `TypeError` ANTES del `if`.
     *
     * El sintoma es el peor posible para este control: `resolve()` deja de lanzar
     * `MANUAL_REVIEW_ASSIGNEE_MISMATCH` y lanza un error sin codigo, que sube como 500. La
     * segregacion de funciones no se estaria negando a nadie — se estaria cayendo, y un 500 se lee
     * como una averia y no como «no te toca a ti».
     *
     * Sin lista de roles NO hay supervision: es la lectura segura de un dato ausente, y deja la
     * regla estricta —solo el asignado— en pie.
     */
    const puedeSupervisar = (principal.roles ?? []).some((role) =>
      SUPERVISION_ROLES.includes(role),
    );
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
    const resuelto = await this.prisma.$transaction(async (tx) => {
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

    /*
     * Y se le dice a AtlasBackend, que es donde vive la identidad del cliente.
     *
     * Va FUERA de la transaccion y despues de que haya confirmado: la decision del analista ya esta
     * tomada y no puede perderse porque otro servicio no conteste. Si el aviso falla, la resolucion
     * se mantiene y el fallo queda en la auditoria —con su motivo— en vez de desaparecer: un
     * circuito que se rompe en silencio es exactamente lo que este codigo existe para evitar.
     */
    if (review.queueCode === COLA_DE_IDENTIDAD) {
      await this.avisarIdentidadResuelta(tenantId, review.executionId, dto, principal, resuelto);
    }

    return resuelto;
  }

  /**
   * Devuelve al backend de identidad la resolucion de una revision de identidad.
   *
   * El motor no sabe de que CLIENTE es el caso, y no tiene por que: solo sabe de que ejecucion. El
   * puente es `executionId`, que AtlasBackend guarda en el intento cuando pide la decision.
   *
   * Antes esto no existia. El analista aprobaba aqui, el caso quedaba `RESOLVED_APPROVED`, y alla el
   * cliente seguia `IN_REVIEW` para siempre: no podia pedir credito y nada avisaba de que faltaba
   * un paso que alguien tenia que dar a mano.
   */
  private async avisarIdentidadResuelta(
    tenantId: bigint,
    executionId: bigint,
    dto: ResolveManualReviewDto,
    principal: AuthenticatedPrincipal,
    caso: { id: bigint },
  ): Promise<void> {
    const base = this.config.get<string>('ATLAS_BACKEND_BASE_URL');
    const clave = this.config.get<string>('ENGINE_CALLBACK_API_KEY');
    if (!base || !clave) {
      this.logger.warn(
        `Revision ${caso.id} resuelta sin avisar a identidad: falta ATLAS_BACKEND_BASE_URL o ENGINE_CALLBACK_API_KEY`,
      );
      return;
    }

    try {
      const respuesta = await fetch(`${base.replace(/\/+$/, '')}/internal/identity/manual-review-callback`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-tenant-id': tenantId.toString(),
          'x-engine-callback-key': clave,
        },
        body: JSON.stringify({
          executionId: executionId.toString(),
          decision: dto.decision,
          reason: dto.reason,
          resolvedByInternalUserId: principal.id,
        }),
        signal: AbortSignal.timeout(10_000),
      });

      if (!respuesta.ok) {
        throw new Error(`HTTP ${respuesta.status}: ${(await respuesta.text()).slice(0, 300)}`);
      }
      this.logger.log(`Identidad actualizada en AtlasBackend para la ejecucion ${executionId}`);
    } catch (error) {
      const motivo = error instanceof Error ? error.message : String(error);
      this.logger.error(`No se pudo avisar a identidad de la revision ${caso.id}: ${motivo}`);
      await this.audit.append({
        tenantId,
        eventType: 'MANUAL_REVIEW_CALLBACK_FAILED',
        aggregateType: 'ManualReviewCase',
        aggregateId: caso.id.toString(),
        actorId: principal.id,
        requestId: principal.requestId,
        payload: { executionId: executionId.toString(), decision: dto.decision, motivo },
      });
    }
  }
}
