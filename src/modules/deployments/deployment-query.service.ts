import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { pageResult, paginationArgs } from '../../common/http/pagination';
import { PrismaService } from '../../common/prisma/prisma.service';
import { DeploymentListQueryDto } from './deployment.dto';

@Injectable()
export class DeploymentQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  listEnvironments() {
    return this.prisma.decisionEnvironment.findMany({ orderBy: { id: 'asc' } });
  }

  async list(tenantId: bigint, query: DeploymentListQueryDto) {
    const paging = paginationArgs(query, this.config.get<number>('MAX_PAGE_SIZE') ?? 100);
    const where: Prisma.DecisionDeploymentWhereInput = {
      ...(query.status ? { deploymentStatus: query.status } : {}),
      ...(query.environmentCode ? { environment: { code: query.environmentCode } } : {}),
      artifactVersion: {
        artifact: {
          tenantId,
          ...(query.artifactCode ? { artifactCode: query.artifactCode } : {}),
        },
      },
    };
    const [total, items] = await this.prisma.$transaction([
      this.prisma.decisionDeployment.count({ where }),
      this.prisma.decisionDeployment.findMany({
        where,
        skip: paging.skip,
        take: paging.take,
        include: {
          environment: true,
          artifactVersion: { include: { artifact: true } },
          traffic: true,
        },
        orderBy: [{ deployedAt: 'desc' }, { id: 'desc' }],
      }),
    ]);
    return pageResult(items, total, paging.page, paging.pageSize);
  }
}
