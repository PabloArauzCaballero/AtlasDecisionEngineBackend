import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  IdentityRejectionReason,
  IdentityReviewReason,
  Prisma,
  WorkerRunStatus,
} from '@prisma/client';
import { AuditService } from '../../../../common/audit/audit.service';
import { DomainException } from '../../../../common/errors/domain-exception';
import { JobName } from '../../../../common/jobs/job-names';
import { JobSignalService } from '../../../../common/jobs/job-signal.service';
import { pageResult, paginationArgs } from '../../../../common/http/pagination';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../../../../common/security/security.types';
import { IDENTITY_REVIEW_STATUSES } from '../identity-outcome';
import type {
  IdentityReviewCategoryDto,
  IdentityReviewItemDto,
  IdentityReviewQueryDto,
  IdentityReviewResolvedDto,
  ResolveIdentityReviewDto,
} from './identity-review.dto';

/**
 * Columnas que la cola necesita.
 *
 * Las IMÁGENES no están, y no es una omisión: `documentBytes` y `selfieBytes`
 * pesan megas cada una, y traerlas para pintar una lista de veinticinco filas
 * convertiría abrir la bandeja en descargar el carnet de veinticinco personas.
 * Quien arbitra las ve de una en una, por el endpoint de miniaturas que ya
 * existe para las ejecuciones.
 */
const QUEUE_SELECTION = {
  requestId: true,
  requestedBy: true,
  status: true,
  reviewReason: true,
  reviewPriority: true,
  reviewOpenedAt: true,
  reviewClaimedBy: true,
  reviewClaimedAt: true,
  arbitrationMode: true,
  documentType: true,
  documentCountry: true,
  documentTypeConfidence: true,
  errorCode: true,
  errorMessage: true,
  queuedAt: true,
} satisfies Prisma.IdentityVerificationRunSelect;

type QueueRow = Prisma.IdentityVerificationRunGetPayload<{ select: typeof QUEUE_SELECTION }>;

/**
 * La cola de arbitraje humano de identidad.
 *
 * Es el destinatario de la única franja en la que la puerta de documentos no
 * decide sola. Y **no es el vertedero de lo que el motor no entendió**: lo que
 * llega aquí ya pasó el triage, así que es, por construcción, algo que se parece
 * a un documento de identidad lo bastante como para que una persona pueda
 * confirmarlo mirando. Una factura o una foto de un paisaje se quedan en
 * `DOCUMENT_REJECTED`, en el historial, y ninguna consulta de este servicio
 * puede devolverlas porque todas acotan por `IDENTITY_REVIEW_STATUSES`.
 *
 * El día que el arbitraje lo haga un modelo, esta clase no cambia: el modo con
 * el que se arbitró cada caso viaja en la fila (`arbitrationMode`), que es lo
 * que permitirá comparar el acierto de los dos cuando convivan.
 */
@Injectable()
export class IdentityReviewService {
  private readonly logger = new Logger(IdentityReviewService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    private readonly jobSignal: JobSignalService,
  ) {}

