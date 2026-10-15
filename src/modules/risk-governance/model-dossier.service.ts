import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { DomainException } from '../../common/errors/domain-exception';
import { parseBigIntId } from '../../common/http/id';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import type { RecordModelDossierDto } from './risk-governance.dto';

/** Expediente del modelo: la validación independiente de una versión y su próxima revalidación. */
@Injectable()
export class ModelDossierService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async recordDossier(
    tenantId: bigint,
    dto: RecordModelDossierDto,
    principal: AuthenticatedPrincipal,
  ) {
    const artifactVersionId = parseBigIntId(dto.artifactVersionId, 'artifactVersionId');
    const version = await this.prisma.decisionArtifactVersion.findFirst({
      where: { id: artifactVersionId, artifact: { tenantId } },
      select: { id: true, createdBy: true },
    });
    if (!version) {
      throw new DomainException(
        'VERSION_NOT_FOUND',
        'Artifact version not found',
        HttpStatus.NOT_FOUND,
      );
    }
    if (version.createdBy.trim().toLowerCase() === dto.validatedBy.trim().toLowerCase()) {
      // La validación INDEPENDIENTE es lo que pide SR 11-7 §IV; que la firme quien escribió el
      // modelo la convierte en un trámite.
      throw new DomainException(
        'MODEL_VALIDATION_NOT_INDEPENDENT',
        'Quien creó la versión no puede firmar su validación independiente.',
        HttpStatus.CONFLICT,
      );
    }

    const updated = await this.prisma.decisionArtifactVersion.update({
      where: { id: artifactVersionId },
      data: {
        validatedBy: dto.validatedBy,
        validatedAt: new Date(dto.validatedAt),
        revalidationDueAt: new Date(dto.revalidationDueAt),
        limitationsNotes: dto.limitationsNotes,
      },
      select: { id: true, validatedBy: true, validatedAt: true, revalidationDueAt: true },
    });
    await this.audit.append({
      tenantId,
      eventType: 'MODEL_DOSSIER_RECORDED',
      aggregateType: 'DecisionArtifactVersion',
      aggregateId: updated.id.toString(),
      actorId: principal.id,
      requestId: principal.requestId,
      payload: { validatedBy: dto.validatedBy, revalidationDueAt: dto.revalidationDueAt },
    });
    return {
      artifactVersionId: updated.id.toString(),
      validatedBy: updated.validatedBy,
      validatedAt: updated.validatedAt?.toISOString() ?? null,
      revalidationDueAt: updated.revalidationDueAt?.toISOString() ?? null,
    };
  }
}
