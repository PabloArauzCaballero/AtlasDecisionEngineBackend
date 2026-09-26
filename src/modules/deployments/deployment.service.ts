/** Enforces approval, separation of duties and atomic environment-binding invariants. */
import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DecisionKind, DeploymentStatus, Prisma, VersionStatus } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { OutboxPublisherService } from '../../common/events/outbox-publisher.service';
import { DecisionEventType, type VersionPublishedPayload } from '../../common/events/event-types';
import { DomainException } from '../../common/errors/domain-exception';
import { parseBigIntId } from '../../common/http/id';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AdvisoryLockDomain, advisoryLockKey } from '../../common/prisma/advisory-lock';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import { VersionStateService } from '../artifacts/version-state.service';
import { GovernanceService } from '../governance/governance.service';
import {
  DeployVersionDto,
  DeploymentListQueryDto,
  RollbackDeploymentDto,
  SuspendDeploymentDto,
} from './deployment.dto';
import { pageResult, paginationArgs } from '../../common/http/pagination';
import { BaselineCaptureService } from '../model-monitoring/baseline-capture.service';
import { reviewEconomicContract } from '../risk-governance/semantic-outputs';
import { DeploymentResolverService } from './deployment-resolver.service';

@Injectable()
export class DeploymentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly governance: GovernanceService,
    private readonly states: VersionStateService,
    private readonly resolver: DeploymentResolverService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxPublisherService,
    private readonly config: ConfigService,
    private readonly baselines: BaselineCaptureService,
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
    if (!version)
      throw new DomainException(
        'VERSION_NOT_FOUND',
        'Artifact version not found',
        HttpStatus.NOT_FOUND,
      );
    if (version.createdBy === principal.id) {
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
    await this.assertEconomicContract(tenantId, version, environment.isProduction);
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
    if (dto.traffic.length) {
      const total = dto.traffic.reduce((sum, rule) => sum + rule.trafficPercentage, 0);
      if (Math.abs(total - 100) > 0.001) {
        throw new DomainException(
          'INVALID_TRAFFIC_PERCENTAGE',
          'Traffic percentages must total 100',
        );
      }
    }

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
    await this.resolver.invalidate(tenantId, version.artifact.artifactCode, environment.code);
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

  /**
   * Un artefacto que ORIGINA crédito no llega a producción sin declarar su riesgo.
   *
   * Es el gate económico del plan, y sólo actúa en producción a propósito: en sandbox se
   * experimenta, y exigir el contrato completo para probar una idea sólo conseguiría que la
   * gente probara en producción.
   *
   * La salida legítima no es una exención escondida: es declarar `decisionKind` de verdad. Un
   * artefacto que no origina crédito no tiene por qué publicar una probabilidad de
   * incumplimiento, y decirlo así queda en el esquema, en la auditoría y en la pantalla — al
   * contrario que una casilla «saltar comprobación», que nadie vuelve a mirar.
   */
  private async assertEconomicContract(
    tenantId: bigint,
    version: { id: bigint; artifact: { decisionKind: DecisionKind } },
    isProduction: boolean,
  ): Promise<void> {
    if (!isProduction) return;
    const fields = await this.prisma.decisionOutputContractField.findMany({
      where: { tenantId, artifactVersionId: version.id },
      select: { fieldCode: true, semanticRole: true },
    });
    const problems = reviewEconomicContract(
      fields,
      version.artifact.decisionKind === DecisionKind.ORIGINATION,
    );
    if (!problems.length) return;
    throw new DomainException(
      'ECONOMIC_CONTRACT_INCOMPLETE',
      `${problems.join(' ')} Si esta decisión no origina crédito, decláralo en su ` +
        `\`decisionKind\` en vez de publicar un contrato económico incompleto.`,
      HttpStatus.CONFLICT,
      { problems },
    );
  }

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
    await this.resolver.invalidate(
      tenantId,
      current.artifactVersion.artifact.artifactCode,
      current.environment.code,
    );
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
    await this.resolver.invalidate(
      tenantId,
      deployment.artifactVersion.artifact.artifactCode,
      deployment.environment.code,
    );
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

  /**
   * Traduce el código del ambiente al estado que queda escrito en la versión.
   *
   * `SANDBOX` era el nombre de `DEV` antes de que hubiera cuatro ambientes, y se
   * sigue aceptando porque una instalación puede tener esa fila en su catálogo:
   * caer al `default` la habría marcado como desplegada en TEST, que es mentira
   * y además una mentira invisible.
   */
  private statusForEnvironment(code: string): VersionStatus {
    switch (code.toUpperCase()) {
      case 'DEV':
      case 'DEVELOPMENT':
      case 'SANDBOX':
        return VersionStatus.DEPLOYED_TO_DEV;
      case 'STAGING':
        return VersionStatus.DEPLOYED_TO_STAGING;
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
