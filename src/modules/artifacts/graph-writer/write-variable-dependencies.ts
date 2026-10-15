import type { Prisma } from '@prisma/client';
import { DomainException } from '../../../common/errors/domain-exception';
import { parseBigIntId } from '../../../common/http/id';
import type { ReplaceGraphDto } from '../artifact.dto';
import type { GraphWriteContext } from './graph-write-context';

/** Las variables que el grafo declara usar: todas tienen que existir en el tenant. */
export async function writeVariableDependencies(
  tx: Prisma.TransactionClient,
  { tenantId, versionId }: GraphWriteContext,
  dto: ReplaceGraphDto,
): Promise<void> {
  const dependencyIds = dto.dependencies.map((dependency) =>
    parseBigIntId(dependency.variableVersionId, 'variableVersionId'),
  );
  const variables = await tx.decisionVariableVersion.findMany({
    where: {
      id: { in: dependencyIds },
      definition: { tenantId },
    },
    select: { id: true },
  });
  if (variables.length !== new Set(dependencyIds.map(String)).size) {
    throw new DomainException(
      'VARIABLE_DEPENDENCY_NOT_FOUND',
      'One or more variable versions do not exist in this tenant',
    );
  }

  await tx.decisionArtifactVariableDependency.createMany({
    data: dto.dependencies.map((dependency, index) => ({
      artifactVersionId: versionId,
      variableVersionId: dependencyIds[index],
      usageType: dependency.usageType,
      isRequired: dependency.isRequired,
      fallbackPolicy: dependency.fallbackPolicy,
      dependencyPath: dependency.dependencyPath,
    })),
  });
}
