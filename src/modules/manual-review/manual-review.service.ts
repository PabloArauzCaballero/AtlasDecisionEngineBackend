/** Enforces tenant ownership and assignee-only resolution with transactional audit evidence. */
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ManualReviewStatus, Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { PlatformRole } from '../../common/security/platform-roles';
import { DomainException } from '../../common/errors/domain-exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import { AtlasCallbackService } from '../atlas-callback/atlas-callback.service';
import {
  AssignManualReviewDto,
  ManualReviewListQueryDto,
  ResolveManualReviewDto,
} from './manual-review.dto';
import { pageResult, paginationArgs } from '../../common/http/pagination';
import { escapeLikeTerm } from '../../common/persistence/like-escape';

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

/**
 * A donde vuelve cada resolucion, por cola.
 *
 * Hasta el 2026-09-14 solo la cola de IDENTIDAD avisaba a AtlasBackend. Las otras dos que Atlas
 * delega —riesgo de onboarding y credito— se resolvian aqui y alla nadie se enteraba: el caso local
 * quedaba delegado (409 `MANUAL_REVIEW_DELEGADA_AL_MOTOR`) y la solicitud `under_review` para
 * siempre. Un callejon sin salida con las dos puertas cerradas a proposito.
 *
 * `MERCHANT_KYB` no esta y es correcto: AtlasBackend lo sincroniza por tiron (`sync_partner_kyb_reviews`).
 * Cualquier cola que no este aqui no avisa, y lo deja escrito en el log: es preferible a adivinar un
 * destino y llenar la auditoria de callbacks fallidos.
 */
export const RUTA_DE_CALLBACK_POR_COLA: Readonly<Record<string, string>> = {
  [COLA_DE_IDENTIDAD]: '/internal/identity/manual-review-callback',
  RIESGO_ONBOARDING: '/internal/risk/manual-review-callback',
  CREDIT_REVIEW: '/internal/credit/manual-review-callback',
};

/** La ruta de vuelta para una cola, o `null` si esa cola no se devuelve por callback. */
export function rutaDeCallback(queueCode: string | null | undefined): string | null {
  return RUTA_DE_CALLBACK_POR_COLA[String(queueCode ?? '')] ?? null;
}

@Injectable()
export class ManualReviewService {
  private readonly logger = new Logger(ManualReviewService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    private readonly callbacks: AtlasCallbackService,
  ) {}

  async list(tenantId: bigint, query: ManualReviewListQueryDto) {
    const paging = paginationArgs(query, this.config.get<number>('MAX_PAGE_SIZE') ?? 100);
    const search = query.search?.trim() ? escapeLikeTerm(query.search.trim()) : undefined;
    const where: Prisma.DecisionManualReviewCaseWhereInput = {
      tenantId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.assignedTo ? { assignedTo: query.assignedTo } : {}),
      ...(query.queueCode ? { queueCode: query.queueCode } : {}),
      /*
       * «Buscar caso» mandaba `queueCode`, que se compara por IGUALDAD con la cola: escribir el
       * código de un caso (`MR-2026-0042`) o un request ID devolvía siempre cero filas, aunque la
       * ayuda prometía «ir directo a uno concreto». `contains` + `insensitive` es `ILIKE '%…%'` y
       * Prisma NO escapa `%` ni `_`: se escapan con `escapeLikeTerm` para buscar el texto tal cual.
       */
      ...(search
        ? {
            OR: [
              { caseCode: { contains: search, mode: 'insensitive' as const } },
              { execution: { requestId: { contains: search, mode: 'insensitive' as const } } },
            ],
          }
        : {}),
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

    // El controlador hace `return this.reviews.assign(...)`, así que sin esto la respuesta del
    // endpoint salía vacía: el portal reasignaba el caso y no recibía el caso reasignado.
    return resuelto;
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
    const ruta = rutaDeCallback(review.queueCode);
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
