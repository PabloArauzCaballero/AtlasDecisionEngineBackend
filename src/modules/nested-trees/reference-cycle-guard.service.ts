import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DomainException } from '../../common/errors/domain-exception';
import { MetricsService } from '../../common/observability/metrics.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  computeMaxDepthFrom,
  detectCycle,
  findAncestors,
  type ArtifactReferenceEdge,
} from './cycle-detector';

/** Que una referencia nueva no cierre un ciclo ni pase la profundidad máxima del árbol anidado. */
@Injectable()
export class ReferenceCycleGuard {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly metrics: MetricsService,
  ) {}

  async assertNoCycleOrDepthOverflow(
    tenantId: bigint,
    parentArtifactId: bigint,
    childArtifactId: bigint,
    excludeReferenceId?: bigint,
  ): Promise<void> {
    const maxDepth = this.config.get<number>('NESTED_TREE_MAX_DEPTH') ?? 5;
    const existingReferences = await this.prisma.decisionArtifactReference.findMany({
      where: { tenantId, ...(excludeReferenceId ? { id: { not: excludeReferenceId } } : {}) },
      select: { parentArtifactVersionId: true, childArtifactId: true },
    });
    const versionIds = [
      ...new Set(
        existingReferences.map((reference) => reference.parentArtifactVersionId.toString()),
      ),
    ].map(BigInt);
    const versions = await this.prisma.decisionArtifactVersion.findMany({
      where: { id: { in: versionIds } },
      select: { id: true, artifactId: true },
    });
    const versionToArtifact = new Map(
      versions.map((version) => [version.id.toString(), version.artifactId]),
    );
    const edges: ArtifactReferenceEdge[] = existingReferences
      .map((reference) => {
        const parent = versionToArtifact.get(reference.parentArtifactVersionId.toString());
        if (!parent) return null;
        return {
          parentArtifactId: parent.toString(),
          childArtifactId: reference.childArtifactId.toString(),
        };
      })
      .filter((edge): edge is ArtifactReferenceEdge => edge !== null);

    const candidate: ArtifactReferenceEdge = {
      parentArtifactId: parentArtifactId.toString(),
      childArtifactId: childArtifactId.toString(),
    };
    const cycle = detectCycle(edges, candidate);
    if (cycle.hasCycle) {
      this.metrics.recordBlockedCycle('CIRCULAR_REFERENCE');
      throw new DomainException(
        'CIRCULAR_ARTIFACT_REFERENCE',
        `This reference would create a circular dependency: ${(cycle.path ?? []).join(' -> ')}`,
        HttpStatus.CONFLICT,
        { path: cycle.path },
      );
    }

    const ancestors = findAncestors(edges, candidate.parentArtifactId);
    let deepest = 0;
    for (const ancestor of ancestors) {
      const depth = computeMaxDepthFrom(edges, ancestor, candidate);
      if (depth > deepest) deepest = depth;
    }
    if (deepest > maxDepth) {
      this.metrics.recordBlockedCycle('MAX_DEPTH_EXCEEDED');
      throw new DomainException(
        'NESTED_TREE_MAX_DEPTH_EXCEEDED',
        `This reference would make the nested-tree depth reach ${deepest}, exceeding the configured maximum of ${maxDepth}`,
        HttpStatus.CONFLICT,
        { depth: deepest, maxDepth },
      );
    }
  }
}
