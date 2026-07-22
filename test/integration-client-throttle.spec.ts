import type { HashService } from '../src/common/crypto/hash.service';
import type { PrismaService } from '../src/common/prisma/prisma.service';
import { IntegrationClientService } from '../src/common/security/integration-client.service';

/**
 * The `lastUsedAt` write sits on the runtime hot path (every authenticated request).
 * It is throttled so a busy credential does not issue a write per request; these tests
 * pin the throttle window behaviour without a database.
 */
describe('IntegrationClientService lastUsedAt throttle', () => {
  const hashes = { sha256: (value: unknown) => `hash:${String(value)}` } as unknown as HashService;

  function credential(lastUsedAt: Date | null) {
    return {
      id: 7n,
      status: 'ACTIVE',
      expiresAt: null,
      lastUsedAt,
      client: {
        clientKey: 'test-client',
        status: 'ACTIVE',
        audience: 'runtime',
        scopes: [{ scope: 'runtime:execute' }],
        tenantAccess: [{ tenantId: 3n }],
      },
    };
  }

  function service(cred: ReturnType<typeof credential>, updateMany: jest.Mock) {
    const prisma = {
      integrationCredential: {
        findUnique: jest.fn().mockResolvedValue(cred),
        updateMany,
      },
    };
    return new IntegrationClientService(prisma as unknown as PrismaService, hashes);
  }

  it('skips the write when the credential was used within the window', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const svc = service(credential(new Date()), updateMany);

    const resolved = await svc.resolve('secret', 'runtime');

    expect(resolved.clientKey).toBe('test-client');
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('records use when last seen is null', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const svc = service(credential(null), updateMany);

    await svc.resolve('secret', 'runtime');

    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany.mock.calls[0][0].where.id).toBe(7n);
  });

  it('records use when last seen is older than the window', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const svc = service(credential(new Date(Date.now() - 10 * 60 * 1_000)), updateMany);

    await svc.resolve('secret', 'runtime');

    expect(updateMany).toHaveBeenCalledTimes(1);
  });
});
