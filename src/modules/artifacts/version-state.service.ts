import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, VersionStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { DomainException } from '../../common/errors/domain-exception';

const allowedTransitions: Record<VersionStatus, VersionStatus[]> = {
  DRAFT: ['VALIDATION_FAILED', 'VALIDATED', 'RETIRED'],
  VALIDATION_FAILED: ['DRAFT', 'VALIDATED', 'RETIRED'],
  VALIDATED: ['DRAFT', 'COMPILED', 'VALIDATION_FAILED', 'RETIRED'],
  COMPILED: ['VALIDATED', 'IN_REVIEW', 'RETIRED'],
  IN_REVIEW: ['CHANGES_REQUESTED', 'REJECTED', 'APPROVED'],
  CHANGES_REQUESTED: ['DRAFT', 'RETIRED'],
  APPROVED: ['DEPLOYED_TO_SANDBOX', 'DEPLOYED_TO_TEST', 'DEPLOYED_TO_PROD', 'RETIRED'],
  DEPLOYED_TO_SANDBOX: ['DEPLOYED_TO_TEST', 'APPROVED', 'RETIRED'],
  DEPLOYED_TO_TEST: ['DEPLOYED_TO_PROD', 'APPROVED', 'RETIRED'],
  DEPLOYED_TO_PROD: ['SUSPENDED', 'APPROVED', 'RETIRED'],
  SUSPENDED: ['DEPLOYED_TO_PROD', 'APPROVED', 'RETIRED'],
  REJECTED: ['RETIRED'],
  RETIRED: [],
};

@Injectable()
export class VersionStateService {
  constructor(private readonly prisma: PrismaService) {}

  async transition(
    artifactVersionId: bigint,
    to: VersionStatus,
    actor: string,
    reason: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    const version = await client.decisionArtifactVersion.findUnique({
      where: { id: artifactVersionId },
      select: { status: true },
    });
    if (!version) {
      throw new DomainException(
        'VERSION_NOT_FOUND',
        'Artifact version not found',
        HttpStatus.NOT_FOUND,
      );
    }
    if (version.status === to) return;
    if (!allowedTransitions[version.status].includes(to)) {
      throw new DomainException(
        'INVALID_VERSION_TRANSITION',
        `Cannot transition artifact version from ${version.status} to ${to}`,
        HttpStatus.CONFLICT,
      );
    }

    await client.decisionArtifactVersion.update({
      where: { id: artifactVersionId },
      data: {
        status: to,
        ...(to === 'IN_REVIEW' ? { submittedAt: new Date() } : {}),
        ...(to === 'APPROVED' ? { approvedAt: new Date() } : {}),
        ...(to === 'RETIRED' ? { retiredAt: new Date() } : {}),
      },
    });
    await client.decisionVersionStatusHistory.create({
      data: {
        artifactVersionId,
        fromStatus: version.status,
        toStatus: to,
        changedBy: actor,
        reason,
      },
    });
  }
}
