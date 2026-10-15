import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { pageResult, paginationArgs } from '../../common/http/pagination';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import { CreateReasonCodeDto, ReasonCodeListQueryDto } from './variable.dto';

/** Catálogo de códigos de motivo que las acciones del grafo pueden citar. */
@Injectable()
export class ReasonCodeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  async createReasonCode(
    tenantId: bigint,
    dto: CreateReasonCodeDto,
    principal: AuthenticatedPrincipal,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const reason = await tx.decisionReasonCode.create({
        data: {
          tenantId,
          reasonCode: dto.reasonCode,
          category: dto.category,
          publicMessage: dto.publicMessage,
          internalMessage: dto.internalMessage,
          severity: dto.severity,
          isAdverseAction: dto.isAdverseAction,
        },
      });
      await this.audit.append(
        {
          tenantId,
          eventType: 'REASON_CODE_CREATED',
          aggregateType: 'ReasonCode',
          aggregateId: reason.id.toString(),
          actorId: principal.id,
          requestId: principal.requestId,
          payload: { reasonCode: reason.reasonCode, category: reason.category },
        },
        tx,
      );
      return reason;
    });
  }

  async listReasonCodes(tenantId: bigint, query: ReasonCodeListQueryDto) {
    const paging = paginationArgs(query, this.config.get<number>('MAX_PAGE_SIZE') ?? 100);
    const where: Prisma.DecisionReasonCodeWhereInput = {
      tenantId,
      isActive: true,
      ...(query.category ? { category: query.category } : {}),
      ...(query.search
        ? {
            OR: [
              { reasonCode: { contains: query.search, mode: 'insensitive' } },
              { publicMessage: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [total, items] = await this.prisma.$transaction([
      this.prisma.decisionReasonCode.count({ where }),
      this.prisma.decisionReasonCode.findMany({
        where,
        skip: paging.skip,
        take: paging.take,
        orderBy: [{ category: 'asc' }, { reasonCode: 'asc' }],
      }),
    ]);
    return pageResult(items, total, paging.page, paging.pageSize);
  }
}
