/** Enforces tenant ownership and assignee-only resolution, with a recorded supervisor override. */
import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ManualReviewStatus, Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { DomainException } from '../../common/errors/domain-exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PlatformRole } from '../../common/security/platform-roles';
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
 * al otro lado— porque el único que podía resolverlo ya no está. Que exista un rol capaz de
 * desatascarlo no es una puerta trasera: es lo que evita que la cola se convierta en un cementerio.
 *
 * Los nombres salen de `PlatformRole` y no de literales sueltos a propósito. Un rol inventado aquí
 * —`ADMIN`, por ejemplo, que no existe en esta plataforma— no rompe la compilación ni ninguna
 * prueba: simplemente no lo tiene nadie, y el permiso que este fichero cree estar concediendo no
 * se concede jamás. Es el fallo silencioso contra el que avisa `platform-roles.ts`.
 *
 * `PLATFORM_ADMIN` no está en la lista porque no se concede en las mismas condiciones; lo resuelve
 * `supervisa()`.
 */
const SUPERVISION_ROLES: readonly string[] = [PlatformRole.OPERATIONS];

/**
 * True cuando el principal puede actuar sobre un caso que pertenece a otra persona.
 *
 * `PLATFORM_ADMIN` cuenta aparte y sólo sobre identidad firmada, igual que en `RolesGuard`: es un
 * comodín global y el guard se niega a honrarlo en una clave de API, que un humano no custodia.
 * Repetir aquí esa condición no es paranoia — sin ella, una clave con `PLATFORM_ADMIN` **y**
 * `FRAUD_ANALYST` entra por el rol concreto y recoge la supervisión por el comodín, que es
 * exactamente lo que el guard acaba de negarle una capa más arriba.
 */
function supervisa(principal: AuthenticatedPrincipal): boolean {
  const comodinFirmado =
    principal.roles.includes(PlatformRole.PLATFORM_ADMIN) &&
    (principal.authMethod === 'jwt' || principal.authMethod === 'identity_provider');
  return comodinFirmado || principal.roles.some((role) => SUPERVISION_ROLES.includes(role));
}

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
    /*
     * Un caso que ya es de otra persona sólo lo mueve quien supervisa.
     *
     * Sin esta comprobación la segregación de `resolve()` es decorativa: bastaba con reasignarse el
     * caso ajeno y resolverlo a continuación, dos llamadas que cualquier rol de la ruta podía hacer.
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
    /*
     * Sin `assignedTo` el caso queda a nombre de quien lo toma.
     *
     * Era obligatorio, así que «Asignármelo» —el gesto normal de un analista, que no nombra a nadie
     * porque se nombra a sí mismo— moría en un 400. El caso no se podía tomar desde la pantalla, y
     * sin tomarlo no se puede resolver: la cola entera era inoperable.
     *
     * Y lo que se guarda es la identidad del PRINCIPAL, no una cadena cualquiera del cliente:
     * `resolve()` compara contra `principal.id`, así que un caso asignado al correo del analista
     * —que es lo que enviaba el portal— queda a nombre de una identidad que nunca va a coincidir.
     * Se puede tomar y después es imposible resolverlo, con el mensaje «sólo el analista asignado
     * puede resolverlo» señalando a quien SÍ lo tiene asignado.
     */
    const assignee = dto.assignedTo ?? principal.id;
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.decisionManualReviewCase.update({
        where: { id: caseId },
        data: { assignedTo: assignee, status: ManualReviewStatus.ASSIGNED },
      });
      await this.audit.append(
        {
          tenantId,
          eventType: 'MANUAL_REVIEW_ASSIGNED',
          aggregateType: 'ManualReviewCase',
          aggregateId: caseId.toString(),
          actorId: principal.id,
          requestId: principal.requestId,
          // `assignedTo` y `actorId` por separado: coinciden cuando alguien toma su propio caso y
          // difieren cuando lo reparte un tercero, y esa diferencia es justo lo que hay que poder
          // leer después sin reconstruirla.
          payload: { assignedTo: assignee, previousAssignee: review.assignedTo },
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
    // Un caso ajeno lo cierra quien supervisa (ver `SUPERVISION_ROLES`) y nadie más. La excepción
    // queda escrita en la resolución y en la auditoría, no sólo permitida.
    const porSupervision = review.assignedTo !== principal.id;
    if (porSupervision && !supervisa(principal)) {
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
          /*
           * `assignedTo` y `supervisorOverride` viajan con la resolución, no se deducen.
           *
           * Permitir que supervisión cierre un caso ajeno sólo es aceptable si después se distingue
           * de un cierre normal. Con `resolvedBy` a secas no se distingue: habría que ir a buscar a
           * quién estaba asignado el caso, y la propia fila acaba de sobrescribir ese dato. Quien
           * audite tiene que poder contar los cierres por supervisión leyendo una sola columna.
           */
          resolutionJson: {
            decision: dto.decision,
            reason: dto.reason,
            metadata: dto.metadata ?? {},
            resolvedBy: principal.id,
            assignedTo: review.assignedTo,
            supervisorOverride: porSupervision,
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
  }
}
