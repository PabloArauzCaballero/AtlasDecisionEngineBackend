import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { HashService } from '../src/common/crypto/hash.service';
import { IdempotencyService } from '../src/modules/runtime/idempotency.service';
import type { PrismaService } from '../src/common/prisma/prisma.service';

/**
 * A transient failure must release the idempotency reservation so an identical
 * retry can re-claim the same key, instead of caching a terminal FAILED that traps it.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

describeDb('IdempotencyService release (integration)', () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL }) });
  const hashes = new HashService(new ConfigService({ AUDIT_HASH_SECRET: 'test-secret' }));
  const service = new IdempotencyService(
    prisma as unknown as PrismaService,
    hashes,
    new ConfigService({ IDEMPOTENCY_TTL_HOURS: 24 }),
  );
  // Unique per process, for the same reason as the lease suite: cleanup is by tenant, so a
  // fixed id makes two concurrent runs against one database clobber each other.
  const tenantId = 880_000_000_000n + BigInt(process.pid);
  const artifactCode = 'IDEMP_TEST';
  const key = 'key-release-1';

  afterEach(async () => {
    await prisma.runtimeIdempotency.deleteMany({ where: { tenantId } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('lets an identical retry re-reserve after a released (transient) failure', async () => {
    const first = await service.reserve(tenantId, artifactCode, key, 'hash-a');
    expect(first.kind).toBe('reserved');

    // Simulate the runtime releasing on a transient error.
    if (first.kind === 'reserved') await service.release(first.id, first.lease);

    const retry = await service.reserve(tenantId, artifactCode, key, 'hash-a');
    expect(retry.kind).toBe('reserved');
  });

  it('replays a cached deterministic failure instead of re-reserving', async () => {
    const first = await service.reserve(tenantId, artifactCode, key, 'hash-a');
    if (first.kind !== 'reserved') throw new Error('expected reservation');
    await service.fail(first.id, first.lease, { httpStatus: 422, body: { status: 'FAILED' } });

    const retry = await service.reserve(tenantId, artifactCode, key, 'hash-a');
    expect(retry.kind).toBe('completed');
    if (retry.kind === 'completed') expect(retry.status).toBe('FAILED');
  });

  it('rejects a retry that reuses the key with a different payload', async () => {
    const first = await service.reserve(tenantId, artifactCode, key, 'hash-a');
    if (first.kind !== 'reserved') throw new Error('expected reservation');
    await service.complete(first.id, first.lease, { httpStatus: 200, body: {} });

    await expect(service.reserve(tenantId, artifactCode, key, 'hash-b')).rejects.toMatchObject({
      code: 'IDEMPOTENCY_PAYLOAD_MISMATCH',
    });
  });
});
