import { HttpStatus, Injectable } from '@nestjs/common';
import { DeploymentStatus, VersionStatus } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { DomainException } from '../../common/errors/domain-exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AdvisoryLockDomain, advisoryLockKey } from '../../common/prisma/advisory-lock';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import { VersionStateService } from '../artifacts/version-state.service';
import { DeploymentCacheInvalidator } from './deployment-cache-invalidator.service';
import { RollbackDeploymentDto } from './deployment.dto';

@Injectable()
export class DeploymentRollbackService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly states: VersionStateService,
    private readonly audit: AuditService,
    private readonly cache: DeploymentCacheInvalidator,
  ) {}

  async rollback(
    tenantId: bigint,
    deploymentId: bigint,
    dto: RollbackDeploymentDto,
    principal: AuthenticatedPrincipal,
  ) {
    const current = await this.prisma.decisionDeployment.findFirst({
      where: { id: deploymentId, artifactVersion: { artifact: { tenantId } } },
      include: {
        artifactVersion: { include: { artifact: true } },
        environment: true,
        previousDeployment: true,
      },
    });
    if (!current)
      throw new DomainException(
        'DEPLOYMENT_NOT_FOUND',
        'Deployment not found',
        HttpStatus.NOT_FOUND,
      );
    if (!current.previousDeploymentId || !current.previousDeployment) {
      throw new DomainException(
        'ROLLBACK_TARGET_NOT_FOUND',
        'No previous deployment is available',
        HttpStatus.CONFLICT,
      );
    }
    const previous = current.previousDeployment;
    await this.prisma.$transaction(async (tx) => {
      // Same lock key as deploy() for this (artifact, environment) pair: without it, a
      // concurrent deploy()/rollback()/suspend() on the same environment could both read
      // `current` as active and each commit their own view of the "previous" deployment,
      // leaving two deployments active or the runtime binding pointing at a stale one.
      const lockKey = advisoryLockKey(
        AdvisoryLockDomain.Deployment,
        current.artifactVersion.artifactId,
        current.environmentId,
      );
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey})`;
      const freshCurrent = await tx.decisionDeployment.findUniqueOrThrow({
        where: { id: current.id },
      });
      if (!freshCurrent.isActive) {
        throw new DomainException(
          'DEPLOYMENT_NOT_ACTIVE',
          'Deployment is no longer the active deployment for this environment',
          HttpStatus.CONFLICT,
        );
      }
      /*
       * Sólo se vuelve a un despliegue que salió de servicio por SUPERSEDED. Uno SUSPENDED fue
       * sacado a propósito (por un defecto, por una orden de operaciones): reactivarlo en un
       * rollback devolvería al aire justo la versión que alguien apagó.
       */
      const freshPrevious = await tx.decisionDeployment.findUniqueOrThrow({
        where: { id: previous.id },
      });
      if (freshPrevious.deploymentStatus !== DeploymentStatus.SUPERSEDED) {
        throw new DomainException(
          'ROLLBACK_TARGET_NOT_AVAILABLE',
          `El despliegue anterior está ${freshPrevious.deploymentStatus} y no puede reactivarse ` +
            'con un rollback.',
          HttpStatus.CONFLICT,
          { previousDeploymentId: previous.id.toString() },
        );
      }
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
      const currentVersion = await tx.decisionArtifactVersion.findUniqueOrThrow({
        where: { id: current.artifactVersionId },
      });
      if (currentVersion.status !== VersionStatus.APPROVED) {
        await this.states.transition(
          current.artifactVersionId,
          VersionStatus.APPROVED,
          principal.id,
          `Rolled back: ${dto.reason}`,
          tx,
        );
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
    await this.cache.invalidateAfterCommit(
      tenantId,
      current.artifactVersion.artifact.artifactCode,
      current.environment.code,
    );
    return { rolledBackDeploymentId: current.id, activeDeploymentId: previous.id };
  }
}
