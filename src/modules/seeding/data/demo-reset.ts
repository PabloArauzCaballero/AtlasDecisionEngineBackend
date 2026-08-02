import { Logger } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

const logger = new Logger('SeedDemoReset');

/**
 * Borra el artefacto de demostración y TODO lo que cuelga de él para poder
 * volver a sembrarlo desde cero.
 *
 * Existe porque la siembra de demo es "crear si no existe": una base sembrada
 * con una versión anterior del seeder se quedaba con los datos viejos para
 * siempre (grafo en línea recta, sin variables de salida, casos de prueba que no
 * cuadraban con el motor) y ninguna mejora del seeder llegaba nunca a verse.
 *
 * Varias claves foráneas son "audit-preserving" (Restrict, sin cascada en la
 * base), así que el borrado va en orden de dependencia: ejecuciones → bindings →
 * despliegues → corridas de prueba → artefacto (que ya cascadea versiones,
 * nodos, aristas, condiciones, acciones, suites y snapshots compilados).
 *
 * Sólo se usa con datos de demostración en desarrollo; nunca toca artefactos
 * creados por la persona usuaria.
 */
export async function resetDemoArtifact(
  prisma: PrismaClient,
  tenantId: bigint,
  artifactCode: string,
): Promise<boolean> {
  const artifact = await prisma.decisionArtifact.findUnique({
    where: { tenantId_artifactCode: { tenantId, artifactCode } },
    include: { versions: { select: { id: true } } },
  });
  if (!artifact) return false;

  const versionIds = artifact.versions.map((version) => version.id);
  const compiled = await prisma.decisionCompiledArtifact.findMany({
    where: { artifactVersionId: { in: versionIds } },
    select: { id: true },
  });
  const compiledIds = compiled.map((row) => row.id);
  const suites = await prisma.decisionTestSuite.findMany({
    where: { artifactVersionId: { in: versionIds } },
    select: { id: true },
  });
  const deployments = await prisma.decisionDeployment.findMany({
    where: { artifactVersionId: { in: versionIds } },
    select: { id: true },
  });
  const deploymentIds = deployments.map((row) => row.id);

  // Las ejecuciones arrastran variables, pasos, motivos, errores y casos de
  // revisión manual por cascada; sus FKs a nodos/acciones son Restrict, así que
  // deben irse antes que el grafo. Los enlaces del árbol anidado no tienen FK,
  // así que se limpian a mano para no dejar huérfanos.
  const executions = await prisma.decisionExecution.findMany({
    where: { artifactVersionId: { in: versionIds } },
    select: { id: true },
  });
  const executionIds = executions.map((row) => row.id);
  if (executionIds.length) {
    await prisma.decisionExecutionTreeLink.deleteMany({
      where: { rootExecutionId: { in: executionIds } },
    });
  }
  await prisma.decisionExecution.deleteMany({ where: { artifactVersionId: { in: versionIds } } });
  await prisma.decisionRuntimeBinding.deleteMany({ where: { tenantId, artifactCode } });
  await prisma.decisionArtifactReference.deleteMany({
    where: {
      OR: [{ childArtifactId: artifact.id }, { parentArtifactVersionId: { in: versionIds } }],
    },
  });
  await prisma.decisionTestRun.deleteMany({
    where: {
      OR: [
        { testSuiteId: { in: suites.map((suite) => suite.id) } },
        { compiledArtifactId: { in: compiledIds } },
      ],
    },
  });
  await prisma.decisionDeployment.deleteMany({ where: { id: { in: deploymentIds } } });
  await prisma.decisionArtifact.delete({ where: { id: artifact.id } });
  logger.warn(`Demo artifact ${artifactCode} removed to be re-seeded from scratch`);
  return true;
}
