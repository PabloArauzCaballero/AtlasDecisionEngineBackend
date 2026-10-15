import { HttpStatus, Injectable } from '@nestjs/common';
import { VersionStatus } from '@prisma/client';
import { DomainException } from '../../common/errors/domain-exception';
import { PrismaService } from '../../common/prisma/prisma.service';

/** La puerta que mira el despliegue: sólo una versión plenamente aprobada puede publicarse. */
@Injectable()
export class VersionApprovalGate {
  constructor(private readonly prisma: PrismaService) {}

  async assertApproved(tenantId: bigint, versionId: bigint): Promise<void> {
    const version = await this.prisma.decisionArtifactVersion.findFirst({
      where: { id: versionId, artifact: { tenantId } },
      select: { status: true, approvedAt: true },
    });
    const approvedStatuses: VersionStatus[] = [
      VersionStatus.APPROVED,
      VersionStatus.DEPLOYED_TO_DEV,
      VersionStatus.DEPLOYED_TO_STAGING,
      VersionStatus.DEPLOYED_TO_TEST,
      VersionStatus.DEPLOYED_TO_PROD,
    ];
    if (!version || !approvedStatuses.includes(version.status)) {
      throw new DomainException(
        'VERSION_NOT_APPROVED',
        'Version is not fully approved',
        HttpStatus.CONFLICT,
      );
    }
  }
}
