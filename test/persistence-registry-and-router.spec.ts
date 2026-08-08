import {
  ADMIN_CONNECTION,
  ConnectionRegistryService,
  READ_CONNECTION,
  WRITE_CONNECTION,
} from '../src/common/persistence/connections/connection-registry.service';
import {
  DataSourceConfigurationError,
  UnsupportedCapabilityError,
} from '../src/common/persistence/errors/persistence-errors';
import { DataSourceRouterService } from '../src/common/persistence/routing/data-source-router.service';
import { configStub } from './support/config-stub';

/**
 * Registro y router juntos: son la pieza que decide qué conexión sirve cada operación, y
 * las decisiones que toman deben ser demostrables sin una base de datos delante. Construir
 * un `Pool` de `pg` no abre ninguna sesión, así que estas pruebas son unitarias de verdad.
 */
const PRIMARY = 'postgresql://atlas_writer:pw@localhost:5432/atlas?schema=public';
const READER_SAME_SERVER = 'postgresql://atlas_reader:pw@localhost:5432/atlas?schema=public';
const REPLICA = 'postgresql://atlas_reader:pw@replica.internal:5432/atlas?schema=public';

function registryFor(env: Record<string, unknown>): ConnectionRegistryService {
  return new ConnectionRegistryService(configStub({ DATABASE_URL: PRIMARY, ...env }));
}

function routerFor(
  registry: ConnectionRegistryService,
  env: Record<string, unknown> = {},
): DataSourceRouterService {
  return new DataSourceRouterService(registry, configStub(env));
}

describe('connection registry', () => {
  afterEach(() => jest.restoreAllMocks());

  it('shares one pool when read and write resolve to the same target (Escenario A)', async () => {
    const registry = registryFor({});

    expect(registry.readSharesWrite).toBe(true);
    expect(registry.get(READ_CONNECTION)).toBe(registry.get(WRITE_CONNECTION));
    await registry.closeAll();
  });

  it('opens a second pool when the read role differs (Escenario B)', async () => {
    const registry = registryFor({ DATABASE_READ_URL: READER_SAME_SERVER });

    expect(registry.readSharesWrite).toBe(false);
    expect(registry.get(READ_CONNECTION)).not.toBe(registry.get(WRITE_CONNECTION));
    expect(registry.get(READ_CONNECTION).role).toBe('read');
    await registry.closeAll();
  });

  it('reports both logical names even when they share one pool', async () => {
    const registry = registryFor({});
    // La sonda se responde sin tocar la red: lo que se comprueba es el etiquetado, no que
    // haya un Postgres escuchando.
    jest.spyOn(registry.get(WRITE_CONNECTION), 'healthCheck').mockResolvedValue({
      name: WRITE_CONNECTION,
      engine: 'postgresql',
      role: 'write',
      status: 'up',
    });

    const health = await registry.healthAll();

    // Quien lee la sonda conoce dos rutas; verlas colapsadas en una le haría creer que la
    // conexión de lectura no existe.
    expect(health.map((entry) => entry.name).sort()).toEqual([READ_CONNECTION, WRITE_CONNECTION]);
    await registry.closeAll();
  });

  it('refuses a duplicate name and the reserved administrative name', async () => {
    const registry = registryFor({});
    const duplicate = registry.get(WRITE_CONNECTION);

    expect(() => registry.register(duplicate)).toThrow(DataSourceConfigurationError);
    expect(() =>
      registry.register({ ...duplicate, name: ADMIN_CONNECTION } as typeof duplicate),
    ).toThrow(/reserved for migrations/);
    await registry.closeAll();
  });

  it('fails on an unknown connection instead of returning undefined', async () => {
    const registry = registryFor({});

    expect(() => registry.get('postgres-nowhere')).toThrow(DataSourceConfigurationError);
    await registry.closeAll();
  });
});

