/**
 * Fábrica de adaptadores de lectura para pruebas que hablan con una base real sin levantar
 * el contenedor de Nest.
 *
 * Entrega un asa que ejecuta contra el cliente que se le pase, sin enrutamiento ni
 * fallback: eso ya tiene sus propias pruebas unitarias. Lo que estas suites verifican es
 * que el ADAPTADOR traduce bien el puerto a SQL, que es una responsabilidad distinta.
 */
import type { PrismaClient } from '@prisma/client';
import type {
  PersistenceAdapterFactory,
  ReadAdapterHandle,
} from '../../src/common/persistence/factory/persistence-adapter.factory';
import type { ResolvedDataSource } from '../../src/common/persistence/routing/data-source-router.service';

export function directReadAdapterFactory(client: PrismaClient): PersistenceAdapterFactory {
  const handle: ReadAdapterHandle = {
    run: (_operation, query) => query(client),
    describe: () =>
      ({
        connectionName: 'postgres-read',
        engine: 'postgresql',
        role: 'read',
        consistency: 'eventual',
        upgradedToPrimary: false,
      }) as unknown as ResolvedDataSource,
  };
  return { createReadAdapter: () => handle } as unknown as PersistenceAdapterFactory;
}
