/**
 * Prisma CLI entrypoint: trae el conjunto sembrado que publica la rama de semillas.
 *
 * Sustituye a `runSeeds`, que recorría los catálogos escritos como código bajo
 * `src/modules/seeding/data/`. Ese conjunto ya no vive en el repositorio: vive en una RAMA de
 * PostgreSQL gestionado (`SEED_SOURCE_*`), y la rama ES el perfil —la de desarrollo publica también
 * el artefacto de demostración; la de producción, no—. Por eso desaparece `SEED_INCLUDE_MOCKUP`: a
 * la rama de producción no se le puede PEDIR lo que no tiene.
 *
 * Es DESTRUCTIVO sobre las tablas del manifiesto: las vacía antes de cargarlas, para que el
 * resultado sea el conjunto publicado y no una mezcla con lo que hubiera antes. Por eso el Job del
 * compose declara `SEED_ONLY_IF_EMPTY=true`: ese Job corre en cada `docker compose up`, y sin la
 * guarda levantar el stack reemplazaría el catálogo con el que se estuvo trabajando. Quien quiere
 * justamente ese reemplazo lo pide a mano, sin la variable.
 *
 * Lo único que NO viene de la rama son las credenciales de integración: una clave de API es un
 * secreto del entorno, así que se registran después, leyendo `process.env` en esta máquina.
 */
import { Client } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { seedIntegrationClients } from '../src/common/seeding/seed-local-clients';
import { requireSeedSource } from '../src/common/seeding/seed-source';
import { hasSeedLoad, syncSeedData } from '../src/common/seeding/seed-sync';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required to seed the database');

const seedSource = requireSeedSource();
const source = new Client({ connectionString: seedSource.connectionString, ssl: seedSource.ssl });
const target = new Client({ connectionString });

const onlyIfEmpty =
  process.argv.includes('--if-empty') || process.env.SEED_ONLY_IF_EMPTY === 'true';

async function main(): Promise<void> {
  await source.connect();
  await target.connect();
  try {
    console.log(`Rama de semillas: ${seedSource.describe}`);

    // La guarda mira la MARCA de carga, no el número de filas: una base recién migrada ya puede
    // tener datos, y contarlos hacía que el Job se saltara la siembra en una base virgen.
    if (onlyIfEmpty && (await hasSeedLoad(target))) {
      console.log(
        JSON.stringify(
          {
            skipped: true,
            reason: 'esta base ya trajo el conjunto sembrado (atlas_seed.load_log)',
          },
          null,
          2,
        ),
      );
      return;
    }

    const summary = await syncSeedData({ source, target, sourceLabel: seedSource.describe });

    const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
    let clients: { clientKey: string }[] = [];
    try {
      clients = await seedIntegrationClients(prisma);
    } finally {
      await prisma.$disconnect();
    }

    console.log(
      JSON.stringify(
        {
          source: seedSource.describe,
          ...summary,
          integrationClients: clients.map((c) => c.clientKey),
        },
        null,
        2,
      ),
    );
  } finally {
    await source.end();
    await target.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
