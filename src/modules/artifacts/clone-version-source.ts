import type { Prisma } from '@prisma/client';

/** Todo lo que una versión declara y que su clon tiene que heredar. */
export const CLONE_SOURCE_INCLUDE = {
  artifact: { include: { versions: { select: { versionNumber: true } } } },
  variableDependencies: true,
  conditions: true,
  actions: { include: { reasonMappings: true } },
  nodes: { include: { nodeConditions: true, nodeActions: true } },
  edges: { include: { edgeConditions: true } },
  intermediateVariables: true,
  outputContractFields: { include: { reasonCodes: true } },
  nodeScripts: true,
  calculatedFieldUses: true,
} satisfies Prisma.DecisionArtifactVersionInclude;

export type CloneSource = Prisma.DecisionArtifactVersionGetPayload<{
  include: typeof CLONE_SOURCE_INCLUDE;
}>;
