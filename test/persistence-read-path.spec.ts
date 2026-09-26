import type { PrismaClient } from '@prisma/client';
import { RequestContextService } from '../src/common/context/request-context.service';
import { MetricsService } from '../src/common/observability/metrics.service';
import { ReadPathService } from '../src/common/persistence/adapters/postgres/read-path.service';
import {
  READ_CONNECTION,
  WRITE_CONNECTION,
} from '../src/common/persistence/connections/connection-registry.service';
import {
  ConnectionUnavailableError,
  DuplicateEntityError,
} from '../src/common/persistence/errors/persistence-errors';
import type { DataSourceRouterService } from '../src/common/persistence/routing/data-source-router.service';
import { configStub } from './support/config-stub';

/**
 * La ruta de lectura concentra el enrutamiento, el interruptor de rollback, el fallback y
 * la medida. Esto fija lo que no puede pasar nunca: que un fallback ocurra sin dejar
 * rastro, y que apagar el interruptor no devuelva de verdad todo al primario.
 */
describe('read path', () => {
  const readClient = { tag: 'read' } as unknown as PrismaClient;
  const writeClient = { tag: 'write' } as unknown as PrismaClient;

  function routerStub(connectionName: string): DataSourceRouterService {
    return {
      resolve: ({ consistency }: { consistency?: string }) => ({
        connectionName: consistency === 'read-after-write' ? WRITE_CONNECTION : connectionName,
        engine: 'postgresql',
        role: connectionName === WRITE_CONNECTION ? 'write' : 'read',
        consistency: consistency ?? 'eventual',
        upgradedToPrimary: false,
      }),
    } as unknown as DataSourceRouterService;
  }

  function build(env: Record<string, unknown>, connectionName = READ_CONNECTION) {
    const metrics = new MetricsService();
    const service = new ReadPathService(
      routerStub(connectionName),
      readClient as never,
      writeClient as never,
      metrics,
      new RequestContextService(),
      configStub(env),
    );
    return { service, metrics };
  }

  it('serves an eventual read from the read connection', async () => {
    const { service } = build({ DATA_READ_ROUTING_ENABLED: true });

    const used = await service.run('audit-query', 'listAuditEvents', async (client) => client);

    expect(used).toBe(readClient);
  });

  it('returns every read to the primary when the switch is off', async () => {
    // Es el rollback de esta migración: una variable, sin desplegar código.
    const { service } = build({ DATA_READ_ROUTING_ENABLED: false });

    const used = await service.run('audit-query', 'listAuditEvents', async (client) => client);

    expect(used).toBe(writeClient);
    expect(service.resolve('audit-query').connectionName).toBe(WRITE_CONNECTION);
  });

  it('falls back to the primary when the read connection is unavailable, and declares it', async () => {
    const { service, metrics } = build({
      DATA_READ_ROUTING_ENABLED: true,
      ENABLE_PRIMARY_READ_FALLBACK: true,
    });

    const used = await service.run('audit-query', 'listAuditEvents', async (client) => {
      if (client === readClient) throw Object.assign(new Error('down'), { code: '08006' });
      return client;
    });

    expect(used).toBe(writeClient);
    // Un fallback que nadie puede ver es una réplica caída que nadie arregla.
    const exposed = await metrics.renderPrometheus();
    expect(exposed).toContain('atlas_database_fallback_total');
    expect(exposed).toContain(`from_connection="${READ_CONNECTION}"`);
    expect(exposed).toContain('reason="ConnectionUnavailableError"');
    expect(exposed).toContain('atlas_database_connection_failures_total');
  });

  it('fails fast when the fallback is disabled', async () => {
    const { service } = build({
      DATA_READ_ROUTING_ENABLED: true,
      ENABLE_PRIMARY_READ_FALLBACK: false,
    });

    await expect(
      service.run('audit-query', 'listAuditEvents', async () => {
        throw Object.assign(new Error('down'), { code: '08006' });
      }),
    ).rejects.toBeInstanceOf(ConnectionUnavailableError);
  });

  it('does not retry a failure that the primary would repeat', async () => {
    const { service } = build({ DATA_READ_ROUTING_ENABLED: true });
    const query = jest.fn(async () => {
      throw Object.assign(new Error('duplicate'), { code: '23505' });
    });

    // Solo la indisponibilidad justifica cambiar de conexión. Reintentar un conflicto de
    // datos contra el primario duplicaría la carga para obtener el mismo error.
    await expect(service.run('audit-query', 'listAuditEvents', query)).rejects.toBeInstanceOf(
      DuplicateEntityError,
    );
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('records duration and outcome per connection and module', async () => {
    const { service, metrics } = build({ DATA_READ_ROUTING_ENABLED: true });

    await service.run('audit-query', 'searchExecutions', async () => 'ok');
    const exposed = await metrics.renderPrometheus();

    expect(exposed).toContain('atlas_database_operation_total');
    expect(exposed).toContain('module="audit-query"');
    expect(exposed).toContain('operation="searchExecutions"');
    expect(exposed).toContain('outcome="ok"');
    expect(exposed).toContain('atlas_database_operation_duration_ms_bucket');
  });

  it('honours a read-after-write context by using the primary', async () => {
    const { service } = build({ DATA_READ_ROUTING_ENABLED: true });

    const used = await service.run('audit-query', 'findExecutionById', async (client) => client, {
      consistency: 'read-after-write',
    });

    expect(used).toBe(writeClient);
  });

  it('refuses to serve a connection it does not own instead of picking the wrong client', async () => {
    // La fábrica ya rechaza al arrancar una regla que mande este módulo a otro motor. Si
    // aun así llegara hasta aquí, servir la consulta por el cliente equivocado sería un
    // error silencioso: la lectura iría a la base que no es y nadie se enteraría.
    const { service } = build({ DATA_READ_ROUTING_ENABLED: true }, 'opensearch-audit');

    await expect(
      service.run('audit-query', 'listAuditEvents', async (client) => client),
    ).rejects.toThrow(/cannot serve connection "opensearch-audit"/);
  });
});
