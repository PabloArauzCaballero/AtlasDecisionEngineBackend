import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { HashService } from '../src/common/crypto/hash.service';
import { IntegrationClientService } from '../src/common/security/integration-client.service';
import type { PrismaService } from '../src/common/prisma/prisma.service';

/**
 * Exercises IntegrationClientService against a real PostgreSQL instance so the
 * credential lookup, status handling and tenant scoping are proven with actual
 * queries rather than mocks. Skips when no database is reachable.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

describeDb('IntegrationClientService (integration)', () => {
  // engineType is `client`, so a driver adapter is required exactly as PrismaService does it.
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL }) });
  const hashes = new HashService(new ConfigService({ AUDIT_HASH_SECRET: 'test-secret' }));
  const service = new IntegrationClientService(prisma as unknown as PrismaService, hashes);

  const secrets = {
    active: 'secret-active-0123456789abcdef',
    revokedCredential: 'secret-revoked-0123456789abcdef',
    expired: 'secret-expired-0123456789abcdef',
    suspendedClient: 'secret-suspended-0123456789abcdef',
    runtime: 'secret-runtime-0123456789abcdef',
  };
  const clientKeys = ['test-active', 'test-suspended', 'test-runtime'];

  beforeAll(async () => {
    await prisma.integrationClient.deleteMany({ where: { clientKey: { in: clientKeys } } });

    await prisma.integrationClient.create({
      data: {
        clientKey: 'test-active',
        displayName: 'Active management client',
        audience: 'management',
        status: 'ACTIVE',
        scopes: { create: [{ scope: 'DECISION_CONSUMER' }, { scope: 'ARTIFACT_READER' }] },
        tenantAccess: { create: [{ tenantId: 7n }, { tenantId: 8n }] },
        credentials: {
          create: [
            { secretHash: hashes.sha256(secrets.active), label: 'active', status: 'ACTIVE' },
            {
              secretHash: hashes.sha256(secrets.revokedCredential),
              label: 'revoked',
              status: 'REVOKED',
            },
            {
              secretHash: hashes.sha256(secrets.expired),
              label: 'expired',
              status: 'ACTIVE',
              expiresAt: new Date(Date.now() - 60_000),
            },
          ],
        },
      },
    });

    await prisma.integrationClient.create({
      data: {
        clientKey: 'test-suspended',
        displayName: 'Suspended client',
        audience: 'management',
        status: 'SUSPENDED',
        scopes: { create: [{ scope: 'DECISION_CONSUMER' }] },
        tenantAccess: { create: [{ tenantId: 7n }] },
        credentials: {
          create: [{ secretHash: hashes.sha256(secrets.suspendedClient), label: 'k' }],
        },
      },
    });

    await prisma.integrationClient.create({
      data: {
        clientKey: 'test-runtime',
        displayName: 'Runtime client',
        audience: 'runtime',
        status: 'ACTIVE',
        scopes: { create: [{ scope: 'DECISION_EXECUTOR' }] },
        tenantAccess: { create: [{ tenantId: 7n }] },
        credentials: { create: [{ secretHash: hashes.sha256(secrets.runtime), label: 'k' }] },
      },
    });
  });

  afterAll(async () => {
    await prisma.integrationClient.deleteMany({ where: { clientKey: { in: clientKeys } } });
    await prisma.$disconnect();
  });

  it('resolves an active credential to its registered scopes and tenants', async () => {
    const resolved = await service.resolve(secrets.active, 'management');

    expect(resolved.clientKey).toBe('test-active');
    expect(resolved.roles.sort()).toEqual(['ARTIFACT_READER', 'DECISION_CONSUMER']);
    expect(resolved.tenantIds.sort()).toEqual([7n, 8n]);
  });

  it('rejects an unknown secret', async () => {
    await expect(service.resolve('no-such-secret', 'management')).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('rejects a revoked credential', async () => {
    await expect(service.resolve(secrets.revokedCredential, 'management')).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('rejects an expired credential', async () => {
    await expect(service.resolve(secrets.expired, 'management')).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('rejects a credential whose client is suspended', async () => {
    await expect(service.resolve(secrets.suspendedClient, 'management')).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('refuses to honour a runtime credential on the management audience', async () => {
    await expect(service.resolve(secrets.runtime, 'management')).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
    await expect(service.resolve(secrets.runtime, 'runtime')).resolves.toMatchObject({
      clientKey: 'test-runtime',
    });
  });

  it('records last use for a successful resolution', async () => {
    await service.resolve(secrets.active, 'management');
    // lastUsedAt is updated on a detached promise, so allow it to settle.
    await new Promise((resolve) => setTimeout(resolve, 200));

    const credential = await prisma.integrationCredential.findUnique({
      where: { secretHash: hashes.sha256(secrets.active) },
    });
    expect(credential?.lastUsedAt).not.toBeNull();
  });
});
