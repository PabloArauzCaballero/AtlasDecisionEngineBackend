import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, VersionStatus } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { DomainException } from '../../common/errors/domain-exception';
import { pageResult, paginationArgs } from '../../common/http/pagination';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import { ArtifactListQueryDto, CreateArtifactDto } from './artifact.dto';

@Injectable()
export class ArtifactCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  async create(tenantId: bigint, dto: CreateArtifactDto, principal: AuthenticatedPrincipal) {
    return this.prisma.$transaction(async (tx) => {
      const artifact = await tx.decisionArtifact.create({
        data: {
          tenantId,
          artifactCode: dto.artifactCode,
          artifactType: dto.artifactType,
          name: dto.name,
          description: dto.description,
          ownerTeam: dto.ownerTeam,
          businessPurpose: dto.businessPurpose,
          riskDomain: dto.riskDomain,
          decisionKind: dto.decisionKind,
          versions: {
            create: {
              versionNumber: 1,
              semanticVersion: dto.semanticVersion ?? '0.1.0',
              changeSummary: 'Initial draft',
              createdBy: principal.id,
              statusHistory: {
                create: {
                  fromStatus: null,
                  toStatus: VersionStatus.DRAFT,
                  changedBy: principal.id,
                  reason: 'Artifact created',
                },
              },
            },
          },
        },
        include: { versions: true },
      });
      await this.audit.append(
        {
          tenantId,
          eventType: 'ARTIFACT_CREATED',
          aggregateType: 'DecisionArtifact',
          aggregateId: artifact.id.toString(),
          actorId: principal.id,
          requestId: principal.requestId,
          payload: {
            artifactCode: artifact.artifactCode,
            artifactType: artifact.artifactType,
            decisionKind: artifact.decisionKind,
          },
        },
        tx,
      );
      return artifact;
    });
  }

  async list(tenantId: bigint, query: ArtifactListQueryDto) {
    const paging = paginationArgs(query, this.config.get<number>('MAX_PAGE_SIZE') ?? 100);
    const where: Prisma.DecisionArtifactWhereInput = {
      tenantId,
      isActive: true,
      ...(query.status ? { versions: { some: { status: query.status } } } : {}),
      ...(query.search
        ? {
            OR: [
              { artifactCode: { contains: query.search, mode: 'insensitive' } },
              { name: { contains: query.search, mode: 'insensitive' } },
              { ownerTeam: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [total, items] = await this.prisma.$transaction([
      this.prisma.decisionArtifact.count({ where }),
      this.prisma.decisionArtifact.findMany({
        where,
        skip: paging.skip,
        take: paging.take,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        include: {
          versions: {
            orderBy: { versionNumber: 'desc' },
            take: 5,
            select: {
              id: true,
              versionNumber: true,
              semanticVersion: true,
              status: true,
              lockVersion: true,
              createdBy: true,
              createdAt: true,
              approvedAt: true,
            },
          },
        },
      }),
    ]);
    // Se aplana la versión más reciente a columnas de la tabla (Version, Status,
    // Environment, Last Val). Antes el frontend recibía las versiones anidadas y
    // esas columnas salían vacías. `name`/`artifactType`/`ownerTeam` ya venían
    // planas del artefacto base.
    const mapped = items.map((artifact) => {
      const latest = artifact.versions[0];
      return {
        id: artifact.id,
        artifactCode: artifact.artifactCode,
        name: artifact.name,
        artifactType: artifact.artifactType,
        ownerTeam: artifact.ownerTeam,
        latestVersion: latest?.semanticVersion ?? (latest ? `v${latest.versionNumber}` : null),
        latestStatus: latest?.status ?? null,
        environmentCode: deriveEnvironmentFromStatus(latest?.status),
        lastValidatedAt: latest?.approvedAt ?? null,
      };
    });
    return pageResult(mapped, total, paging.page, paging.pageSize);
  }

  async get(tenantId: bigint, artifactId: bigint) {
    const artifact = await this.prisma.decisionArtifact.findFirst({
      where: { id: artifactId, tenantId },
      include: {
        versions: {
          orderBy: { versionNumber: 'desc' },
          include: {
            compiledArtifacts: { orderBy: { compiledAt: 'desc' }, take: 1 },
            deployments: { include: { environment: true }, orderBy: { deployedAt: 'desc' } },
          },
        },
      },
    });
    if (!artifact)
      throw new DomainException('ARTIFACT_NOT_FOUND', 'Artifact not found', HttpStatus.NOT_FOUND);
    return artifact;
  }

  async getVersion(tenantId: bigint, versionId: bigint) {
    const version = await this.prisma.decisionArtifactVersion.findFirst({
      where: { id: versionId, artifact: { tenantId } },
      include: {
        artifact: true,
        compiledArtifacts: { orderBy: { compiledAt: 'desc' } },
        statusHistory: { orderBy: { changedAt: 'asc' } },
        approvalRequests: {
          include: { steps: { include: { decisions: { include: { evidence: true } } } } },
        },
      },
    });
    if (!version)
      throw new DomainException(
        'VERSION_NOT_FOUND',
        'Artifact version not found',
        HttpStatus.NOT_FOUND,
      );
    return version;
  }
}

/**
 * El ambiente vigente de un artefacto se infiere del estado de su versión más
 * reciente (`DEPLOYED_TO_PROD` → PROD, etc.). Los estados no desplegados no
 * tienen ambiente asociado y devuelven null (la tabla lo pinta como "—").
 */
function deriveEnvironmentFromStatus(status?: string | null): string | null {
  if (!status) return null;
  const deployed = /^DEPLOYED_TO_(.+)$/.exec(String(status));
  return deployed ? deployed[1] : null;
}