  async list(tenantId: bigint, query: IdentityReviewQueryDto) {
    const paging = paginationArgs(query, this.config.get<number>('MAX_PAGE_SIZE') ?? 100);
    const where = this.queueWhere(tenantId, query);
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.identityVerificationRun.count({ where }),
      this.prisma.identityVerificationRun.findMany({
        where,
        select: QUEUE_SELECTION,
        skip: paging.skip,
        take: paging.take,
        // Prioridad primero y antigüedad después: es el orden en que se trabaja
        // una cola, y el mismo que el índice `…_review_queue_idx` materializa.
        orderBy: [{ reviewPriority: 'asc' }, { reviewOpenedAt: 'asc' }, { id: 'asc' }],
      }),
    ]);
    const now = Date.now();
    return pageResult(
      rows.map((row) => this.toItem(row, now)),
      total,
      paging.page,
      paging.pageSize,
    );
  }

  /**
   * Los contadores de las pestañas, agregados en el servidor.
   *
   * Contarlos sobre la página cargada es la trampa evidente: la página trae 25
   * filas y el rótulo diría «Documento dudoso (4)» sobre una cola de cuatrocientos.
   */
  async categories(tenantId: bigint): Promise<IdentityReviewCategoryDto[]> {
    const rows = await this.prisma.identityVerificationRun.groupBy({
      by: ['reviewReason'],
      where: { tenantId, status: { in: [...IDENTITY_REVIEW_STATUSES] } },
      _count: { _all: true },
      _min: { reviewOpenedAt: true },
    });
    const claimed = await this.prisma.identityVerificationRun.groupBy({
      by: ['reviewReason'],
      where: { tenantId, status: WorkerRunStatus.IN_REVIEW },
      _count: { _all: true },
    });
    const reclamados = new Map(claimed.map((row) => [row.reviewReason, row._count._all]));

    const now = Date.now();
    const porCategoria = rows
      .filter(
        (row): row is typeof row & { reviewReason: IdentityReviewReason } =>
          row.reviewReason !== null,
      )
      .map((row) => ({
        category: row.reviewReason,
        total: row._count._all,
        claimed: reclamados.get(row.reviewReason) ?? 0,
        oldestPendingMs: transcurrido(row._min.reviewOpenedAt, now),
      }));

    const todos: IdentityReviewCategoryDto = {
      category: null,
      total: porCategoria.reduce((suma, row) => suma + row.total, 0),
      claimed: porCategoria.reduce((suma, row) => suma + row.claimed, 0),
      oldestPendingMs: porCategoria.reduce<number | null>(
        (mayor, row) =>
          row.oldestPendingMs === null ? mayor : Math.max(mayor ?? 0, row.oldestPendingMs),
        null,
      ),
    };
    // «Todos» primero, y el resto por volumen: la pestaña con más trabajo es la
    // que hay que ver sin buscarla.
    return [todos, ...porCategoria.sort((izq, der) => der.total - izq.total)];
  }

  /** Un caso, con todo lo que hace falta para decidirlo. */
  async get(tenantId: bigint, requestId: string) {
    const run = await this.prisma.identityVerificationRun.findFirst({
      where: { tenantId, requestId, status: { in: [...IDENTITY_REVIEW_STATUSES] } },
      select: {
        ...QUEUE_SELECTION,
        resultJson: true,
        warningsJson: true,
        correlationId: true,
        attemptCount: true,
        reviewNotes: true,
        documentFileName: true,
        selfieFileName: true,
        imageSizeBytes: true,
      },
    });
    if (!run) {
      // 404 y no 403: un 403 confirmaría que el caso existe y es de otro
      // inquilino, que es justo lo que no debe poder averiguarse.
      throw new DomainException(
        'IDENTITY_REVIEW_NOT_FOUND',
        'No hay ningún caso de arbitraje con ese identificador.',
        HttpStatus.NOT_FOUND,
      );
    }
    return {
      ...this.toItem(run, Date.now()),
      result: run.resultJson,
      warnings: run.warningsJson,
      correlationId: run.correlationId,
      attemptCount: run.attemptCount,
      reviewNotes: run.reviewNotes,
      documentFileName: run.documentFileName,
      selfieFileName: run.selfieFileName,
      imageSizeBytes: run.imageSizeBytes,
    };
  }

  /**
   * Reclama un caso.
   *
   * `updateMany` con el estado en el `WHERE` y no `update`: un reclamo que no es
   * atómico no es un reclamo, y dos peticiones simultáneas pasan las dos por un
   * `findFirst` que ve el caso libre.
   */
  async claim(tenantId: bigint, requestId: string, principal: AuthenticatedPrincipal) {
    const reclamado = await this.prisma.$transaction(async (tx) => {
      const resultado = await tx.identityVerificationRun.updateMany({
        where: { tenantId, requestId, status: WorkerRunStatus.PENDING_REVIEW },
        data: {
          status: WorkerRunStatus.IN_REVIEW,
          reviewClaimedBy: principal.id,
          reviewClaimedAt: new Date(),
        },
      });
      if (resultado.count === 0) return false;
      await this.audit.append(
        {
          tenantId,
          eventType: 'IDENTITY_REVIEW_CLAIMED',
          aggregateType: 'IdentityVerificationRun',
          aggregateId: requestId,
          actorId: principal.id,
          requestId: principal.requestId,
          payload: { requestId },
        },
        tx,
      );
      return true;
    });
    if (!reclamado) {
      const actual = await this.estadoActual(tenantId, requestId);
      throw new DomainException(
        'IDENTITY_REVIEW_NOT_CLAIMABLE',
        actual === WorkerRunStatus.IN_REVIEW
          ? 'Otra persona ya está revisando este caso.'
          : 'Este caso ya no está esperando revisión.',
        HttpStatus.CONFLICT,
        { status: actual },
      );
    }
    return this.get(tenantId, requestId);
  }

  /**
   * Cierra un caso con la decisión de quien arbitra.
   *
   * Las dos salidas hacen cosas muy distintas y conviene no confundirlas:
   *
   * - **Confirmar** devuelve la ejecución a `QUEUED` con el tipo de documento ya
   *   decidido. El worker la retoma desde el principio y esta vez la puerta no
   *   pregunta: la respuesta ya está dada. Las imágenes siguen ahí porque el
   *   caso nunca se cerró, que es exactamente la razón por la que un pendiente
   *   no las borra.
   * - **Rechazar** cierra en `DOCUMENT_REJECTED` con su motivo y borra las
   *   imágenes, igual que cualquier otro final: la regla de privacidad del
   *   módulo vuelve a aplicar en cuanto hay veredicto.
   *
   * Sólo quien lo reclamó puede cerrarlo. Sin esa segregación, «reclamar» es un
   * botón decorativo y cualquiera con el rol cierra cualquier caso de un tirón.
   */
  async resolve(
    tenantId: bigint,
    requestId: string,
    dto: ResolveIdentityReviewDto,
    principal: AuthenticatedPrincipal,
  ): Promise<IdentityReviewResolvedDto> {
    if (dto.action === 'CONFIRM_DOCUMENT' && dto.documentType === undefined) {
      throw new DomainException(
        'IDENTITY_REVIEW_DOCUMENT_TYPE_REQUIRED',
        'Confirmar el documento exige declarar cuál es: sin tipo no hay analizador y el caso volvería a la misma cola.',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (dto.action === 'REJECT_DOCUMENT' && dto.rejectionReason === undefined) {
      throw new DomainException(
        'IDENTITY_REJECTION_REASON_REQUIRED',
        'Rechazar un documento exige declarar el motivo: un rechazo sin motivo no es medible.',
        HttpStatus.BAD_REQUEST,
      );
    }
    const actual = await this.asignadoA(tenantId, requestId, principal);
    const confirma = dto.action === 'CONFIRM_DOCUMENT';

    await this.prisma.$transaction(async (tx) => {
      await tx.identityVerificationRun.update({
        where: { tenantId_requestId: { tenantId, requestId } },
        data: confirma
          ? {
              status: WorkerRunStatus.QUEUED,
              // El tipo que decidió la persona ES la respuesta: el worker lo lee
              // al retomar y se salta la puerta con él.
              documentType: dto.documentType,
              reviewResolvedBy: principal.id,
              reviewResolvedAt: new Date(),
              reviewNotes: dto.notes,
              // Se limpia el lease y el progreso; el motivo por el que ENTRÓ en
              // la cola se conserva, porque es lo que permite medir meses después
              // qué clase de duda se resolvió cómo.
              progress: 0,
              startedAt: null,
              leaseExpiresAt: null,
              errorCode: null,
              errorMessage: null,
            }
          : {
              status: WorkerRunStatus.DOCUMENT_REJECTED,
              rejectionReason: dto.rejectionReason,
              reviewResolvedBy: principal.id,
              reviewResolvedAt: new Date(),
              reviewNotes: dto.notes,
              finishedAt: new Date(),
              leaseExpiresAt: null,
              documentBytes: null,
              documentBackBytes: null,
              selfieBytes: null,
            },
      });
      await this.audit.append(
        {
          tenantId,
          eventType: 'IDENTITY_REVIEW_RESOLVED',
          aggregateType: 'IdentityVerificationRun',
          aggregateId: requestId,
          actorId: principal.id,
          requestId: principal.requestId,
          payload: {
            action: dto.action,
            reviewReason: actual.reviewReason,
            documentType: dto.documentType ?? null,
            rejectionReason: dto.rejectionReason ?? null,
            arbitrationMode: actual.arbitrationMode,
          },
        },
        tx,
      );
    });

    if (confirma) {
      // Despertar al worker en vez de esperar a su siguiente sondeo: quien está
      // delante del móvil ya lleva minutos esperando por definición.
      // `notifyDetached` y no `notify`: el commit ya ocurrió, y un aviso perdido
      // sólo cuesta un sondeo de retraso — nunca debe tumbar la resolución.
      this.jobSignal.notifyDetached(JobName.IdentityVerification);
    }
    this.logger.log(`Arbitraje de ${requestId} resuelto por ${principal.id} como ${dto.action}.`);
    return {
      requestId,
      status: confirma ? WorkerRunStatus.QUEUED : WorkerRunStatus.DOCUMENT_REJECTED,
      resolvedBy: principal.id,
    };
  }

  private queueWhere(
    tenantId: bigint,
    query: IdentityReviewQueryDto,
  ): Prisma.IdentityVerificationRunWhereInput {
    return {
      tenantId,
      // Siempre acotado a los estados de la cola, incluso cuando el filtro pide
      // uno concreto: es lo que impide que un rechazado se cuele por la URL.
      status: query.status ?? { in: [...IDENTITY_REVIEW_STATUSES] },
      ...(query.category ? { reviewReason: query.category } : {}),
      ...(query.dateFrom || query.dateTo
        ? {
            reviewOpenedAt: {
              ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
              ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
            },
          }
        : {}),
    };
  }

  private async estadoActual(tenantId: bigint, requestId: string) {
    const run = await this.prisma.identityVerificationRun.findFirst({
      where: { tenantId, requestId },
      select: { status: true },
    });
    return run?.status ?? null;
  }

  private async asignadoA(
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

  private toItem(row: QueueRow, now: number): IdentityReviewItemDto {
    return {
      requestId: row.requestId,
      requestedBy: row.requestedBy,
      status: row.status,
      reviewReason: row.reviewReason as IdentityReviewReason,
      reviewPriority: row.reviewPriority,
      arbitrationMode: row.arbitrationMode,
      documentType: row.documentType,
      documentCountry: row.documentCountry,
      documentTypeConfidence:
        row.documentTypeConfidence === null ? null : Number(row.documentTypeConfidence),
      errorCode: row.errorCode,
      errorMessage: row.errorMessage,
      reviewOpenedAt: row.reviewOpenedAt,
      pendingMs: transcurrido(row.reviewOpenedAt, now),
      reviewClaimedBy: row.reviewClaimedBy,
      reviewClaimedAt: row.reviewClaimedAt,
      queuedAt: row.queuedAt,
    };
  }
}

/** Milisegundos desde una marca, o `null` si la marca no existe. */
function transcurrido(desde: Date | null, ahora: number): number | null {
  return desde === null ? null : Math.max(0, ahora - desde.getTime());
}

/** Se re-exporta para que el módulo declare el motivo sin importar Prisma. */
export type { IdentityRejectionReason };
