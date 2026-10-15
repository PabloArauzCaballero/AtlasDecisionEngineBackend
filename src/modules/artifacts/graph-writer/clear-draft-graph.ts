import type { Prisma } from '@prisma/client';

/** Vacía los hijos editables de la versión para reescribirlos en la misma transacción. */
export async function clearDraftGraph(
  tx: Prisma.TransactionClient,
  versionId: bigint,
): Promise<void> {
  await tx.decisionNodeScript.deleteMany({ where: { artifactVersionId: versionId } });
  await tx.decisionRuleEdge.deleteMany({ where: { artifactVersionId: versionId } });
  await tx.decisionRuleNode.deleteMany({ where: { artifactVersionId: versionId } });
  await tx.decisionRuleCondition.deleteMany({ where: { artifactVersionId: versionId } });
  await tx.decisionRuleAction.deleteMany({ where: { artifactVersionId: versionId } });
  await tx.decisionArtifactVariableDependency.deleteMany({
    where: { artifactVersionId: versionId },
  });
  await tx.decisionArtifactCalculatedFieldUse.deleteMany({
    where: { artifactVersionId: versionId },
  });
  await tx.decisionIntermediateVariable.deleteMany({ where: { artifactVersionId: versionId } });
  await tx.decisionOutputContractField.deleteMany({ where: { artifactVersionId: versionId } });
  await tx.decisionCompiledArtifact.deleteMany({ where: { artifactVersionId: versionId } });
}
