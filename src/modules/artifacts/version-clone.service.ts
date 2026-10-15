import { HttpStatus, Injectable } from '@nestjs/common';
import { VersionStatus } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { DomainException } from '../../common/errors/domain-exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import { CloneVersionDto } from './artifact.dto';
import { cloneVersionDeclarations } from './clone-version-declarations';
import { cloneVersionGraph } from './clone-version-graph';
import { CLONE_SOURCE_INCLUDE } from './clone-version-source';

/** «Nueva versión»: un borrador que hereda lo que la versión de origen declara. */
@Injectable()
export class VersionCloneService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async cloneVersion(
    tenantId: bigint,
    sourceVersionId: bigint,
    dto: CloneVersionDto,
    principal: AuthenticatedPrincipal,
  ) {
    const source = await this.prisma.decisionArtifactVersion.findFirst({
      where: { id: sourceVersionId, artifact: { tenantId } },
      include: CLONE_SOURCE_INCLUDE,
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
          /*
           * La declaración del tratamiento viaja con el grafo. Sin ella el borrador nacía con los
           * avisos «finalidad no declarada» y, peor, sin la política de sujeto ni de base
           * habilitante que la versión de origen ya tenía aprobadas.
           */
          processingPurpose: source.processingPurpose,
          legalBasis: source.legalBasis,
          subjectReferencePolicy: source.subjectReferencePolicy,
          subjectPolicyJustification: source.subjectPolicyJustification,
          enablingBasisPolicy: source.enablingBasisPolicy ?? undefined,
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

      await cloneVersionDeclarations(tx, source, version.id);
      await cloneVersionGraph(tx, source, version.id);
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
