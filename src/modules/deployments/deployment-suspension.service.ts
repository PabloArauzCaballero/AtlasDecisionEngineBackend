import { HttpStatus, Injectable } from '@nestjs/common';
import { DeploymentStatus, VersionStatus } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { DomainException } from '../../common/errors/domain-exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AdvisoryLockDomain, advisoryLockKey } from '../../common/prisma/advisory-lock';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import { VersionStateService } from '../artifacts/version-state.service';
import { DeploymentCacheInvalidator } from './deployment-cache-invalidator.service';
import { SuspendDeploymentDto } from './deployment.dto';

@Injectable()
export class DeploymentSuspensionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly states: VersionStateService,
    private readonly audit: AuditService,
    private readonly cache: DeploymentCacheInvalidator,
  ) {}

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
    if (!deployment)
      throw new DomainException(
        'DEPLOYMENT_NOT_FOUND',
        'Deployment not found',
        HttpStatus.NOT_FOUND,
      );
    await this.prisma.$transaction(async (tx) => {
      // Same lock key as deploy()/rollback() for this (artifact, environment) pair — see the
      // comment in rollback() for why this must serialize against those.
      const lockKey = advisoryLockKey(
        AdvisoryLockDomain.Deployment,
        deployment.artifactVersion.artifactId,
        deployment.environmentId,
      );
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey})`;
      const freshDeployment = await tx.decisionDeployment.findUniqueOrThrow({
        where: { id: deploymentId },
      });
      if (freshDeployment.deploymentStatus === DeploymentStatus.SUSPENDED) {
        throw new DomainException(
          'DEPLOYMENT_ALREADY_SUSPENDED',
          'Deployment is already suspended',
          HttpStatus.CONFLICT,
        );
      }
      await tx.decisionDeployment.update({
        where: { id: deploymentId },
        data: { deploymentStatus: DeploymentStatus.SUSPENDED, isActive: false },
      });
      if (deployment.artifactVersion.status === VersionStatus.DEPLOYED_TO_PROD) {
        await this.states.transition(
          deployment.artifactVersionId,
          VersionStatus.SUSPENDED,
          principal.id,
          dto.reason,
          tx,
        );
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
    await this.cache.invalidateAfterCommit(
      tenantId,
      deployment.artifactVersion.artifact.artifactCode,
      deployment.environment.code,
    );
    return { deploymentId, status: 'SUSPENDED' };
  }
}
