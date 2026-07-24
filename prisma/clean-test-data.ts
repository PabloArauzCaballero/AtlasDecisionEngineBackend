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
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
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
        { artifactCode: { contains: 'BLOCKED' } },
        { artifactCode: { contains: 'FIXTURE' } },
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

  const codes = junk.map((artifact) => artifact.artifactCode);
  const bindings = await prisma.decisionRuntimeBinding.deleteMany({
    where: { tenantId: TENANT, artifactCode: { in: codes } },
  });
  const deleted = await prisma.decisionArtifact.deleteMany({
    where: { id: { in: junk.map((artifact) => artifact.id) } },
  });
  console.log(`✓ ${deleted.count} artefactos y ${bindings.count} runtime bindings eliminados.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
