import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { runsBackgroundJobs, workerRoleOf } from '../../common/config/worker-role';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AdvisoryLockDomain, advisoryLockKey } from '../../common/prisma/advisory-lock';
import { describeMockupDecision, resolveMockupPolicy } from './mockup-policy';
import { runSeeds } from './seed-runner';

// Stable key for the Postgres session-level advisory lock that serializes startup seeding
// across replicas. Only the holder seeds; the rest skip immediately. Namespaced by domain
// (advisory-lock.ts) so it cannot land on a tenant's audit-chain key or a deployment's.
const SEED_ADVISORY_LOCK_KEY = advisoryLockKey(AdvisoryLockDomain.Seeding);

/**
 * Injects the seeds at application startup, idempotently.
 *
 * - BOOTSTRAP seeds (environments, the full variable catalog — domain inputs, scoring targets
 *   and the AtlasBackend-injected variables —, reason codes and integration clients) run in
 *   EVERY environment, so a fresh database is usable the moment the API accepts traffic.
 * - MOCKUP seeds (the BNPL demo artifact) run ONLY in development.
 *
 * A Postgres advisory lock serializes seeding when several replicas boot together; every
 * operation is an upsert, so a second run converges on the same state either way. Enabled by
 * default outside `test`; override with STARTUP_SEED_ENABLED. Kept out of the CLI seed path
 * so `prisma db seed` and the startup injector share the exact same {@link runSeeds} logic.
 *
 * **Es trabajo de fondo, y por eso solo corre donde corren los trabajos de fondo**
 * (`WORKER_ROLE` ∈ ALL, WORKER). Una réplica de API que sembraba al arrancar pagaba una
 * ronda completa de upserts sobre el catálogo antes de aceptar su primera petición, y
 * escalar la API a N réplicas convertía cada despliegue en N intentos compitiendo por el
 * mismo bloqueo consultivo para hacer exactamente el mismo trabajo. En un despliegue
 * orquestado la fuente de verdad siguen siendo los Jobs de migración y semilla; esto es la
 * red de seguridad del proceso de fondo y el camino cómodo de desarrollo (`WORKER_ROLE=ALL`).
 */
@Injectable()
export class SeedingService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SeedingService.name);
  private readonly enabled: boolean;
  private readonly mockup: ReturnType<typeof resolveMockupPolicy>;
  private readonly role: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    const nodeEnv = config.get<string>('NODE_ENV') ?? 'development';
    this.role = workerRoleOf(config);
    // Default on everywhere except automated tests, which provision their own fixtures.
    this.enabled =
      runsBackgroundJobs(config) &&
      (config.get<boolean>('STARTUP_SEED_ENABLED') ?? nodeEnv !== 'test');
    // Misma regla que el Job de siembra (`prisma/seed.ts`): una sola función decide, y
    // `SEED_INCLUDE_MOCKUP` también se honra aquí. Cuando no está declarada, el valor sigue
    // saliendo de `NODE_ENV`, así que el comportamiento por defecto no cambia.
    this.mockup = resolveMockupPolicy({ ...process.env, NODE_ENV: nodeEnv });
  }

  async onApplicationBootstrap(): Promise<void> {
    if (!this.enabled) {
      this.logger.log(`Startup seeding not run in this process (WORKER_ROLE=${this.role})`);
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
      this.logger.log(describeMockupDecision(this.mockup));
      const summary = await runSeeds(this.prisma, { includeMockup: this.mockup.includeMockup });
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
