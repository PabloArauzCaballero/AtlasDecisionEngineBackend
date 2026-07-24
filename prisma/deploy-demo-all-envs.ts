/**
 * Despliega el artefacto demo (BNPL_CREDIT_DECISION) en SANDBOX y TEST además de
 * PROD, para que el Simulador y la Ejecución en Vivo puedan correrlo (esas vistas
 * solo ofrecen ambientes no productivos). El seeder base solo lo despliega en PROD;
 * como es idempotente y omite el demo si ya existe, re-sembrar no lo arregla — por
 * eso este script actúa sobre la BD ACTUAL. Es idempotente: no duplica bindings.
 *
 * Uso:  npx ts-node --transpile-only prisma/deploy-demo-all-envs.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const TENANT_ID = BigInt(process.env.SEED_TENANT_ID ?? '1');
const ARTIFACT_CODE = 'BNPL_CREDIT_DECISION';

async function main() {
  const artifact = await prisma.decisionArtifact.findUnique({
    where: { tenantId_artifactCode: { tenantId: TENANT_ID, artifactCode: ARTIFACT_CODE } },
    include: {
      versions: {
        orderBy: { versionNumber: 'desc' },
        take: 1,
        include: {
          compiledArtifacts: {
            where: { compileStatus: 'SUCCESS' },
            orderBy: { compiledAt: 'desc' },
            take: 1,
          },
        },
      },
    },
  });
  if (!artifact?.versions.length) {
    console.log('✗ No existe el artefacto demo. Corre el seeder primero.');
    return;
  }
  const version = artifact.versions[0];
  const compiled = version.compiledArtifacts[0];
  if (!compiled) {
    console.log('✗ La versión demo no tiene artefacto compilado. Valida/compila primero.');
    return;
  }

  const envs = await prisma.decisionEnvironment.findMany({
    where: { code: { in: ['SANDBOX', 'TEST'] } },
  });
  for (const environment of envs) {
    const existing = await prisma.decisionRuntimeBinding.findFirst({
      where: { tenantId: TENANT_ID, artifactCode: ARTIFACT_CODE, environmentId: environment.id },
    });
    if (existing) {
      console.log(`= ${environment.code}: ya tenía un binding activo, omitido.`);
      continue;
    }
    const deployment = await prisma.decisionDeployment.create({
      data: {
        artifactVersionId: version.id,
        compiledArtifactId: compiled.id,
        environmentId: environment.id,
        deploymentMode: 'FULL',
        deploymentStatus: 'ACTIVE',
        effectiveFrom: new Date(),
        isActive: true,
        deployedBy: 'seed.release-manager',
      },
    });
    await prisma.decisionRuntimeBinding.create({
      data: {
        tenantId: TENANT_ID,
        artifactCode: ARTIFACT_CODE,
        environmentId: environment.id,
        activeDeploymentId: deployment.id,
        bindingKey: 'default',
      },
    });
    console.log(`✓ ${environment.code}: desplegado (deployment ${deployment.id}).`);
  }
  console.log('\n✅ Listo. Ahora el Simulador puede correr el demo en SANDBOX/TEST.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
