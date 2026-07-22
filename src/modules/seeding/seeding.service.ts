import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { runSeeds } from './seed-runner';

// Arbitrary but stable key for the Postgres session-level advisory lock that serializes
// startup seeding across replicas. Only the holder seeds; the rest skip immediately.
const SEED_ADVISORY_LOCK_KEY = 4626_2026n;

/**
 * Injects the seeds at application startup, idempotently.
 *
 * - BOOTSTRAP seeds (environments, the full variable catalog — domain inputs, scoring targets
 *   and the AtlasBackend-injected variables —, reason codes and integration clients) run in
 *   EVERY environment, so a fresh database is usable the moment the API accepts traffic.
 * - MOCKUP seeds (the BNPL demo artifact) run ONLY in development.
 *
 * Runs before the HTTP server starts serving (OnApplicationBootstrap). A Postgres advisory
 * lock serializes seeding when several replicas boot together; every operation is an upsert,
 * so a second run converges on the same state either way. Enabled by default outside `test`;
 * override with STARTUP_SEED_ENABLED. Kept out of the CLI seed path so `prisma db seed` and the
 * startup injector share the exact same {@link runSeeds} logic.
 */
@Injectable()
export class SeedingService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SeedingService.name);
  private readonly enabled: boolean;
  private readonly includeMockup: boolean;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    const nodeEnv = config.get<string>('NODE_ENV') ?? 'development';
    // Default on everywhere except automated tests, which provision their own fixtures.
    this.enabled = config.get<boolean>('STARTUP_SEED_ENABLED') ?? nodeEnv !== 'test';
    this.includeMockup = nodeEnv === 'development';
  }

  async onApplicationBootstrap(): Promise<void> {
    if (!this.enabled) {
      this.logger.log('Startup seeding disabled by configuration');
      return;
    }

    const [{ locked }] = await this.prisma.$queryRaw<{ locked: boolean }[]>(
      Prisma.sql`SELECT pg_try_advisory_lock(${SEED_ADVISORY_LOCK_KEY}) AS locked`,
    );
    if (!locked) {
      this.logger.log('Another instance holds the seed lock; skipping startup seeding');
      return;
    }

    try {
      const summary = await runSeeds(this.prisma, { includeMockup: this.includeMockup });
      this.logger.log(
        `Startup seeding complete: ${summary.bootstrap.variables} variables, ` +
          `${summary.bootstrap.reasonCodes} reason codes, ` +
          `${summary.bootstrap.integrationClients} integration client(s); ` +
          `mockup ${summary.mockupSkipped ? 'skipped (non-development)' : 'applied'}`,
      );
    } catch (error) {
      // A seeding failure must not silently leave the platform running against an empty
      // catalog, so it is surfaced and rethrown to abort startup.
      this.logger.error(
        `Startup seeding failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    } finally {
      await this.prisma.$queryRaw(Prisma.sql`SELECT pg_advisory_unlock(${SEED_ADVISORY_LOCK_KEY})`);
    }
  }
}
