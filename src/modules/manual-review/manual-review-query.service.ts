import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { DomainException } from '../../common/errors/domain-exception';
import { parseBigIntId } from '../../common/http/id';
import { pageResult, paginationArgs } from '../../common/http/pagination';
import { escapeLikeTerm } from '../../common/persistence/like-escape';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ManualReviewListQueryDto } from './manual-review.dto';

/** Lectura de la cola de revisión manual: listado, resolución de código a id y detalle con traza. */
@Injectable()
export class ManualReviewQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
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

  /** El caso por su id numérico o por su código (`MR-…`): el código es lo que otros sistemas guardan. */
  async resolveCaseId(tenantId: bigint, idOrCode: string): Promise<bigint> {
    if (!/^MR-/i.test(idOrCode)) return parseBigIntId(idOrCode, 'caseId');
    const row = await this.prisma.decisionManualReviewCase.findFirst({
      where: { caseCode: idOrCode.toUpperCase(), tenantId },
      select: { id: true },
    });
    if (!row)
      throw new DomainException(
        'MANUAL_REVIEW_NOT_FOUND',
        'Manual review case not found',
        HttpStatus.NOT_FOUND,
      );
    return row.id;
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
}
