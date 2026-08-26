/** Enforces tenant ownership and assignee-only resolution with transactional audit evidence. */
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ManualReviewStatus, Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { PlatformRole } from '../../common/security/platform-roles';
import { DomainException } from '../../common/errors/domain-exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import {
  AssignManualReviewDto,
  ManualReviewListQueryDto,
  ResolveManualReviewDto,
} from './manual-review.dto';
import { pageResult, paginationArgs } from '../../common/http/pagination';

/**
 * Quién puede intervenir sobre el caso de OTRO analista.
 *
 * La segregación de funciones vale entre PARES, no frente a quien supervisa. Exigir que sólo el
 * asignado resuelva impide que cualquiera abra y cierre un caso ajeno, y eso está bien; aplicado
 * también a supervisión produce un callejón sin salida real: un analista toma un caso, se va de
 * vacaciones o deja la empresa, y ese caso queda bloqueado para siempre —con un cliente esperando
 * al otro lado— porque el único que podía resolverlo ya no está.
 *
 * **Los nombres salen de `PlatformRole`, no de literales sueltos.** La lista decía
 * `['ADMIN', 'PLATFORM_ADMIN', 'OPERATIONS']` y `ADMIN` **no existe en esta plataforma**: no rompía
 * la compilación ni ninguna prueba, simplemente no lo tiene nadie y el permiso que este fichero
 * creía conceder no se concedía jamás. Es el fallo silencioso contra el que avisa
 * `platform-roles.ts`, y sólo el tipo lo atrapa.
 */
const SUPERVISION_ROLES: readonly string[] = [PlatformRole.OPERATIONS];

/**
 * `PLATFORM_ADMIN` cuenta aparte y sólo sobre identidad firmada, igual que en `RolesGuard`.
 *
 * Es un comodín global y el guard se niega a honrarlo en una clave de API, que ningún humano
 * custodia. Repetir aquí esa condición no es paranoia: sin ella, una clave con `PLATFORM_ADMIN` y
 * un rol concreto de la ruta entra por el rol concreto y recoge la supervisión por el comodín —
 * exactamente lo que el guard acaba de negarle una capa más arriba.
 */
function supervisa(principal: AuthenticatedPrincipal): boolean {
  const roles = principal.roles ?? [];
  const comodinFirmado =
    roles.includes(PlatformRole.PLATFORM_ADMIN) &&
    (principal.authMethod === 'jwt' || principal.authMethod === 'identity_provider');
  return comodinFirmado || roles.some((role) => SUPERVISION_ROLES.includes(role));
}

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
