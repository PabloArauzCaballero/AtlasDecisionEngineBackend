import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IdempotencyStatus, Prisma } from '@prisma/client';
import { DomainException } from '../../common/errors/domain-exception';
import { HashService } from '../../common/crypto/hash.service';
import { PrismaService } from '../../common/prisma/prisma.service';

/** How many times a lost reclaim race may restart the resolution before giving up. */
const MAX_RECLAIM_ATTEMPTS = 2;

/** Result of claiming or replaying an idempotency key. */
export type IdempotencyReservation =
  | { kind: 'reserved'; id: bigint }
  | { kind: 'completed'; response: unknown; status: IdempotencyStatus };

/**
 * Coordinates request idempotency for decision execution.
 *
 * The key is scoped by tenant and artifact, while the request hash protects against
 * replaying the key with different inputs.
 */
@Injectable()
export class IdempotencyService {
  private readonly ttlMs: number;
  private readonly leaseMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly hashes: HashService,
    config: ConfigService,
  ) {
    this.ttlMs = (config.get<number>('IDEMPOTENCY_TTL_HOURS') ?? 24) * 60 * 60 * 1_000;
    // Short lease a PROCESSING reservation holds the key for. 60s comfortably exceeds a
    // normal decision (bounded by REQUEST_TIMEOUT_MS, 15s by default) while freeing the key
    // quickly after a crash. Falls back to the default until the key is added to the schema.
    this.leaseMs = (config.get<number>('IDEMPOTENCY_LEASE_SECONDS') ?? 60) * 1_000;
  }

  /**
   * Claims a key for processing or returns the persisted terminal response.
   *
   * @throws DomainException when the key is still processing or was reused with a
   * different request hash.
   */
  async reserve(
    tenantId: bigint,
    artifactCode: string,
    key: string,
    requestHash: string,
    /**
     * Reclaim attempts already spent. Losing the race to reclaim an expired reservation
     * restarts the resolution from a re-read, and each restart must be bounded: without a
     * ceiling, a key under heavy contention could recurse until the stack gave out, and a
     * stack overflow in the decision path is a far worse outcome than a 409 the caller can
     * retry. Two retries is already generous — every restart means another request won.
     */
    attempt = 0,
  ): Promise<IdempotencyReservation> {
    const now = new Date();
    try {
      const record = await this.prisma.runtimeIdempotency.create({
        data: {
          tenantId,
          artifactCode,
          idempotencyKey: key,
          requestHash,
          leaseExpiresAt: new Date(now.getTime() + this.leaseMs),
          expiresAt: new Date(now.getTime() + this.ttlMs),
        },
      });
      return { kind: 'reserved', id: record.id };
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
        throw error;
      }
      const existing = await this.prisma.runtimeIdempotency.findUniqueOrThrow({
        where: {
          tenantId_artifactCode_idempotencyKey: {
            tenantId,
            artifactCode,
            idempotencyKey: key,
          },
        },
      });

      // A reservation is reclaimable when its terminal response TTL lapsed, OR when it is
      // still PROCESSING but its short lease expired — the previous holder crashed and must
      // not keep the key locked for the whole TTL.
      const responseExpired = existing.expiresAt <= now;
      const leaseExpired =
        existing.status === IdempotencyStatus.PROCESSING && existing.leaseExpiresAt <= now;
      if (responseExpired || leaseExpired) {
        // The guard in the WHERE clause makes the reclaim atomic: exactly one concurrent
        // request can flip an expired reservation back to a fresh PROCESSING lease.
        const renewed = await this.prisma.runtimeIdempotency.updateMany({
          where: {
            id: existing.id,
            OR: [
              { expiresAt: { lte: now } },
              { status: IdempotencyStatus.PROCESSING, leaseExpiresAt: { lte: now } },
            ],
          },
          data: {
            requestHash,
            status: IdempotencyStatus.PROCESSING,
            responseJson: Prisma.DbNull,
            responseHash: null,
            leaseExpiresAt: new Date(now.getTime() + this.leaseMs),
            expiresAt: new Date(now.getTime() + this.ttlMs),
          },
        });
        if (renewed.count === 1) return { kind: 'reserved', id: existing.id };
        // Another request won the reclaim; re-read and follow the normal path.
        if (attempt >= MAX_RECLAIM_ATTEMPTS) {
          throw new DomainException(
            'IDEMPOTENCY_CONTENDED',
            'The idempotency key is under contention; retry the request',
            HttpStatus.CONFLICT,
          );
        }
        return this.reserve(tenantId, artifactCode, key, requestHash, attempt + 1);
      }

      // The reservation is live (terminal within TTL, or PROCESSING with a valid lease).
      if (existing.requestHash !== requestHash) {
        throw new DomainException(
          'IDEMPOTENCY_PAYLOAD_MISMATCH',
          'The idempotency key was already used with a different request payload',
          HttpStatus.CONFLICT,
        );
      }
      if (existing.status === IdempotencyStatus.PROCESSING) {
        throw new DomainException(
          'IDEMPOTENCY_IN_PROGRESS',
          'An identical request is still being processed',
          HttpStatus.CONFLICT,
        );
      }
      return {
        kind: 'completed',
        response: existing.responseJson,
        status: existing.status,
      };
    }
  }

  /**
   * Stores a successful terminal response for deterministic replay.
   *
   * @param tx Optional execution transaction so evidence and idempotency commit together.
   */
  async complete(id: bigint, response: unknown, tx?: Prisma.TransactionClient): Promise<void> {
    await (tx ?? this.prisma).runtimeIdempotency.update({
      where: { id },
      data: {
        status: IdempotencyStatus.COMPLETED,
        responseJson: response as Prisma.InputJsonValue,
        responseHash: this.hashes.sha256(response),
      },
    });
  }

  /**
   * Stores a deterministic failed response for replay.
   *
   * @param tx Optional execution transaction so evidence and idempotency commit together.
   */
  async fail(id: bigint, response: unknown, tx?: Prisma.TransactionClient): Promise<void> {
    await (tx ?? this.prisma).runtimeIdempotency.update({
      where: { id },
      data: {
        status: IdempotencyStatus.FAILED,
        responseJson: response as Prisma.InputJsonValue,
        responseHash: this.hashes.sha256(response),
      },
    });
  }

  /**
   * Releases a reservation after a transient failure so an identical retry can re-claim
   * the key. Deleting is safe because the caller owns this row for the current request;
   * a concurrent request would have been rejected with IDEMPOTENCY_IN_PROGRESS.
   */
  async release(id: bigint): Promise<void> {
    await this.prisma.runtimeIdempotency.deleteMany({ where: { id } });
  }
}
