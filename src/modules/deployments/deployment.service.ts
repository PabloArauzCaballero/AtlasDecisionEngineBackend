import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DeploymentStatus, Prisma, VersionStatus } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { DomainException } from '../../common/errors/domain-exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import { VersionStateService } from '../artifacts/version-state.service';
import { GovernanceService } from '../governance/governance.service';
import { DeployVersionDto, DeploymentListQueryDto, RollbackDeploymentDto, SuspendDeploymentDto } from './deployment.dto';
import { pageResult, paginationArgs } from '../../common/http/pagination';
import { DeploymentResolverService } from './deployment-resolver.service';

@Injectable()
export class DeploymentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly governance: GovernanceService,
    private readonly states: VersionStateService,
    private readonly resolver: DeploymentResolverService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  listEnvironments() {
    return this.prisma.decisionEnvironment.findMany({ orderBy: { id: 'asc' } });
  }

  async deploy(
    tenantId: bigint,
    versionId: bigint,
    dto: DeployVersionDto,
    principal: AuthenticatedPrincipal,
  ) {
    await this.governance.assertApproved(tenantId, versionId);
    const version = await this.prisma.decisionArtifactVersion.findFirst({
      where: { id: versionId, artifact: { tenantId } },
      include: {
        artifact: true,
        compiledArtifacts: { where: { compileStatus: 'SUCCESS' }, orderBy: { compiledAt: 'desc' } },
      },
    });
    if (!version) throw new DomainException('VERSION_NOT_FOUND', 'Artifact version not found', HttpStatus.NOT_FOUND);
    if (version.createdBy === principal.id) {
      throw new DomainException('SEPARATION_OF_DUTIES_VIOLATION', 'The version author cannot deploy the same version alone', HttpStatus.FORBIDDEN);
    }
    const environment = await this.prisma.decisionEnvironment.findUnique({ where: { code: dto.environmentCode } });
    if (!environment || environment.status !== 'ACTIVE') {
      throw new DomainException('ENVIRONMENT_NOT_FOUND', 'Deployment environment not found or inactive', HttpStatus.NOT_FOUND);
    }
    const requestedCompiledArtifactId = dto.compiledArtifactId
      ? BigInt(dto.compiledArtifactId)
      : undefined;
    const compiled = requestedCompiledArtifactId
      ? version.compiledArtifacts.find((item) => item.id === requestedCompiledArtifactId)
      : version.compiledArtifacts[0];
    if (!compiled) throw new DomainException('COMPILED_ARTIFACT_NOT_FOUND', 'Compiled artifact not found', HttpStatus.CONFLICT);
    if (dto.traffic.length) {
      const total = dto.traffic.reduce((sum, rule) => sum + rule.trafficPercentage, 0);
      if (Math.abs(total - 100) > 0.001) {
        throw new DomainException('INVALID_TRAFFIC_PERCENTAGE', 'Traffic percentages must total 100');
      }
    }

    const deployment = await this.prisma.$transaction(async (tx) => {
      const deploymentLockKey = BigInt.asIntN(
        64,
        (version.artifactId << 32n) ^ environment.id,
      );
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${deploymentLockKey})`;
      const previous = await tx.decisionDeployment.findFirst({
        where: {
          environmentId: environment.id,
          isActive: true,
          artifactVersion: { artifactId: version.artifactId },
        },
        orderBy: { deployedAt: 'desc' },
      });
      if (previous) {
        await tx.decisionDeployment.update({
          where: { id: previous.id },
          data: {
            isActive: false,
            deploymentStatus: DeploymentStatus.SUPERSEDED,
            effectiveTo: new Date(),
          },
        });
      }
      const created = await tx.decisionDeployment.create({
        data: {
          artifactVersionId: version.id,
          compiledArtifactId: compiled.id,
          environmentId: environment.id,
          deploymentMode: dto.deploymentMode,
          deploymentStatus: DeploymentStatus.ACTIVE,
          effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : new Date(),
          effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : undefined,
          isActive: true,
          previousDeploymentId: previous?.id,
          deployedBy: principal.id,
          traffic: {
            create: dto.traffic.map((rule) => ({
              segmentKey: rule.segmentKey,
              trafficPercentage: rule.trafficPercentage,
              routingExpressionJson: rule.routingExpression as Prisma.InputJsonValue | undefined,
              priority: rule.priority,
            })),
          },
        },
        include: { traffic: true, environment: true },
      });
      await tx.decisionRuntimeBinding.upsert({
        where: {
          tenantId_artifactCode_environmentId_bindingKey: {
            tenantId,
            artifactCode: version.artifact.artifactCode,
            environmentId: environment.id,
            bindingKey: 'default',
          },
        },
        create: {
          tenantId,
          artifactCode: version.artifact.artifactCode,
          environmentId: environment.id,
          activeDeploymentId: created.id,
          bindingKey: 'default',
        },
        update: { activeDeploymentId: created.id },
      });
      await this.states.transition(
        version.id,
        this.statusForEnvironment(environment.code),
        principal.id,
        `Deployed to ${environment.code}`,
        tx,
      );
      await this.audit.append(
        {
          tenantId,
          eventType: 'DEPLOYMENT_ACTIVATED',
          aggregateType: 'Deployment',
          aggregateId: created.id.toString(),
          actorId: principal.id,
          requestId: principal.requestId,
          payload: {
            artifactCode: version.artifact.artifactCode,
            versionId: version.id.toString(),
            environment: environment.code,
            checksum: compiled.compiledChecksum,
            previousDeploymentId: created.previousDeploymentId?.toString() ?? null,
          },
        },
        tx,
      );
      return created;
    });
    // Cache invalidation stays outside the transaction: it is not rollback-able, so it must
    // only run once the deployment is durably committed.
    await this.resolver.invalidate(tenantId, version.artifact.artifactCode, environment.code);
    return deployment;
  }

  async rollback(
    tenantId: bigint,
    deploymentId: bigint,
    dto: RollbackDeploymentDto,
    principal: AuthenticatedPrincipal,
  ) {
    const current = await this.prisma.decisionDeployment.findFirst({
      where: { id: deploymentId, artifactVersion: { artifact: { tenantId } } },
      include: { artifactVersion: { include: { artifact: true } }, environment: true, previousDeployment: true },
    });
    if (!current) throw new DomainException('DEPLOYMENT_NOT_FOUND', 'Deployment not found', HttpStatus.NOT_FOUND);
    if (!current.previousDeploymentId || !current.previousDeployment) {
      throw new DomainException('ROLLBACK_TARGET_NOT_FOUND', 'No previous deployment is available', HttpStatus.CONFLICT);
    }
    const previous = current.previousDeployment;
    await this.prisma.$transaction(async (tx) => {
      await tx.decisionDeployment.update({
        where: { id: current.id },
        data: {
          isActive: false,
          deploymentStatus: DeploymentStatus.ROLLED_BACK,
          effectiveTo: new Date(),
        },
      });
      await tx.decisionDeployment.update({
        where: { id: previous.id },
        data: {
          isActive: true,
          deploymentStatus: DeploymentStatus.ACTIVE,
          effectiveTo: null,
        },
      });
      await tx.decisionRuntimeBinding.update({
        where: {
          tenantId_artifactCode_environmentId_bindingKey: {
            tenantId,
            artifactCode: current.artifactVersion.artifact.artifactCode,
            environmentId: current.environmentId,
            bindingKey: 'default',
          },
        },
        data: { activeDeploymentId: previous.id },
      });
      const currentVersion = await tx.decisionArtifactVersion.findUniqueOrThrow({ where: { id: current.artifactVersionId } });
      if (currentVersion.status !== VersionStatus.APPROVED) {
        await this.states.transition(current.artifactVersionId, VersionStatus.APPROVED, principal.id, `Rolled back: ${dto.reason}`, tx);
      }
      await this.audit.append(
        {
          tenantId,
          eventType: 'DEPLOYMENT_ROLLED_BACK',
          aggregateType: 'Deployment',
          aggregateId: current.id.toString(),
          actorId: principal.id,
          requestId: principal.requestId,
          payload: { restoredDeploymentId: previous.id.toString(), reason: dto.reason },
        },
        tx,
      );
    });
    await this.resolver.invalidate(tenantId, current.artifactVersion.artifact.artifactCode, current.environment.code);
    return { rolledBackDeploymentId: current.id, activeDeploymentId: previous.id };
  }

  async suspend(
    tenantId: bigint,
    deploymentId: bigint,
    dto: SuspendDeploymentDto,
    principal: AuthenticatedPrincipal,
  ) {
    const deployment = await this.prisma.decisionDeployment.findFirst({
      where: { id: deploymentId, artifactVersion: { artifact: { tenantId } } },
      include: { artifactVersion: { include: { artifact: true } }, environment: true },
    });
    if (!deployment) throw new DomainException('DEPLOYMENT_NOT_FOUND', 'Deployment not found', HttpStatus.NOT_FOUND);
    await this.prisma.$transaction(async (tx) => {
      await tx.decisionDeployment.update({
        where: { id: deploymentId },
        data: { deploymentStatus: DeploymentStatus.SUSPENDED, isActive: false },
      });
      if (deployment.artifactVersion.status === VersionStatus.DEPLOYED_TO_PROD) {
        await this.states.transition(deployment.artifactVersionId, VersionStatus.SUSPENDED, principal.id, dto.reason, tx);
      }
      await this.audit.append(
        {
          tenantId,
          eventType: 'DEPLOYMENT_SUSPENDED',
          aggregateType: 'Deployment',
          aggregateId: deployment.id.toString(),
          actorId: principal.id,
          requestId: principal.requestId,
          payload: { reason: dto.reason },
        },
        tx,
      );
    });
    await this.resolver.invalidate(tenantId, deployment.artifactVersion.artifact.artifactCode, deployment.environment.code);
    return { deploymentId, status: 'SUSPENDED' };
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

  private statusForEnvironment(code: string): VersionStatus {
    switch (code.toUpperCase()) {
      case 'SANDBOX':
        return VersionStatus.DEPLOYED_TO_SANDBOX;
      case 'TEST':
        return VersionStatus.DEPLOYED_TO_TEST;
      case 'PROD':
      case 'PRODUCTION':
        return VersionStatus.DEPLOYED_TO_PROD;
      default:
        return VersionStatus.DEPLOYED_TO_TEST;
    }
  }
}
