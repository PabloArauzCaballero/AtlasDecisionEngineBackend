import { ConfigService } from '@nestjs/config';
import { IdempotencyStatus, Prisma } from '@prisma/client';
import { DomainException } from '../src/common/errors/domain-exception';
import { HashService } from '../src/common/crypto/hash.service';
import type { PrismaService } from '../src/common/prisma/prisma.service';
import { IdempotencyService } from '../src/modules/runtime/idempotency.service';

/**
 * Reclaiming an expired reservation is a race: the guarded `updateMany` lets exactly one
 * concurrent request win, and the losers re-read and resolve again. That restart was an
 * unbounded self-call, so a key under sustained contention could recurse until the stack
 * gave out — a stack overflow on the decision path is a far worse outcome than a 409 the
 * caller can simply retry.
 */
describe('IdempotencyService: cota del reclamo bajo contención', () => {
  const config = new ConfigService({
    AUDIT_HASH_SECRET: 'test-secret-with-at-least-24-characters',
    IDEMPOTENCY_LEASE_SECONDS: 60,
    IDEMPOTENCY_TTL_HOURS: 24,
  });

  function makeService(options: { alwaysLoseRace: boolean }) {
    let creates = 0;
    let updates = 0;
    const expired = {
      id: 7n,
      requestHash: 'other-hash',
      status: IdempotencyStatus.PROCESSING,
      // Vencida en ambos sentidos, así que siempre entra por la rama de reclamo.
      expiresAt: new Date(Date.now() - 60_000),
      leaseExpiresAt: new Date(Date.now() - 60_000),
      responseJson: null,
    };

    const prisma = {
      runtimeIdempotency: {
        create: () => {
          creates += 1;
          return Promise.reject(
            new Prisma.PrismaClientKnownRequestError('duplicate key', {
              code: 'P2002',
              clientVersion: 'test',
            }),
          );
        },
        findUniqueOrThrow: () => Promise.resolve(expired),
        updateMany: () => {
          updates += 1;
          // count 0 = otra petición ganó el reclamo, así que esta reintenta desde cero.
          return Promise.resolve({ count: options.alwaysLoseRace ? 0 : 1 });
        },
      },
    } as unknown as PrismaService;

    return {
      service: new IdempotencyService(prisma, new HashService(config), config),
      counts: () => ({ creates, updates }),
    };
  }

  it('se rinde con un 409 reintentable en vez de recursar sin fin', async () => {
    const { service, counts } = makeService({ alwaysLoseRace: true });

    const error = await service
      .reserve(1n, 'ART-1', 'key-1', 'hash-1')
      .then(() => null)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(DomainException);
    expect((error as DomainException).code).toBe('IDEMPOTENCY_CONTENDED');
    expect((error as DomainException).status).toBe(409);
    // Bounded: the initial attempt plus MAX_RECLAIM_ATTEMPTS restarts, and no more.
    expect(counts().updates).toBe(3);
  });

  it('sigue reservando normalmente cuando gana el reclamo', async () => {
    const { service, counts } = makeService({ alwaysLoseRace: false });

    await expect(service.reserve(1n, 'ART-1', 'key-1', 'hash-1')).resolves.toEqual({
      kind: 'reserved',
      id: 7n,
    });
    expect(counts().updates).toBe(1);
  });
});
