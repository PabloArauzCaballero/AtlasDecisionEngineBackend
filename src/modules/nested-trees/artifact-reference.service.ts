import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { DomainException } from '../../common/errors/domain-exception';
import { parseBigIntId } from '../../common/http/id';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import { CreateArtifactReferenceDto, UpdateArtifactReferenceDto } from './nested-tree.dto';
import { ReferenceChildValidator } from './reference-child-validator.service';
import { ReferenceCycleGuard } from './reference-cycle-guard.service';
import { ReferenceOwnershipService } from './reference-ownership.service';

/** Alta, cambio, baja y listado de las referencias de una versión padre editable. */
@Injectable()
export class ArtifactReferenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    private readonly ownership: ReferenceOwnershipService,
    private readonly children: ReferenceChildValidator,
    private readonly cycles: ReferenceCycleGuard,
  ) {}

  async create(
    tenantId: bigint,
    parentVersionId: bigint,
    dto: CreateArtifactReferenceDto,
    principal: AuthenticatedPrincipal,
  ) {
    const parentVersion = await this.ownership.assertEditableParentVersion(
      tenantId,
      parentVersionId,
    );
    const childArtifactId = parseBigIntId(dto.childArtifactId, 'childArtifactId');
    const childVersionId = parseBigIntId(dto.childArtifactVersionId, 'childArtifactVersionId');
    await this.children.assertReferencableChild(
      tenantId,
      parentVersion.artifactId,
      childArtifactId,
      childVersionId,
    );
    await this.cycles.assertNoCycleOrDepthOverflow(
      tenantId,
      parentVersion.artifactId,
      childArtifactId,
    );
    this.children.assertVersionPolicy(dto);
    await this.children.assertCompatibleContracts(
      parentVersionId,
      childVersionId,
      dto.inputMapping,
      dto.outputMapping,
    );

    const reference = await this.prisma.$transaction(async (tx) => {
      const created = await tx.decisionArtifactReference.create({
        data: {
          tenantId,
          parentArtifactVersionId: parentVersionId,
          nodeKey: dto.nodeKey,
          childArtifactId,
          childArtifactVersionId: childVersionId,
          inputMappingJson: dto.inputMapping as unknown as Prisma.InputJsonValue,
          outputMappingJson: dto.outputMapping as unknown as Prisma.InputJsonValue,
          timeoutMs:
            dto.timeoutMs ?? this.config.get<number>('NESTED_TREE_DEFAULT_TIMEOUT_MS') ?? 2000,
          onErrorPolicy: dto.onErrorPolicy ?? 'FAIL',
          fallbackOutputJson: dto.fallbackOutput as unknown as Prisma.InputJsonValue | undefined,
          requiredRole: dto.requiredRole,
          environmentCode: dto.environmentCode,
          versionSelection: dto.versionSelection ?? 'EXACT',
          maxRetries: dto.maxRetries ?? 0,
          retryDelayMs: dto.retryDelayMs ?? 0,
          executionConditionJson: dto.executionCondition as unknown as
            Prisma.InputJsonValue | undefined,
          isRequired: dto.isRequired ?? true,
          tracePolicy: dto.tracePolicy ?? 'FULL',
          createdBy: principal.id,
        },
      });
      await this.audit.append(
        {
          tenantId,
          eventType: 'ARTIFACT_REFERENCE_CREATED',
          aggregateType: 'DecisionArtifactVersion',
          aggregateId: parentVersionId.toString(),
          actorId: principal.id,
          requestId: principal.requestId,
          payload: {
            nodeKey: dto.nodeKey,
            childArtifactId: childArtifactId.toString(),
            childArtifactVersionId: childVersionId.toString(),
          },
        },
        tx,
      );
      return created;
    });
    return reference;
  }

  async update(
    tenantId: bigint,
    parentVersionId: bigint,
    referenceId: bigint,
    dto: UpdateArtifactReferenceDto,
    principal: AuthenticatedPrincipal,
  ) {
    const parentVersion = await this.ownership.assertEditableParentVersion(
      tenantId,
      parentVersionId,
    );
    const existing = await this.ownership.getOwned(tenantId, parentVersionId, referenceId);
    this.ownership.assertRoleAllows(existing.requiredRole, principal);

    let childArtifactId = existing.childArtifactId;
    let childVersionId = existing.childArtifactVersionId;
    if (dto.childArtifactVersionId) {
      childVersionId = parseBigIntId(dto.childArtifactVersionId, 'childArtifactVersionId');
      const version = await this.prisma.decisionArtifactVersion.findFirst({
        where: { id: childVersionId, artifact: { tenantId } },
        select: { artifactId: true },
      });
      if (!version) {
        throw new DomainException(
          'CHILD_VERSION_NOT_FOUND',
          'Child artifact version not found',
          HttpStatus.NOT_FOUND,
        );
      }
      childArtifactId = version.artifactId;
      await this.children.assertReferencableChild(
        tenantId,
        parentVersion.artifactId,
        childArtifactId,
        childVersionId,
      );
      await this.cycles.assertNoCycleOrDepthOverflow(
        tenantId,
        parentVersion.artifactId,
        childArtifactId,
        existing.id,
      );
    }

    // Cambiar la versión del hijo O el mapeo obliga a revalidar: el contrato efectivo
    // es el par (versión, mapeo), y tocar cualquiera de los dos puede romperlo.
    if (dto.childArtifactVersionId || dto.inputMapping || dto.outputMapping) {
      await this.children.assertCompatibleContracts(
        parentVersionId,
        childVersionId,
        (dto.inputMapping ?? existing.inputMappingJson) as never,
        (dto.outputMapping ?? existing.outputMappingJson) as never,
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.decisionArtifactReference.update({
        where: { id: existing.id },
        data: {
          childArtifactId,
          childArtifactVersionId: childVersionId,
          inputMappingJson: dto.inputMapping
            ? (dto.inputMapping as unknown as Prisma.InputJsonValue)
            : undefined,
          outputMappingJson: dto.outputMapping
            ? (dto.outputMapping as unknown as Prisma.InputJsonValue)
            : undefined,
          timeoutMs: dto.timeoutMs,
          onErrorPolicy: dto.onErrorPolicy,
          fallbackOutputJson: dto.fallbackOutput as unknown as Prisma.InputJsonValue | undefined,
          requiredRole: dto.requiredRole,
          environmentCode: dto.environmentCode,
          versionSelection: dto.versionSelection,
          maxRetries: dto.maxRetries,
          retryDelayMs: dto.retryDelayMs,
          executionConditionJson: dto.executionCondition as unknown as
            Prisma.InputJsonValue | undefined,
          isRequired: dto.isRequired,
          tracePolicy: dto.tracePolicy,
        },
      });
      await this.audit.append(
        {
          tenantId,
          eventType: 'ARTIFACT_REFERENCE_UPDATED',
          aggregateType: 'DecisionArtifactVersion',
          aggregateId: parentVersionId.toString(),
          actorId: principal.id,
          requestId: principal.requestId,
          payload: { referenceId: existing.id.toString() },
        },
        tx,
      );
      return result;
    });
    return updated;
  }

  async delete(
    tenantId: bigint,
    parentVersionId: bigint,
    referenceId: bigint,
    principal: AuthenticatedPrincipal,
  ): Promise<void> {
    await this.ownership.assertEditableParentVersion(tenantId, parentVersionId);
    const existing = await this.ownership.getOwned(tenantId, parentVersionId, referenceId);
    this.ownership.assertRoleAllows(existing.requiredRole, principal);
    await this.prisma.$transaction(async (tx) => {
      await tx.decisionArtifactReference.delete({ where: { id: existing.id } });
      await this.audit.append(
        {
          tenantId,
          eventType: 'ARTIFACT_REFERENCE_DELETED',
          aggregateType: 'DecisionArtifactVersion',
          aggregateId: parentVersionId.toString(),
          actorId: principal.id,
          requestId: principal.requestId,
          payload: { referenceId: existing.id.toString(), nodeKey: existing.nodeKey },
        },
        tx,
      );
    });
  }

  async list(tenantId: bigint, parentVersionId: bigint) {
    await this.ownership.assertParentVersionTenant(tenantId, parentVersionId);
    return this.prisma.decisionArtifactReference.findMany({
      where: { tenantId, parentArtifactVersionId: parentVersionId },
      orderBy: { nodeKey: 'asc' },
    });
  }
}
