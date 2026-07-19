import { HttpStatus, Injectable } from '@nestjs/common';
import { CacheService } from '../../common/cache/cache.service';
import { DomainException } from '../../common/errors/domain-exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { CompiledDecisionArtifact } from '../graph/graph.types';

export interface ResolvedDeployment {
  deploymentId: bigint;
  artifactVersionId: bigint;
  environmentId: bigint;
  environmentCode: string;
  compiledArtifactId: bigint;
  compiledChecksum: string;
  compiled: CompiledDecisionArtifact;
}

@Injectable()
export class DeploymentResolverService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  async resolve(
    tenantId: bigint,
    artifactCode: string,
    environmentCode: string,
  ): Promise<ResolvedDeployment> {
    const key = this.cacheKey(artifactCode, environmentCode);
    const cached = await this.cache.getForTenant(tenantId, key);
    if (cached) {
      const parsed = JSON.parse(cached) as Omit<ResolvedDeployment, 'deploymentId' | 'artifactVersionId' | 'environmentId' | 'compiledArtifactId'> & {
        deploymentId: string;
        artifactVersionId: string;
        environmentId: string;
        compiledArtifactId: string;
      };
      return {
        ...parsed,
        deploymentId: BigInt(parsed.deploymentId),
        artifactVersionId: BigInt(parsed.artifactVersionId),
        environmentId: BigInt(parsed.environmentId),
        compiledArtifactId: BigInt(parsed.compiledArtifactId),
      };
    }

    const binding = await this.prisma.decisionRuntimeBinding.findFirst({
      where: {
        tenantId,
        artifactCode,
        bindingKey: 'default',
        environment: { code: environmentCode },
        activeDeployment: {
          isActive: true,
          deploymentStatus: 'ACTIVE',
          effectiveFrom: { lte: new Date() },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: new Date() } }],
        },
      },
      include: {
        environment: true,
        activeDeployment: { include: { compiledArtifact: true } },
      },
    });
    if (!binding) {
      throw new DomainException(
        'ACTIVE_DEPLOYMENT_NOT_FOUND',
        `No active deployment for ${artifactCode} in ${environmentCode}`,
        HttpStatus.NOT_FOUND,
      );
    }
    const resolved: ResolvedDeployment = {
      deploymentId: binding.activeDeployment.id,
      artifactVersionId: binding.activeDeployment.artifactVersionId,
      environmentId: binding.environmentId,
      environmentCode: binding.environment.code,
      compiledArtifactId: binding.activeDeployment.compiledArtifactId,
      compiledChecksum: binding.activeDeployment.compiledArtifact.compiledChecksum,
      compiled: binding.activeDeployment.compiledArtifact.compiledPayloadJson as unknown as CompiledDecisionArtifact,
    };
    await this.cache.setForTenant(
      tenantId,
      key,
      JSON.stringify({
        ...resolved,
        deploymentId: resolved.deploymentId.toString(),
        artifactVersionId: resolved.artifactVersionId.toString(),
        environmentId: resolved.environmentId.toString(),
        compiledArtifactId: resolved.compiledArtifactId.toString(),
      }),
      60,
    );
    return resolved;
  }

  invalidate(tenantId: bigint, artifactCode: string, environmentCode: string): Promise<void> {
    return this.cache.delForTenant(tenantId, this.cacheKey(artifactCode, environmentCode));
  }

  // Tenant is applied by the cache helpers, so it is no longer part of this logical key.
  private cacheKey(artifactCode: string, environmentCode: string): string {
    return `decision-binding:${artifactCode}:${environmentCode}`;
  }
}
