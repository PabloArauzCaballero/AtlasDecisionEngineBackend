/**
 * Siembra el artefacto de verificación KYB del comercio en la base del motor.
 *
 * Existe aparte de la siembra general porque ésta tarda y toca decenas de catálogos: para
 * publicar o rehacer UN artefacto no hace falta rehacer el resto. `--force` reescribe la versión
 * ya sembrada, que es lo que se necesita al ajustar un umbral.
 *
 * Uso:
 *   npx ts-node --transpile-only prisma/dev-seeds/seed-partner-kyb.ts [--force]
 */
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { seedPartnerKybArtifact } from '../../src/modules/seeding/data/partner-kyb.seed';

async function main(): Promise<void> {
  const force = process.argv.includes('--force');
  // Adaptador explícito: este cliente de Prisma se genera con `engineType = client`, que no
  // abre la conexión por su cuenta.
  const prisma = new PrismaClient({
    adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
  });
  try {
    const result = await seedPartnerKybArtifact(prisma, { force });
    if (!result) {
      console.log('= El artefacto ya estaba sembrado en esta versión (usa --force para rehacerlo).');
      return;
    }
    console.log(`= Artefacto ${result.artifactCode} ${result.version} sembrado.`);
    console.log(`= Versión ${result.artifactVersionId}, ${result.cases} casos de regresión.`);
    console.log(`= Checksum del compilado: ${result.compiledChecksum}`);
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
