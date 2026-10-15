import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IdentityReviewReason, Prisma, WorkerRunStatus } from '@prisma/client';
import { DomainException } from '../../../../common/errors/domain-exception';
import { pageResult, paginationArgs } from '../../../../common/http/pagination';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import { IDENTITY_REVIEW_STATUSES } from '../identity-outcome';
import type { IdentityReviewCategoryDto, IdentityReviewQueryDto } from './identity-review.dto';
import { QUEUE_SELECTION, toReviewItem, transcurrido } from './identity-review.queue';

/**
 * La cola de arbitraje humano de identidad: lo que se lista, se cuenta y se abre.
 *
 * Es el destinatario de la única franja en la que la puerta de documentos no
 * decide sola. Y **no es el vertedero de lo que el motor no entendió**: lo que
 * llega aquí ya pasó el triage, así que es, por construcción, algo que se parece
 * a un documento de identidad lo bastante como para que una persona pueda
 * confirmarlo mirando. Una factura o una foto de un paisaje se quedan en
 * `DOCUMENT_REJECTED`, en el historial, y ninguna consulta de este servicio
 * puede devolverlas porque todas acotan por `IDENTITY_REVIEW_STATUSES`.
 */
@Injectable()
export class IdentityReviewQueueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
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
      rows.map((row) => toReviewItem(row, now)),
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
      ...toReviewItem(run, Date.now()),
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
}
