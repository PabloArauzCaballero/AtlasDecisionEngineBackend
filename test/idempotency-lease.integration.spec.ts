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
  // Only the TTL assertion needs a genuinely short lease (it checks the lease is seconds while
  // the TTL is hours). Every other case forces the lapse with expireLease() instead of sleeping
  // past a short lease: `reserve()` reclaims on `leaseExpiresAt <= now`, so moving that column
  // into the past reproduces a crashed holder exactly, with no dependency on wall-clock timing.
  // Sleeping was load-sensitive and failed intermittently — a slow round trip could outlast the
  // lease and turn an intended "still held" into a legitimate reclaim, or let a straggler in the
  // concurrent burst reclaim a second time.
  const LEASE_SECONDS = 3;
  const idempotency = (leaseSeconds: number) =>
    new IdempotencyService(
      prisma as unknown as PrismaService,
      hashes,
      new ConfigService({ IDEMPOTENCY_TTL_HOURS: 24, IDEMPOTENCY_LEASE_SECONDS: leaseSeconds }),
    );
  const service = idempotency(LEASE_SECONDS);
  // The "a valid lease blocks a concurrent request" case does not depend on the lease being
  // short — only on it still being held. A lease that cannot lapse removes the race entirely:
  // with the short lease that assertion still failed on a cold connection, where the first
  // reserve() pays Postgres connection setup and can itself outlast the lease.
  const heldLeaseService = idempotency(600);
  // Unique per process: afterEach cleans up by tenant, so a fixed id let two concurrent runs
  // against the same database (a second suite, CI, or a developer's local run) delete each
  // other's rows mid-test. The wide base keeps it clear of the other integration suites.
  const tenantId = 660_000_000_000n + BigInt(process.pid);
  const artifactCode = 'LEASE_TEST';

  /** Simulates a crashed holder: drives the lease into the past without waiting for it. */
  const expireLease = (idempotencyKey: string) =>
    prisma.runtimeIdempotency.updateMany({
      where: { tenantId, artifactCode, idempotencyKey },
      data: { leaseExpiresAt: new Date(Date.now() - 1_000) },
    });

  beforeAll(async () => {
    // Pay connection setup here, so it is not charged to the first timing-sensitive reserve().
    await prisma.$queryRaw`SELECT 1`;
  });

  afterEach(async () => {
    await prisma.runtimeIdempotency.deleteMany({ where: { tenantId } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('blocks a concurrent identical request while the lease is still valid', async () => {
    const first = await heldLeaseService.reserve(tenantId, artifactCode, 'k-live', 'hash-a');
    expect(first.kind).toBe('reserved');

    // Lease has not lapsed: a second request must be told it is in progress, not reclaim it.
    await expect(
      heldLeaseService.reserve(tenantId, artifactCode, 'k-live', 'hash-a'),
    ).rejects.toMatchObject({
      code: 'IDEMPOTENCY_IN_PROGRESS',
    });
  });

  it('lets another request reclaim the key after the lease lapses (crash recovery)', async () => {
    const first = await heldLeaseService.reserve(tenantId, artifactCode, 'k-crash', 'hash-a');
    expect(first.kind).toBe('reserved');
    // Simulate the holder crashing: the reservation is left PROCESSING and its lease lapses.
    await expireLease('k-crash');

    const retry = await heldLeaseService.reserve(tenantId, artifactCode, 'k-crash', 'hash-a');
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
    const first = await heldLeaseService.reserve(tenantId, artifactCode, 'k-race', 'hash-a');
    expect(first.kind).toBe('reserved');
    await expireLease('k-race');

    // A burst of identical retries: exactly one reclaims (reserved), the rest see it in progress.
    // The winner's fresh lease cannot lapse mid-burst, so a straggler can never reclaim twice.
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        heldLeaseService.reserve(tenantId, artifactCode, 'k-race', 'hash-a'),
      ),
    );
    const reserved = results.filter((r) => r.status === 'fulfilled' && r.value.kind === 'reserved');
    expect(reserved).toHaveLength(1);
  });

  /*
   * El caso que faltaba: no el que reclama, sino el titular ORIGINAL que vuelve tarde.
   *
   * Si su ejecución se pasó del lease, la fila ya pertenece a otra petición. Cerrarla o
   * borrarla por `id` a secas —como se hacía— pisaba a un titular vivo: su respuesta se
   * sobrescribía con la del caducado, o su reserva desaparecía y después fallaba al cerrarla.
   * El comprobante de lease que devuelve `reserve()` es lo que lo impide.
   */
  it('el titular caducado no puede cerrar la reserva que otro reclamó', async () => {
    const stale = await heldLeaseService.reserve(tenantId, artifactCode, 'k-stale', 'hash-a');
    if (stale.kind !== 'reserved') throw new Error('expected reservation');
    await expireLease('k-stale');
    const winner = await heldLeaseService.reserve(tenantId, artifactCode, 'k-stale', 'hash-a');
    if (winner.kind !== 'reserved') throw new Error('expected reclaim');
    expect(winner.id).toBe(stale.id);

    // El titular caducado termina y trata de cachear SU resultado. No debe pisar al nuevo.
    await heldLeaseService.complete(stale.id, stale.lease, {
      httpStatus: 200,
      body: { of: 'stale' },
    });

    const row = await prisma.runtimeIdempotency.findUniqueOrThrow({ where: { id: stale.id } });
    expect(row.status).toBe('PROCESSING');
    expect(row.responseJson).toBeNull();
    expect(row.leaseExpiresAt.getTime()).toBe(winner.lease.getTime());
  });

  it('el titular caducado tampoco puede borrar la reserva que otro reclamó', async () => {
    const stale = await heldLeaseService.reserve(tenantId, artifactCode, 'k-stale-rel', 'hash-a');
    if (stale.kind !== 'reserved') throw new Error('expected reservation');
    await expireLease('k-stale-rel');
    const winner = await heldLeaseService.reserve(tenantId, artifactCode, 'k-stale-rel', 'hash-a');
    if (winner.kind !== 'reserved') throw new Error('expected reclaim');

    // Fallo transitorio en el titular caducado: antes esto borraba la fila del nuevo titular.
    await heldLeaseService.release(stale.id, stale.lease);

    const row = await prisma.runtimeIdempotency.findUnique({ where: { id: stale.id } });
    expect(row).not.toBeNull();
    expect(row?.leaseExpiresAt.getTime()).toBe(winner.lease.getTime());
  });

  it('el titular vigente sí cierra y sí libera su propia reserva', async () => {
    const held = await heldLeaseService.reserve(tenantId, artifactCode, 'k-owner', 'hash-a');
    if (held.kind !== 'reserved') throw new Error('expected reservation');
    await heldLeaseService.complete(held.id, held.lease, { httpStatus: 200, body: { ok: true } });
    const completed = await prisma.runtimeIdempotency.findUniqueOrThrow({ where: { id: held.id } });
    expect(completed.status).toBe('COMPLETED');

    const other = await heldLeaseService.reserve(tenantId, artifactCode, 'k-owner-rel', 'hash-a');
    if (other.kind !== 'reserved') throw new Error('expected reservation');
    await heldLeaseService.release(other.id, other.lease);
    expect(await prisma.runtimeIdempotency.findUnique({ where: { id: other.id } })).toBeNull();
  });
});
