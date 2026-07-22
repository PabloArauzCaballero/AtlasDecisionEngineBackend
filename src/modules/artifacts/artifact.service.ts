import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, VersionStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { DomainException } from '../../common/errors/domain-exception';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import { ArtifactListQueryDto, CloneVersionDto, CreateArtifactDto } from './artifact.dto';
import { pageResult, paginationArgs } from '../../common/http/pagination';

@Injectable()
export class ArtifactService {
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
          payload: { artifactCode: artifact.artifactCode, artifactType: artifact.artifactType },
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
    return pageResult(items, total, paging.page, paging.pageSize);
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

  async cloneVersion(
    tenantId: bigint,
    sourceVersionId: bigint,
    dto: CloneVersionDto,
    principal: AuthenticatedPrincipal,
  ) {
    const source = await this.prisma.decisionArtifactVersion.findFirst({
      where: { id: sourceVersionId, artifact: { tenantId } },
      include: {
        artifact: { include: { versions: { select: { versionNumber: true } } } },
        variableDependencies: true,
        conditions: true,
        actions: { include: { reasonMappings: true } },
        nodes: { include: { nodeConditions: true, nodeActions: true } },
        edges: { include: { edgeConditions: true } },
      },
    });
    if (!source)
      throw new DomainException(
        'VERSION_NOT_FOUND',
        'Source version not found',
        HttpStatus.NOT_FOUND,
      );
    const nextNumber =
      Math.max(...source.artifact.versions.map((version) => version.versionNumber)) + 1;

    const cloned = await this.prisma.$transaction(async (tx) => {
      const version = await tx.decisionArtifactVersion.create({
        data: {
          artifactId: source.artifactId,
          versionNumber: nextNumber,
          status: VersionStatus.DRAFT,
          sourceVersionId: source.id,
          semanticVersion: dto.semanticVersion ?? this.incrementPatch(source.semanticVersion),
          changeSummary: dto.changeSummary,
          createdBy: principal.id,
          statusHistory: {
            create: {
              fromStatus: null,
              toStatus: VersionStatus.DRAFT,
              changedBy: principal.id,
              reason: `Cloned from version ${source.versionNumber}`,
            },
          },
        },
      });

      await tx.decisionArtifactVariableDependency.createMany({
        data: source.variableDependencies.map((dependency) => ({
          artifactVersionId: version.id,
          variableVersionId: dependency.variableVersionId,
          usageType: dependency.usageType,
          isRequired: dependency.isRequired,
          fallbackPolicy: dependency.fallbackPolicy,
          dependencyPath: dependency.dependencyPath,
        })),
      });
      const conditionMap = new Map<bigint, bigint>();
      for (const condition of source.conditions) {
        const created = await tx.decisionRuleCondition.create({
          data: {
            artifactVersionId: version.id,
            conditionCode: condition.conditionCode,
            name: condition.name,
            expressionType: condition.expressionType,
            expressionJson: condition.expressionJson as Prisma.InputJsonValue,
            severity: condition.severity,
            isReusable: condition.isReusable,
          },
        });
        conditionMap.set(condition.id, created.id);
      }
      const actionMap = new Map<bigint, bigint>();
      for (const action of source.actions) {
        const created = await tx.decisionRuleAction.create({
          data: {
            artifactVersionId: version.id,
            actionCode: action.actionCode,
            actionType: action.actionType,
            payloadSchemaJson: action.payloadSchemaJson ?? undefined,
            payloadTemplateJson: action.payloadTemplateJson as Prisma.InputJsonValue,
            isTerminal: action.isTerminal,
            reasonMappings: {
              create: action.reasonMappings.map((mapping) => ({
                reasonCodeId: mapping.reasonCodeId,
                priority: mapping.priority,
                messageTemplateJson: mapping.messageTemplateJson ?? undefined,
              })),
            },
          },
        });
        actionMap.set(action.id, created.id);
      }
      const nodeMap = new Map<bigint, bigint>();
      for (const node of source.nodes) {
        const created = await tx.decisionRuleNode.create({
          data: {
            artifactVersionId: version.id,
            nodeKey: node.nodeKey,
            nodeType: node.nodeType,
            label: node.label,
            configJson: node.configJson as Prisma.InputJsonValue,
            xPos: node.xPos,
            yPos: node.yPos,
            orderIndex: node.orderIndex,
            isTerminal: node.isTerminal,
          },
        });
        nodeMap.set(node.id, created.id);
      }
      for (const node of source.nodes) {
        const newNodeId = nodeMap.get(node.id)!;
        await tx.decisionNodeCondition.createMany({
          data: node.nodeConditions.map((binding) => ({
            nodeId: newNodeId,
            conditionId: conditionMap.get(binding.conditionId)!,
            evaluationOrder: binding.evaluationOrder,
            expectedBoolean: binding.expectedBoolean,
          })),
        });
        await tx.decisionNodeAction.createMany({
          data: node.nodeActions.map((binding) => ({
            nodeId: newNodeId,
            actionId: actionMap.get(binding.actionId)!,
            executionOrder: binding.executionOrder,
          })),
        });
      }
      for (const edge of source.edges) {
        const created = await tx.decisionRuleEdge.create({
          data: {
            artifactVersionId: version.id,
            fromNodeId: nodeMap.get(edge.fromNodeId)!,
            toNodeId: nodeMap.get(edge.toNodeId)!,
            edgeKey: edge.edgeKey,
            edgeType: edge.edgeType,
            priority: edge.priority,
            isDefault: edge.isDefault,
          },
        });
        await tx.decisionEdgeCondition.createMany({
          data: edge.edgeConditions.map((binding) => ({
            edgeId: created.id,
            conditionId: conditionMap.get(binding.conditionId)!,
            evaluationOrder: binding.evaluationOrder,
          })),
        });
      }
      await this.audit.append(
        {
          tenantId,
          eventType: 'ARTIFACT_VERSION_CLONED',
          aggregateType: 'ArtifactVersion',
          aggregateId: version.id.toString(),
          actorId: principal.id,
          requestId: principal.requestId,
          payload: { sourceVersionId: source.id.toString(), versionNumber: version.versionNumber },
        },
        tx,
      );
      return version;
    });

    return cloned;
  }

  private incrementPatch(semanticVersion: string): string {
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(semanticVersion);
    if (!match) return semanticVersion;
    return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
  }
}
