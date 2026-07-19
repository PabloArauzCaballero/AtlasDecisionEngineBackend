import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { HashService } from '../src/common/crypto/hash.service';
import { IdempotencyService } from '../src/modules/runtime/idempotency.service';
import type { PrismaService } from '../src/common/prisma/prisma.service';

/**
 * Plan §3.2: a crash while PROCESSING must free the idempotency key when the short lease
 * lapses, not lock it for the full 24h response TTL. expiresAt (TTL) and leaseExpiresAt
 * (lease) are separate, so a stuck reservation is reclaimable in seconds.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

describeDb('IdempotencyService PROCESSING lease (integration)', () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL }) });
  const hashes = new HashService(new ConfigService({ AUDIT_HASH_SECRET: 'test-secret' }));
  // 1s lease so the crash-recovery window is testable; the 24h TTL default stays huge.
  const service = new IdempotencyService(
    prisma as unknown as PrismaService,
    hashes,
    new ConfigService({ IDEMPOTENCY_TTL_HOURS: 24, IDEMPOTENCY_LEASE_SECONDS: 1 }),
  );
  const tenantId = 660066n;
  const artifactCode = 'LEASE_TEST';

  afterEach(async () => {
    await prisma.runtimeIdempotency.deleteMany({ where: { tenantId } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('blocks a concurrent identical request while the lease is still valid', async () => {
    const first = await service.reserve(tenantId, artifactCode, 'k-live', 'hash-a');
    expect(first.kind).toBe('reserved');

    // Lease has not lapsed: a second request must be told it is in progress, not reclaim it.
    await expect(service.reserve(tenantId, artifactCode, 'k-live', 'hash-a')).rejects.toMatchObject({
      code: 'IDEMPOTENCY_IN_PROGRESS',
    });
  });

  it('lets another request reclaim the key after the lease lapses (crash recovery)', async () => {
    const first = await service.reserve(tenantId, artifactCode, 'k-crash', 'hash-a');
    expect(first.kind).toBe('reserved');
    // Simulate the holder crashing: the reservation is left PROCESSING and never completed.

    // Wait past the 1s lease.
    await new Promise((resolve) => setTimeout(resolve, 1_200));

    const retry = await service.reserve(tenantId, artifactCode, 'k-crash', 'hash-a');
    expect(retry.kind).toBe('reserved');
    if (retry.kind === 'reserved' && first.kind === 'reserved') {
      // Same row reclaimed, not a duplicate.
      expect(retry.id).toBe(first.id);
    }
  });

  it('does not free the key via the 24h TTL — only the short lease does', async () => {
    const first = await service.reserve(tenantId, artifactCode, 'k-ttl', 'hash-a');
    if (first.kind !== 'reserved') throw new Error('expected reservation');

    const row = await prisma.runtimeIdempotency.findUniqueOrThrow({ where: { id: first.id } });
    // The response TTL is far in the future; only the lease is short.
    const ttlAheadMs = row.expiresAt.getTime() - Date.now();
    const leaseAheadMs = row.leaseExpiresAt.getTime() - Date.now();
    expect(ttlAheadMs).toBeGreaterThan(60 * 60 * 1_000); // well over an hour
    expect(leaseAheadMs).toBeLessThan(5_000); // seconds
  });

  it('only one of many concurrent reclaimers wins after a lease lapse', async () => {
    const first = await service.reserve(tenantId, artifactCode, 'k-race', 'hash-a');
    expect(first.kind).toBe('reserved');
    await new Promise((resolve) => setTimeout(resolve, 1_200));

    // A burst of identical retries: exactly one reclaims (reserved), the rest see it in progress.
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () => service.reserve(tenantId, artifactCode, 'k-race', 'hash-a')),
    );
    const reserved = results.filter((r) => r.status === 'fulfilled' && r.value.kind === 'reserved');
    expect(reserved).toHaveLength(1);
  });
});
