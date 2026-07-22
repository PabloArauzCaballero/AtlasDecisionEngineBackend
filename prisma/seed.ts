import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { runSeeds } from '../src/modules/seeding/seed-runner';

// Thin CLI wrapper around the shared seed runner (see src/modules/seeding). The same logic
// runs at application startup through SeedingService; this entrypoint exists for
// `prisma db seed`, the one-shot migration/seed Job and local development.
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required to seed the database');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

// Bootstrap seeds run in every environment; mockup (demo) seeds only in development.
const includeMockup = (process.env.NODE_ENV ?? 'development') === 'development';

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
