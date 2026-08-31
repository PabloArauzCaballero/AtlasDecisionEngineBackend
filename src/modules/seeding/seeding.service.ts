import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from 'pg';
import { Prisma } from '@prisma/client';
import { runsBackgroundJobs, workerRoleOf } from '../../common/config/worker-role';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AdvisoryLockDomain, advisoryLockKey } from '../../common/prisma/advisory-lock';
import { seedIntegrationClients } from '../../common/seeding/seed-local-clients';
import { resolveSeedSource } from '../../common/seeding/seed-source';
import { listSeededTables, syncSeedData } from '../../common/seeding/seed-sync';

// Stable key for the Postgres session-level advisory lock that serializes startup seeding
// across replicas. Only the holder seeds; the rest skip immediately. Namespaced by domain
// (advisory-lock.ts) so it cannot land on a tenant's audit-chain key or a deployment's.
const SEED_ADVISORY_LOCK_KEY = advisoryLockKey(AdvisoryLockDomain.Seeding);

/**
 * Trae el conjunto sembrado al arrancar, cuando la base está VACÍA.
 *
 * Antes esto ejecutaba `runSeeds`: ~800 KB de catálogos escritos como código TypeScript bajo
 * `modules/seeding/data/` que se recorrían en cada arranque haciendo upserts. Ese conjunto ya no
 * vive en el repositorio sino en una RAMA de PostgreSQL gestionado, y aquí sólo se copia.
 *
 * El cambio trae una condición nueva que antes no hacía falta. `runSeeds` era idempotente por
 * construcción —todo eran upserts—, así que correrlo en cada arranque no destruía nada; la copia,
 * en cambio, VACÍA las tablas del manifiesto antes de escribirlas. Por eso este servicio comprueba
 * primero si la base tiene datos y, si los tiene, no toca nada: reiniciar un proceso no puede ser
 * la forma de perder el trabajo de la sesión anterior. Para rehacer la siembra a propósito está
 * `yarn prisma:seed`, que es un acto deliberado de una persona.
 *
 * También desaparece la distinción bootstrap/mockup (`SEED_INCLUDE_MOCKUP`): lo que llega es lo que
 * la rama publica. La rama de desarrollo trae el artefacto de demostración; la de producción, no.
 *
 * Lo único que NO viene de la rama son las credenciales de integración: una clave de API es un
 * secreto del entorno, y copiarla significaría instalar en producción la credencial de desarrollo
 * de quien capturó la instantánea. Se registran aparte, leyendo el entorno de esta instalación, y
 * se hace SIEMPRE —no sólo con la base vacía— porque rotar una clave en el entorno tiene que poder
 * aplicarse sin volver a sembrar.
 *
 * **Es trabajo de fondo, y por eso solo corre donde corren los trabajos de fondo**
 * (`WORKER_ROLE` ∈ ALL, WORKER). Una réplica de API que sembraba al arrancar pagaba una ronda
 * completa antes de aceptar su primera petición, y escalar la API a N réplicas convertía cada
 * despliegue en N intentos compitiendo por el mismo bloqueo consultivo para hacer el mismo trabajo.
 */
@Injectable()
export class SeedingService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SeedingService.name);
  private readonly enabled: boolean;
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
  }

  async onApplicationBootstrap(): Promise<void> {
    if (!this.enabled) {
      this.logger.log(`Startup seeding not run in this process (WORKER_ROLE=${this.role})`);
      return;
    }

    const seedSource = resolveSeedSource();
    if (!seedSource) {
      this.logger.log('Startup seeding skipped: no SEED_SOURCE_* configured');
      return;
    }

    const [{ locked }] = await this.prisma.$queryRaw<{ locked: boolean }[]>(
      Prisma.sql`SELECT pg_try_advisory_lock(${SEED_ADVISORY_LOCK_KEY}) AS locked`,
    );
    if (!locked) {
      this.logger.log('Another instance holds the seed lock; skipping startup seeding');
      return;
    }

    const source = new Client({
      connectionString: seedSource.connectionString,
      ssl: seedSource.ssl,
    });
    const target = new Client({ connectionString: process.env.DATABASE_URL });
    try {
      await source.connect();
      await target.connect();

      const existing = await listSeededTables(target);
      if (existing.length > 0) {
        this.logger.log(
          `Startup seeding skipped: the database already holds data (${existing.length} populated tables). ` +
            'Run `yarn prisma:seed` to replace it with what the branch publishes.',
        );
      } else {
        this.logger.log(
          `Empty database: pulling the published seed set from ${seedSource.describe}`,
        );
        const summary = await syncSeedData({
          source,
          target,
          log: (message) => this.logger.debug(message),
        });
        this.logger.log(
          `Startup seeding complete: ${summary.rows} rows across ${summary.tables} tables`,
        );
      }

      const clients = await seedIntegrationClients(this.prisma);
      if (clients.length > 0) {
        this.logger.log(
          `Integration clients registered from this environment: ${clients.map((c) => c.clientKey).join(', ')}`,
        );
      }
    } catch (error) {
      // A seeding failure must not silently leave the platform running against an empty
      // catalog, so it is surfaced and rethrown to abort startup.
      this.logger.error(
        `Startup seeding failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    } finally {
      await source.end().catch(() => undefined);
      await target.end().catch(() => undefined);
      await this.prisma.$queryRaw(Prisma.sql`SELECT pg_advisory_unlock(${SEED_ADVISORY_LOCK_KEY})`);
    }
  }
}
