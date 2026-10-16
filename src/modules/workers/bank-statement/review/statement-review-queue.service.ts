import { HttpStatus, Injectable } from '@nestjs/common';
import { holderOfRun } from '../../workers.mapper';
import { ConfigService } from '@nestjs/config';
import { Prisma, StatementReviewReason, WorkerRunStatus } from '@prisma/client';
import { DomainException } from '../../../../common/errors/domain-exception';
import { pageResult, paginationArgs } from '../../../../common/http/pagination';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import { REVIEW_STATUSES } from '../statement-outcome';
import { StatementReviewDocuments } from './statement-review-documents.service';
import { QUEUE_SELECTION, elapsed, toReviewItem } from './statement-review.queue';
import type { StatementReviewCategoryDto, StatementReviewQueryDto } from './statement-review.dto';

/**
 * La cola de revisión humana de extractos.
 *
 * Existe porque el motor tiene una franja en la que no debe decidir solo, y
 * porque esa franja **no** puede ser el vertedero de todo lo que no entendió: lo
 * que llega aquí ya pasó el triage (`statement-outcome.ts`) y es, por
 * construcción, razonablemente compatible con un extracto. Un `PDF_INVALID` no
 * entra —queda en el historial como rechazado— y ninguna consulta de este
 * servicio puede devolverlo, porque todas acotan por `REVIEW_STATUSES`.
 *
 * Todo se pagina y se filtra en el servidor. La lista crece con el volumen de
 * subidas y traérsela entera al navegador convertiría la pantalla en inservible
 * justo el día que hay trabajo que hacer.
 */
@Injectable()
export class StatementReviewQueueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly documents: StatementReviewDocuments,
  ) {}

  async list(tenantId: bigint, query: StatementReviewQueryDto) {
    const paging = paginationArgs(query, this.config.get<number>('MAX_PAGE_SIZE') ?? 100);
    const where = this.queueWhere(tenantId, query);
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.bankStatementRun.count({ where }),
      this.prisma.bankStatementRun.findMany({
        where,
        select: QUEUE_SELECTION,
        skip: paging.skip,
        take: paging.take,
        // Prioridad primero y antigüedad después: es el orden en que se trabaja
        // una cola, y el mismo que el índice `…_review_queue_idx` ya materializa.
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
   * Los contadores de las pestañas, en UNA consulta agregada.
   *
   * Vienen del backend y no de contar la página cargada, que es la trampa
   * evidente: la página trae 25 filas y el rótulo diría «Timeout (4)» sobre una
   * cola de cuatrocientos. La fila «Todos» se suma aquí en vez de pedir un
   * agregado más.
   */
  async categories(tenantId: bigint): Promise<StatementReviewCategoryDto[]> {
    const rows = await this.prisma.bankStatementRun.groupBy({
      by: ['reviewReason'],
      where: { tenantId, status: { in: [...REVIEW_STATUSES] } },
      _count: { _all: true },
      _min: { reviewOpenedAt: true },
    });
    const claimed = await this.prisma.bankStatementRun.groupBy({
      by: ['reviewReason'],
      where: { tenantId, status: WorkerRunStatus.IN_REVIEW },
      _count: { _all: true },
    });
    const claimedBy = new Map(claimed.map((row) => [row.reviewReason, row._count._all]));

    const now = Date.now();
    const byCategory = rows
      .filter(
        (row): row is typeof row & { reviewReason: StatementReviewReason } =>
          row.reviewReason !== null,
      )
      .map((row) => ({
        category: row.reviewReason,
        total: row._count._all,
        claimed: claimedBy.get(row.reviewReason) ?? 0,
        oldestPendingMs: elapsed(row._min.reviewOpenedAt, now),
      }));

    const todos: StatementReviewCategoryDto = {
      category: null,
      total: byCategory.reduce((sum, row) => sum + row.total, 0),
      claimed: byCategory.reduce((sum, row) => sum + row.claimed, 0),
      oldestPendingMs: byCategory.reduce<number | null>(
        (oldest, row) =>
          row.oldestPendingMs === null ? oldest : Math.max(oldest ?? 0, row.oldestPendingMs),
        null,
      ),
    };
    // «Todos» primero, y el resto por volumen: la pestaña con más trabajo es la
    // que hay que ver sin buscarla.
    return [todos, ...byCategory.sort((a, b) => b.total - a.total)];
  }

  /** Un caso con todo lo que hace falta para decidirlo. */
  async get(tenantId: bigint, requestId: string) {
    const run = await this.prisma.bankStatementRun.findFirst({
      where: { tenantId, requestId, status: { in: [...REVIEW_STATUSES] } },
      select: {
        ...QUEUE_SELECTION,
        resultJson: true,
        provisionalResultJson: true,
        assignedInstitutionCode: true,
        assignedInstitutionBy: true,
        assignedInstitutionAt: true,
        expectedHolderName: true,
        holderNameRead: true,
        holderVerdict: true,
        warningsJson: true,
        fileSizeBytes: true,
        fileHash: true,
        correlationId: true,
        attemptCount: true,
        reviewNotes: true,
      },
    });
    if (!run) {
      // 404 y no 403 también aquí: un 403 confirmaría que el caso existe y es de
      // otro inquilino, que es justo lo que no debe poder averiguarse.
      throw new DomainException(
        'BANK_STATEMENT_REVIEW_NOT_FOUND',
        'No hay ningún caso de revisión con ese identificador.',
        HttpStatus.NOT_FOUND,
      );
    }
    return {
      ...toReviewItem(run, Date.now()),
      result: run.resultJson,
      /*
       * Lo que el motor leyó aunque no reconociera el emisor: movimientos, ingresos, gastos, categorías
       * y capacidad. Es para DECIDIR, no un resultado aplicado (ver `provisional-analysis.ts`).
       */
      provisional: run.provisionalResultJson,
      assignedInstitution: run.assignedInstitutionCode
        ? {
            code: run.assignedInstitutionCode,
            by: run.assignedInstitutionBy,
            at: run.assignedInstitutionAt,
          }
        : null,
      // De quién es la cuenta: el cliente que lo subió frente a lo que dice la carátula.
      holder: holderOfRun(run),
      warnings: run.warningsJson,
      fileHash: run.fileHash,
      fileSizeBytes: run.fileSizeBytes,
      correlationId: run.correlationId,
      attemptCount: run.attemptCount,
      reviewNotes: run.reviewNotes,
      documentAvailable: await this.documents.isAvailable(tenantId, requestId),
    };
  }

  private queueWhere(
    tenantId: bigint,
    query: StatementReviewQueryDto,
  ): Prisma.BankStatementRunWhereInput {
    const desde = query.dateFrom ? new Date(query.dateFrom) : undefined;
    const hasta = query.dateTo ? new Date(query.dateTo) : undefined;
    return {
      tenantId,
      // El acotamiento a los dos estados de revisión NO es un filtro más: es lo
      // que garantiza que un `PDF_INVALID` jamás aparezca aquí, con filtro o sin
      // él. Por eso se escribe antes que nada y no se deja sobreescribir.
      status: query.status ?? { in: [...REVIEW_STATUSES] },
      ...(query.category ? { reviewReason: query.category } : {}),
      ...(query.bank ? { institutionId: query.bank } : {}),
      ...(query.priority ? { reviewPriority: query.priority } : {}),
      ...(desde || hasta
        ? { reviewOpenedAt: { ...(desde ? { gte: desde } : {}), ...(hasta ? { lte: hasta } : {}) } }
        : {}),
    };
  }
}