describe('data source router', () => {
  it('sends writes to the primary and eventual reads to the read connection', async () => {
    const registry = registryFor({ DATABASE_READ_URL: READER_SAME_SERVER });
    const router = routerFor(registry);

    expect(router.resolve({ module: 'audit-query', operation: 'write' }).connectionName).toBe(
      WRITE_CONNECTION,
    );
    expect(router.resolve({ module: 'audit-query', operation: 'read' }).connectionName).toBe(
      READ_CONNECTION,
    );
    await registry.closeAll();
  });

  it('sends read-after-write to the primary even with a read connection available', async () => {
    const registry = registryFor({ DATABASE_READ_URL: REPLICA });
    const router = routerFor(registry);

    const resolved = router.resolve({
      module: 'audit-query',
      operation: 'read',
      consistency: 'read-after-write',
    });

    expect(resolved.connectionName).toBe(WRITE_CONNECTION);
    expect(resolved.upgradedToPrimary).toBe(true);
    await registry.closeAll();
  });

  it('anchors the decision path to the primary by default', async () => {
    const registry = registryFor({ DATABASE_READ_URL: REPLICA });
    const router = routerFor(registry);

    // `runtime` lee lo que acaba de escribir (idempotencia, despliegue activo): servirlo
    // desde una réplica devolvería una decisión tomada con estado viejo.
    expect(router.resolve({ module: 'runtime', operation: 'read' }).connectionName).toBe(
      WRITE_CONNECTION,
    );
    await registry.closeAll();
  });

  it('serves a strong read from a second role on the same server', async () => {
    const registry = registryFor({ DATABASE_READ_URL: READER_SAME_SERVER });
    const router = routerFor(registry);

    // Dos credenciales contra la misma base ven exactamente los mismos datos: aquí una
    // lectura fuerte es legítima y no hay razón para cargar el primario.
    expect(router.isReplica(READ_CONNECTION)).toBe(false);
    expect(
      router.resolve({ module: 'default', operation: 'read', consistency: 'strong' })
        .connectionName,
    ).toBe(READ_CONNECTION);
    await registry.closeAll();
  });

  it('upgrades a strong read to the primary when the read connection is a replica', async () => {
    const registry = registryFor({ DATABASE_READ_URL: REPLICA });
    const router = routerFor(registry);

    expect(router.isReplica(READ_CONNECTION)).toBe(true);
    const resolved = router.resolve({
      module: 'default',
      operation: 'read',
      consistency: 'strong',
    });

    // Servir una lectura declarada fuerte desde una réplica sería afirmar una consistencia
    // que no existe.
    expect(resolved.connectionName).toBe(WRITE_CONNECTION);
    expect(resolved.upgradedToPrimary).toBe(true);
    await registry.closeAll();
  });

  it('refuses to start when a rule names an unknown connection', async () => {
    const registry = registryFor({});

    expect(() =>
      routerFor(registry, {
        DATA_ROUTING_RULES: JSON.stringify({ views: { read: 'postgres-elsewhere' } }),
      }),
    ).toThrow(/unknown connection "postgres-elsewhere"/);
    await registry.closeAll();
  });

  it('refuses to route a write to a read-only connection', async () => {
    const registry = registryFor({ DATABASE_READ_URL: READER_SAME_SERVER });

    expect(() =>
      routerFor(registry, {
        DATA_ROUTING_RULES: JSON.stringify({ views: { write: READ_CONNECTION } }),
      }),
    ).toThrow(/registered as read-only/);
    await registry.closeAll();
  });

  it('refuses to route anything to the administrative connection', async () => {
    const registry = registryFor({});

    expect(() =>
      routerFor(registry, {
        DATA_ROUTING_RULES: JSON.stringify({ views: { read: ADMIN_CONNECTION } }),
      }),
    ).toThrow(/reserved for migrations and provisioning/);
    await registry.closeAll();
  });

  it('refuses a route whose engine lacks a required capability', async () => {
    const registry = registryFor({});
    // Redis no ofrece transacciones con rollback; un módulo que las exija no puede vivir
    // ahí, y eso debe verse al arrancar y no en la primera escritura compuesta.
    registry.register({
      name: 'redis-cache',
      engine: 'redis',
      provider: 'generic',
      role: 'read-write',
      fingerprint: 'redis|test',
      connect: async () => undefined,
      healthCheck: async () => ({
        name: 'redis-cache',
        engine: 'redis' as const,
        role: 'read-write' as const,
        status: 'up' as const,
      }),
      poolStats: () => undefined,
      close: async () => undefined,
    });

    expect(() =>
      routerFor(registry, {
        DATA_ROUTING_RULES: JSON.stringify({
          sessions: { read: 'redis-cache', write: 'redis-cache', requires: ['transactions'] },
        }),
      }),
    ).toThrow(UnsupportedCapabilityError);
    await registry.closeAll();
  });

  it('rejects malformed routing rules instead of ignoring them', async () => {
    const registry = registryFor({});

    expect(() => routerFor(registry, { DATA_ROUTING_RULES: '{not json' })).toThrow(
      /DATA_ROUTING_RULES is not valid JSON/,
    );
    expect(() =>
      routerFor(registry, {
        DATA_ROUTING_RULES: JSON.stringify({ views: { read: 'NOPE UPPER' } }),
      }),
    ).toThrow(/DATA_ROUTING_RULES is invalid/);
    await registry.closeAll();
  });

  it('merges an override without erasing what it does not mention', async () => {
    const registry = registryFor({ DATABASE_READ_URL: READER_SAME_SERVER });
    const router = routerFor(registry, {
      DATA_ROUTING_RULES: JSON.stringify({ 'audit-query': { consistency: 'strong' } }),
    });

    const rules = router.effectiveRules()['audit-query'];

    expect(rules.consistency).toBe('strong');
    expect(rules.read).toBe(READ_CONNECTION);
    expect(rules.write).toBe(WRITE_CONNECTION);
    await registry.closeAll();
  });
});
