import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { ReadOnlyConnectionError } from '../src/common/persistence/errors/persistence-errors';
import { applyTenantRls } from '../src/common/prisma/tenant-rls';

/**
 * La guardia de solo lectura del cliente de la ruta de lectura.
 *
 * El privilegio del rol `atlas_reader` es la barrera real; esta guardia es la que convierte
 * «el lector no tiene permiso» en un error del dominio, inmediato y con nombre, en vez de
 * un 42501 a medio camino de una petición.
 *
 * Construir un `Pool` y un `PrismaClient` no abre ninguna sesión, y el rechazo ocurre antes
 * de emitir consulta alguna: por eso esta prueba no necesita base de datos.
 */
describe('read path write guard', () => {
  const pool = new Pool({ connectionString: 'postgresql://nobody:x@127.0.0.1:1/none' });
  const base = new PrismaClient({ adapter: new PrismaPg(pool, { disposeExternalPool: false }) });
  const readOnly = applyTenantRls(base, {
    currentTenantId: () => undefined,
    connectionName: 'postgres-read',
    readOnly: true,
  });

  afterAll(async () => {
    await pool.end();
  });

  it.each(['create', 'update', 'upsert', 'delete', 'createMany', 'updateMany', 'deleteMany'])(
    'rejects %s before it reaches the database',
    async (operation) => {
      const model = readOnly.decisionArtifact as unknown as Record<
        string,
        (args: unknown) => Promise<unknown>
      >;

      await expect(model[operation]({ where: { id: 1n }, data: {} })).rejects.toBeInstanceOf(
        ReadOnlyConnectionError,
      );
    },
  );

  it('rejects raw statement execution', () => {
    // `$executeRaw` no pasa por la extensión de modelos: si no se bloqueara aparte, la
    // ruta de lectura seguiría teniendo una puerta abierta a la escritura.
    expect(() => readOnly.$executeRaw`DELETE FROM decision_artifact`).toThrow(
      ReadOnlyConnectionError,
    );
    expect(() => readOnly.$executeRawUnsafe('DELETE FROM decision_artifact')).toThrow(
      ReadOnlyConnectionError,
    );
  });

  it('names the connection in the error so the log says which path was misused', () => {
    try {
      // `void`: la guardia lanza de forma SÍNCRONA, así que nunca llega a existir la
      // promesa que el tipo declara; el marcador lo hace explícito.
      void readOnly.$executeRawUnsafe('TRUNCATE decision_artifact');
      fail('expected the write to be rejected');
    } catch (error) {
      expect((error as ReadOnlyConnectionError).context.connectionName).toBe('postgres-read');
    }
  });

  it('leaves reads untouched', () => {
    // La guardia no puede convertirse en un impuesto sobre la lectura: `findMany` devuelve
    // el `PrismaPromise` de siempre —un thenable perezoso, no una promesa nativa— en vez de
    // lanzar, lo que prueba que la llamada llegó al cliente.
    const pending = readOnly.decisionArtifact.findMany({ where: { tenantId: 1n } });

    expect(typeof pending.then).toBe('function');
    pending.catch(() => undefined);
  });
});
