/**
 * Despliega el artefacto demo (BNPL_CREDIT_DECISION) en DEV, STAGING y TEST además de
 * PROD, para que el Simulador y la Ejecución en Vivo puedan correrlo (esas vistas
 * solo ofrecen ambientes no productivos). El seeder base solo lo despliega en PROD;
 * como es idempotente y omite el demo si ya existe, re-sembrar no lo arregla — por
 * eso este script actúa sobre la BD ACTUAL. Es idempotente: no duplica bindings.
 *
 * Uso:  npx ts-node --transpile-only prisma/dev-seeds/deploy-demo-all-envs.ts
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { resolveBootstrapTenantId } from '../../src/modules/seeding/data/helpers';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
// Misma resolución que la siembra (`BOOTSTRAP_TENANT_ID`, con `SEED_TENANT_ID` de sinónimo):
// este script despliega lo que sembró aquélla, así que ha de mirar el mismo tenant.
const TENANT_ID = resolveBootstrapTenantId();
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
    where: { code: { in: ['DEV', 'STAGING', 'TEST'] } },
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
  console.log('\n✅ Listo. Ahora el Simulador puede correr el demo en DEV/STAGING/TEST.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
