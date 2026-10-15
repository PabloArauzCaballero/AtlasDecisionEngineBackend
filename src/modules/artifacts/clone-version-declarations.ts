import type { Prisma } from '@prisma/client';
import type { CloneSource } from './clone-version-source';

/**
 * Copia lo que el grafo DECLARA además de sus nodos: dependencias de variables, intermedias,
 * contrato de salida, scripts de nodo y campos calculados.
 */
export async function cloneVersionDeclarations(
  tx: Prisma.TransactionClient,
  source: CloneSource,
  versionId: bigint,
): Promise<void> {
  await tx.decisionArtifactVariableDependency.createMany({
    data: source.variableDependencies.map((dependency) => ({
      artifactVersionId: versionId,
      variableVersionId: dependency.variableVersionId,
      usageType: dependency.usageType,
      isRequired: dependency.isRequired,
      fallbackPolicy: dependency.fallbackPolicy,
      dependencyPath: dependency.dependencyPath,
    })),
  });
  /*
   * Lo que el grafo DECLARA además de sus nodos: variables intermedias, contrato de salida,
   * scripts de nodo y campos calculados. La clonación copiaba nodos, condiciones, acciones y
   * aristas y se dejaba estas cuatro: el borrador salía con un grafo que referenciaba
   * `intermediate.*` sin declararlas (18 errores UNDECLARED_INTERMEDIATE_REFERENCE en
   * PARTNER_KYB_REVIEW v12) y no se podía compilar, de modo que «Nueva versión» —la única vía de
   * cambiar una política aprobada— producía siempre una versión inservible.
   */
  await tx.decisionIntermediateVariable.createMany({
    data: source.intermediateVariables.map(
      ({ id: _id, createdAt: _c, updatedAt: _u, artifactVersionId: _v, ...rest }) => ({
        ...rest,
        initialValueJson: (rest.initialValueJson ?? undefined) as Prisma.InputJsonValue | undefined,
        constraintsJson: (rest.constraintsJson ?? undefined) as Prisma.InputJsonValue | undefined,
        availabilityConditionJson: (rest.availabilityConditionJson ?? undefined) as
          Prisma.InputJsonValue | undefined,
        artifactVersionId: versionId,
      }),
    ),
  });
  // Una a una (no `createMany`) porque cada campo arrastra sus motivos de ausencia
  // (`reasonCodes`), una relación hija que `createMany` no puede escribir.
  for (const field of source.outputContractFields) {
    const {
      id: _id,
      createdAt: _c,
      updatedAt: _u,
      artifactVersionId: _v,
      reasonCodes,
      ...rest
    } = field;
    await tx.decisionOutputContractField.create({
      data: {
        ...rest,
        valueMappingJson: (rest.valueMappingJson ?? undefined) as Prisma.InputJsonValue | undefined,
        exampleJson: (rest.exampleJson ?? undefined) as Prisma.InputJsonValue | undefined,
        artifactVersionId: versionId,
        reasonCodes: {
          create: reasonCodes.map((mapping) => ({
            reasonCodeId: mapping.reasonCodeId,
            priority: mapping.priority,
          })),
        },
      },
    });
  }
  await tx.decisionNodeScript.createMany({
    data: source.nodeScripts.map(
      ({ id: _id, createdAt: _c, updatedAt: _u, artifactVersionId: _v, ...rest }) => ({
        ...rest,
        inputVariablesJson: rest.inputVariablesJson as Prisma.InputJsonValue,
        outputVariablesJson: rest.outputVariablesJson as Prisma.InputJsonValue,
        artifactVersionId: versionId,
      }),
    ),
  });
  await tx.decisionArtifactCalculatedFieldUse.createMany({
    data: source.calculatedFieldUses.map(
      ({ id: _id, createdAt: _c, artifactVersionId: _v, ...rest }) => ({
        ...rest,
        inputMappingJson: rest.inputMappingJson as Prisma.InputJsonValue,
        definitionJson: rest.definitionJson as Prisma.InputJsonValue,
        artifactVersionId: versionId,
      }),
    ),
  });
}
