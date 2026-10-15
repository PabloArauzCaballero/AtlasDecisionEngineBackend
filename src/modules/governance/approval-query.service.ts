import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DomainException } from '../../common/errors/domain-exception';
import { pageResult, paginationArgs } from '../../common/http/pagination';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ApprovalRequestListQueryDto } from './governance.dto';

@Injectable()
export class ApprovalQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async listRequests(tenantId: bigint, query: ApprovalRequestListQueryDto) {
    const { skip, take, page, pageSize } = paginationArgs(
      query,
      this.config.get<number>('MAX_PAGE_SIZE') ?? 100,
    );
    const where = { artifactVersion: { artifact: { tenantId } } };
    const [requests, total] = await this.prisma.$transaction([
      this.prisma.decisionApprovalRequest.findMany({
        where,
        include: {
          artifactVersion: { include: { artifact: true } },
          steps: { orderBy: { stepOrder: 'asc' } },
        },
        orderBy: { requestedAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.decisionApprovalRequest.count({ where }),
    ]);
    const items = requests.map((request) => {
      const currentStep = request.steps.find((step) => step.status === 'PENDING');
      const overdue = Boolean(
        request.dueAt && request.dueAt.getTime() < Date.now() && request.status === 'IN_REVIEW',
      );
      return {
        ...request,
        artifactCode: request.artifactVersion.artifact.artifactCode,
        versionNumber: request.artifactVersion.versionNumber,
        createdAt: request.requestedAt,
        currentStep: currentStep?.requiredRole ?? request.status,
        slaStatus: overdue ? 'OVERDUE' : 'ON_TRACK',
      };
    });
    return pageResult(items, total, page, pageSize);
  }

  async getRequest(tenantId: bigint, requestId: bigint) {
    const request = await this.prisma.decisionApprovalRequest.findFirst({
      where: { id: requestId, artifactVersion: { artifact: { tenantId } } },
      include: {
        artifactVersion: { include: { artifact: true } },
        steps: {
          orderBy: { stepOrder: 'asc' },
          include: {
            decisions: {
              include: { evidence: true },
              orderBy: { decidedAt: 'asc' },
            },
          },
        },
      },
    });
    if (!request)
      throw new DomainException(
        'APPROVAL_REQUEST_NOT_FOUND',
        'Approval request not found',
        HttpStatus.NOT_FOUND,
      );
    return request;
  }
}
