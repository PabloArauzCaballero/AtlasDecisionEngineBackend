/**
 * Prisma CLI entrypoint for idempotent bootstrap data. Production excludes demo records while
 * retaining structural catalogs and explicitly configured integration clients.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { runSeeds } from '../src/modules/seeding/seed-runner';

// Thin CLI wrapper around the shared seed runner (see src/modules/seeding). The same logic
// runs at application startup through SeedingService; this entrypoint exists for
// `prisma db seed`, the one-shot migration/seed Job and local development.
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required to seed the database');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

/**
 * Los datos base se siembran siempre; los de demostración sólo cuando se piden.
 *
 * `SEED_INCLUDE_MOCKUP` manda sobre `NODE_ENV` a propósito. La imagen fija
 * `NODE_ENV=production` (es la misma que se despliega), así que deducirlo del
 * entorno hacía que el contenedor de siembra saltara SIEMPRE el demo —incluso en
 * una máquina de desarrollo— y dejara la base sin ningún artefacto ejecutable:
 * el motor respondía «no active deployment» a cualquier prueba. Al ser explícito,
 * habilitarlo o no es una decisión visible en el compose, no un efecto colateral.
 */
const includeMockup = process.env.SEED_INCLUDE_MOCKUP
  ? process.env.SEED_INCLUDE_MOCKUP === 'true'
  : (process.env.NODE_ENV ?? 'development') === 'development';

runSeeds(prisma, { includeMockup })
  .then((summary) => {
    console.log(
      JSON.stringify(
        summary,
        (_key, value) => (typeof value === 'bigint' ? value.toString() : value),
        2,
      ),
    );
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
