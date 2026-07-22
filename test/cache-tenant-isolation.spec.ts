import { ConfigService } from '@nestjs/config';
import { CacheService } from '../src/common/cache/cache.service';

/**
 * Plan §2.9 / D-8: tenant-scoped cache helpers must keep tenants from reading each other's
 * cached values, even when they use the same logical key. Uses the in-memory fallback (no
 * REDIS_URL), so no external dependency.
 */
describe('CacheService tenant isolation', () => {
  const created: CacheService[] = [];

  function cache(): CacheService {
    // REDIS_URL is pinned empty on purpose. Any spec that boots AppModule runs
    // ConfigModule.forRoot(), which loads `.env` into process.env for the rest of the Jest
    // process; ConfigService then handed this suite the developer's REDIS_URL and CacheService
    // opened a real socket, leaving Jest hanging on an open handle after the run. An explicit
    // empty value keeps the in-memory fallback this suite documents, whatever `.env` holds.
    const service = new CacheService(new ConfigService({ NODE_ENV: 'test', REDIS_URL: '' }));
    created.push(service);
    return service;
  }

  // Defense in depth: if a client ever is created, it must not outlive the suite.
  afterEach(async () => {
    await Promise.all(created.splice(0).map((service) => service.onModuleDestroy()));
  });

  it("does not let one tenant read another tenant's value for the same key", async () => {
    const c = cache();
    await c.setForTenant(1n, 'binding:X:PROD', 'tenant-1-value', 60);
    await c.setForTenant(2n, 'binding:X:PROD', 'tenant-2-value', 60);

    expect(await c.getForTenant(1n, 'binding:X:PROD')).toBe('tenant-1-value');
    expect(await c.getForTenant(2n, 'binding:X:PROD')).toBe('tenant-2-value');
  });

  it('returns null for a key another tenant set', async () => {
    const c = cache();
    await c.setForTenant(1n, 'k', 'v', 60);
    expect(await c.getForTenant(99n, 'k')).toBeNull();
  });

  it("invalidates only the owning tenant's entry", async () => {
    const c = cache();
    await c.setForTenant(1n, 'k', 'v1', 60);
    await c.setForTenant(2n, 'k', 'v2', 60);

    await c.delForTenant(1n, 'k');

    expect(await c.getForTenant(1n, 'k')).toBeNull();
    expect(await c.getForTenant(2n, 'k')).toBe('v2');
  });
});
