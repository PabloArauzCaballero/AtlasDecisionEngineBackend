/**
 * Prisma CLI entrypoint for idempotent bootstrap data. Production excludes demo records while
 * retaining structural catalogs and explicitly configured integration clients.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { describeMockupDecision, resolveMockupPolicy } from '../src/modules/seeding/mockup-policy';
import { runSeeds } from '../src/modules/seeding/seed-runner';

// Thin CLI wrapper around the shared seed runner (see src/modules/seeding). The same logic
// runs at application startup through SeedingService; this entrypoint exists for
// `prisma db seed`, the one-shot migration/seed Job and local development.
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required to seed the database');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

// Los datos base se siembran siempre; los de demostración sólo cuando se piden. La regla
// vive entera en `mockup-policy.ts`, compartida con el arranque de la aplicación, para que
// el Job y el proceso no puedan decidir cosas distintas sobre la misma base.
const decision = resolveMockupPolicy();
console.log(describeMockupDecision(decision));

runSeeds(prisma, { includeMockup: decision.includeMockup })
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
