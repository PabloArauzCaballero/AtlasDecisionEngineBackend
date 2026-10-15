import { HttpStatus, Injectable } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain-exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';

/** Quién es dueño de qué: la versión padre editable, la referencia del tenant y el rol que exige. */
@Injectable()
export class ReferenceOwnershipService {
  constructor(private readonly prisma: PrismaService) {}

  async assertEditableParentVersion(tenantId: bigint, parentVersionId: bigint) {
    const version = await this.prisma.decisionArtifactVersion.findFirst({
      where: { id: parentVersionId, artifact: { tenantId } },
      select: { id: true, artifactId: true, status: true },
    });
    if (!version) {
      throw new DomainException(
        'VERSION_NOT_FOUND',
        'Artifact version not found',
        HttpStatus.NOT_FOUND,
      );
    }
    if (version.status !== 'DRAFT' && version.status !== 'VALIDATION_FAILED') {
      throw new DomainException(
        'VERSION_IMMUTABLE',
        `Nested references can only be edited on a DRAFT or VALIDATION_FAILED version; current state is ${version.status}`,
        HttpStatus.CONFLICT,
      );
    }
    return version;
  }

  async assertParentVersionTenant(tenantId: bigint, parentVersionId: bigint) {
    const version = await this.prisma.decisionArtifactVersion.findFirst({
      where: { id: parentVersionId, artifact: { tenantId } },
      select: { id: true },
    });
    if (!version) {
      throw new DomainException(
        'VERSION_NOT_FOUND',
        'Artifact version not found',
        HttpStatus.NOT_FOUND,
      );
    }
  }

  async getOwned(tenantId: bigint, parentVersionId: bigint, referenceId: bigint) {
    const reference = await this.prisma.decisionArtifactReference.findFirst({
      where: { id: referenceId, tenantId, parentArtifactVersionId: parentVersionId },
    });
    if (!reference) {
      throw new DomainException(
        'REFERENCE_NOT_FOUND',
        'Artifact reference not found',
        HttpStatus.NOT_FOUND,
      );
    }
    return reference;
  }

  assertRoleAllows(requiredRole: string | null, principal: AuthenticatedPrincipal): void {
    if (!requiredRole) return;
    if (principal.roles.includes(requiredRole) || principal.roles.includes('PLATFORM_ADMIN'))
      return;
    throw new DomainException(
      'FORBIDDEN',
      `This reference requires the ${requiredRole} role to modify`,
      HttpStatus.FORBIDDEN,
    );
  }
}
