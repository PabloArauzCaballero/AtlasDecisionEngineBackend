import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { existsSync } from 'node:fs';
import { Pool } from 'pg';
import { cleanTestArtifacts } from '../../../prisma/clean-test-data-core';

/**
 * Runs once after the whole e2e suite: removes every test-generated artifact
 * (E2E_*, etc.) so the suite never leaves junk in the database — the artifacts that
 * were showing up in the Simulator as "No active deployment". A single global hook
 * beats per-spec afterAll cleanups (which every new spec would have to remember).
 */
export default async function globalTeardown(): Promise<void> {
  if (!process.env.DATABASE_URL && existsSync('.env')) {
    try {
      process.loadEnvFile('.env');
    } catch {
      // .env not loadable; fall through
    }
  }
  if (!process.env.DATABASE_URL) return;

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  try {
    const result = await cleanTestArtifacts(prisma);
    if (result.artifacts) {
      process.stdout.write(
        `\n[e2e teardown] ${result.artifacts} artefactos de prueba eliminados\n`,
      );
    }
  } catch (error) {
    process.stdout.write(`[e2e teardown] limpieza omitida: ${(error as Error).message}\n`);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}
