/**
 * Limpia los ARTEFACTOS DE PRUEBA que ensucian la base (los que dejan los tests
 * E2E/Playwright, con códigos tipo `E2E_CODE_IMPORT_BLOCKED_1784902104551`), y que
 * aparecen en el Simulador con "No active deployment". NO toca el demo real ni el
 * catálogo. La lógica vive en clean-test-data-core.ts y la comparte el globalTeardown
 * de los e2e, así ambos borran exactamente igual.
 *
 * Uso:  npx ts-node --transpile-only prisma/clean-test-data.ts
 *       DRY_RUN=1 … para solo listar sin borrar.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { cleanTestArtifacts } from './clean-test-data-core';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
const dryRun = process.env.DRY_RUN === '1';

async function main() {
  const result = await cleanTestArtifacts(prisma, { dryRun });
  if (!result.codes.length) {
    console.log('✓ No hay artefactos de prueba que limpiar.');
    return;
  }
  console.log(`${dryRun ? '[DRY RUN] ' : ''}Artefactos de prueba (${result.codes.length}):`);
  for (const code of result.codes) console.log('  -', code);
  if (dryRun) return;
  console.log(
    `✓ ${result.artifacts} artefactos, ${result.references} referencias y ${result.bindings} bindings eliminados.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
