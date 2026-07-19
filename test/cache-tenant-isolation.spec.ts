import { ConfigService } from '@nestjs/config';
import { CacheService } from '../src/common/cache/cache.service';

/**
 * Plan §2.9 / D-8: tenant-scoped cache helpers must keep tenants from reading each other's
 * cached values, even when they use the same logical key. Uses the in-memory fallback (no
 * REDIS_URL), so no external dependency.
 */
describe('CacheService tenant isolation', () => {
  function cache(): CacheService {
    return new CacheService(new ConfigService({ NODE_ENV: 'test' }));
  }

  it('does not let one tenant read another tenant\'s value for the same key', async () => {
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

  it('invalidates only the owning tenant\'s entry', async () => {
    const c = cache();
    await c.setForTenant(1n, 'k', 'v1', 60);
    await c.setForTenant(2n, 'k', 'v2', 60);

    await c.delForTenant(1n, 'k');

    expect(await c.getForTenant(1n, 'k')).toBeNull();
    expect(await c.getForTenant(2n, 'k')).toBe('v2');
  });
});
