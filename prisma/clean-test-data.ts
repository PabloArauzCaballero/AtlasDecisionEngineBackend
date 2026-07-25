/**
 * Limpia los ARTEFACTOS DE PRUEBA que ensucian la base (los que dejan los tests
 * E2E/Playwright, con códigos tipo `E2E_CODE_IMPORT_BLOCKED_1784902104551`), y que
 * aparecen en el Simulador con "No active deployment". NO toca el demo real
 * (`BNPL_CREDIT_DECISION`) ni el catálogo de variables/reason-codes.
 *
 * Borrar un artefacto cascadea sus versiones, grafo, despliegues y suites; los
 * runtime bindings van por `artifactCode` (sin FK), así que se borran aparte.
 *
 * Uso:  npx ts-node --transpile-only prisma/clean-test-data.ts
 *       (o DRY_RUN=1 … para solo listar sin borrar)
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
const TENANT = BigInt(process.env.SEED_TENANT_ID ?? '1');
const DRY_RUN = process.env.DRY_RUN === '1';

// Códigos que SIEMPRE se conservan (el demo real y los algoritmos lógicos de docs).
const KEEP = new Set([
  'BNPL_CREDIT_DECISION',
  'SCORING_CREDITO_CONSUMO',
  'TRIAGE_FRAUDE_TRANSACCION',
  'ELEGIBILIDAD_ONBOARDING_KYC',
  'ASIGNACION_LIMITE_TARJETA',
]);

async function main() {
  const candidates = await prisma.decisionArtifact.findMany({
    where: {
      tenantId: TENANT,
      OR: [
        { artifactCode: { startsWith: 'E2E_' } },
        { artifactCode: { startsWith: 'TEST_' } },
        { artifactCode: { startsWith: 'PW_' } },
        { artifactCode: { startsWith: 'SMOKE_' } },
        { artifactCode: { startsWith: 'SHOULD_' } },
        { artifactCode: { contains: 'BLOCKED' } },
        { artifactCode: { contains: 'FIXTURE' } },
        { artifactCode: { contains: 'SHOULD_NOT' } },
      ],
    },
    select: { id: true, artifactCode: true },
  });
  const junk = candidates.filter((artifact) => !KEEP.has(artifact.artifactCode));

  if (!junk.length) {
    console.log('✓ No hay artefactos de prueba que limpiar.');
    return;
  }
  console.log(`${DRY_RUN ? '[DRY RUN] ' : ''}Artefactos de prueba a eliminar (${junk.length}):`);
  for (const artifact of junk) console.log('  -', artifact.artifactCode);
  if (DRY_RUN) return;

  const ids = junk.map((artifact) => artifact.id);
  const codes = junk.map((artifact) => artifact.artifactCode);

  // Nested-tree references FK to the child artifact with RESTRICT, so they must go
  // before the artifacts. Remove any reference that touches a junk artifact on
  // either side (child artifact, or a parent version that belongs to a junk one).
  const versions = await prisma.decisionArtifactVersion.findMany({
    where: { artifactId: { in: ids } },
    select: { id: true },
  });
  const versionIds = versions.map((version) => version.id);
  const refs = await prisma.decisionArtifactReference.deleteMany({
    where: {
      OR: [{ childArtifactId: { in: ids } }, { parentArtifactVersionId: { in: versionIds } }],
    },
  });
  const bindings = await prisma.decisionRuntimeBinding.deleteMany({
    where: { tenantId: TENANT, artifactCode: { in: codes } },
  });
  // Deployments FK to the version without cascade at the DB level — delete them
  // (after their bindings) before the artifacts/versions.
  await prisma.decisionDeployment.deleteMany({ where: { artifactVersionId: { in: versionIds } } });

  // Test runs FK to the compiled artifact (audit-preserving, no cascade). Remove the
  // runs of the junk versions' suites/compiled artifacts so the version can cascade.
  const suites = await prisma.decisionTestSuite.findMany({
    where: { artifactVersionId: { in: versionIds } },
    select: { id: true },
  });
  const compiled = await prisma.decisionCompiledArtifact.findMany({
    where: { artifactVersionId: { in: versionIds } },
    select: { id: true },
  });
  await prisma.decisionTestRun.deleteMany({
    where: {
      OR: [
        { testSuiteId: { in: suites.map((suite) => suite.id) } },
        { compiledArtifactId: { in: compiled.map((row) => row.id) } },
      ],
    },
  });

  const deleted = await prisma.decisionArtifact.deleteMany({ where: { id: { in: ids } } });
  console.log(
    `✓ ${deleted.count} artefactos, ${refs.count} referencias y ${bindings.count} bindings eliminados.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
