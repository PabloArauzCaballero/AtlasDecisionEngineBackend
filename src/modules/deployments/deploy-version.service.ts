/** Enforces approval, separation of duties and atomic environment-binding invariants. */
import { HttpStatus, Injectable } from '@nestjs/common';
import { DeploymentStatus, Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { OutboxPublisherService } from '../../common/events/outbox-publisher.service';
import { DecisionEventType, type VersionPublishedPayload } from '../../common/events/event-types';
import { DomainException } from '../../common/errors/domain-exception';
import { parseBigIntId } from '../../common/http/id';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AdvisoryLockDomain, advisoryLockKey } from '../../common/prisma/advisory-lock';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import { VersionStateService } from '../artifacts/version-state.service';
import { isVersionContributor } from '../artifacts/version-contributors';
import { GovernanceService } from '../governance/governance.service';
import { BaselineCaptureService } from '../model-monitoring/baseline-capture.service';
import { DeploymentCacheInvalidator } from './deployment-cache-invalidator.service';
import { assertDeployRequestAllowed } from './deploy-request.rules';
import { DeployVersionDto } from './deployment.dto';
import { EconomicContractGate } from './economic-contract.gate';
import { statusForEnvironment } from './status-for-environment';

@Injectable()
export class DeployVersionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly governance: GovernanceService,
    private readonly states: VersionStateService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxPublisherService,
    private readonly baselines: BaselineCaptureService,
    private readonly cache: DeploymentCacheInvalidator,
    private readonly economicContract: EconomicContractGate,
  ) {}

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
    if (!version)
      throw new DomainException(
        'VERSION_NOT_FOUND',
        'Artifact version not found',
        HttpStatus.NOT_FOUND,
      );
    if (await isVersionContributor(this.prisma, version, principal.id)) {
      throw new DomainException(
        'SEPARATION_OF_DUTIES_VIOLATION',
        'The version author cannot deploy the same version alone',
        HttpStatus.FORBIDDEN,
      );
    }
    const environment = await this.prisma.decisionEnvironment.findUnique({
      where: { code: dto.environmentCode },
    });
    if (!environment || environment.status !== 'ACTIVE') {
      throw new DomainException(
        'ENVIRONMENT_NOT_FOUND',
        'Deployment environment not found or inactive',
        HttpStatus.NOT_FOUND,
      );
    }
    await this.economicContract.assert(tenantId, version, environment.isProduction);
    const requestedCompiledArtifactId = dto.compiledArtifactId
      ? parseBigIntId(dto.compiledArtifactId, 'compiledArtifactId')
      : undefined;
    const compiled = requestedCompiledArtifactId
      ? version.compiledArtifacts.find((item) => item.id === requestedCompiledArtifactId)
      : version.compiledArtifacts[0];
    if (!compiled)
      throw new DomainException(
        'COMPILED_ARTIFACT_NOT_FOUND',
        'Compiled artifact not found',
        HttpStatus.CONFLICT,
      );
    assertDeployRequestAllowed(dto);

    const deployment = await this.prisma.$transaction(async (tx) => {
      const deploymentLockKey = advisoryLockKey(
        AdvisoryLockDomain.Deployment,
        version.artifactId,
        environment.id,
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
        statusForEnvironment(environment.code),
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
      // `version.published` es el evento de DOMINIO de la publicación, distinto del apunte
      // de auditoría de arriba: aquél describe la fila de despliegue creada, éste describe
      // que una versión pasó a atender tráfico.
      //
      // Va al OUTBOX, no al registro de auditoría, porque su destinatario es el relay: el
      // proyector de notificaciones escucha ahí para avisar a operaciones. Su rama existía
      // y nunca se ejecutaba —nadie emitía el evento—, así que el aviso "versión publicada"
      // no llegaba a nadie. En la misma transacción que el despliegue: no puede haber
      // publicación sin evento ni evento sin publicación.
      await this.outbox.publish(tx, {
        eventType: DecisionEventType.VERSION_PUBLISHED,
        tenantId,
        aggregateType: 'DecisionArtifactVersion',
        aggregateId: version.id.toString(),
        actorId: principal.id,
        correlationId: principal.requestId,
        payload: {
          versionId: version.id.toString(),
          artifactCode: version.artifact.artifactCode,
          versionNumber: version.versionNumber,
          deploymentId: created.id.toString(),
          environmentCode: environment.code,
        } satisfies VersionPublishedPayload,
      });
      return created;
    });
    // Cache invalidation stays outside the transaction: it is not rollback-able, so it must
    // only run once the deployment is durably committed.
    await this.cache.invalidateAfterCommit(
      tenantId,
      version.artifact.artifactCode,
      environment.code,
    );
    /*
     * Congelar la población de referencia justo aquí, y no antes ni después.
     *
     * Antes sería dentro de la transacción, y un histograma sobre veinte mil filas no puede
     * retener el bloqueo de un despliegue. Después —un trabajo periódico— tomaría la muestra ya
     * contaminada con las primeras ejecuciones de la versión NUEVA, que es medir la deriva
     * contra sí misma.
     *
     * Es best-effort: perder la línea base se arregla recapturándola; abortar un despliegue
     * porque falló un histograma sería un intercambio absurdo.
     */
    await this.baselines.capture(
      tenantId,
      version.id,
      version.artifact.artifactCode,
      environment.id,
      principal.id,
    );
    return deployment;
  }
}
