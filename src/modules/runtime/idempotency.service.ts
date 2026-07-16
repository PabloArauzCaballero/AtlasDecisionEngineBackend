import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IdempotencyStatus, Prisma } from '@prisma/client';
import { DomainException } from '../../common/errors/domain-exception';
import { HashService } from '../../common/crypto/hash.service';
import { PrismaService } from '../../common/prisma/prisma.service';

export type IdempotencyReservation =
  | { kind: 'reserved'; id: bigint }
  | { kind: 'completed'; response: unknown; status: IdempotencyStatus };

@Injectable()
export class IdempotencyService {
  private readonly ttlMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly hashes: HashService,
    config: ConfigService,
  ) {
    this.ttlMs = (config.get<number>('IDEMPOTENCY_TTL_HOURS') ?? 24) * 60 * 60 * 1_000;
  }

  async reserve(
    tenantId: bigint,
    artifactCode: string,
    key: string,
    requestHash: string,
  ): Promise<IdempotencyReservation> {
    try {
      const record = await this.prisma.runtimeIdempotency.create({
        data: {
          tenantId,
          artifactCode,
          idempotencyKey: key,
          requestHash,
          expiresAt: new Date(Date.now() + this.ttlMs),
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
      const now = new Date();
      if (existing.expiresAt <= now) {
        const renewed = await this.prisma.runtimeIdempotency.updateMany({
          where: { id: existing.id, expiresAt: { lte: now } },
          data: {
            requestHash,
            status: IdempotencyStatus.PROCESSING,
            responseJson: Prisma.DbNull,
            responseHash: null,
            expiresAt: new Date(now.getTime() + this.ttlMs),
          },
        });
        if (renewed.count === 1) return { kind: 'reserved', id: existing.id };
        return this.reserve(tenantId, artifactCode, key, requestHash);
      }
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

  async complete(id: bigint, response: unknown): Promise<void> {
    await this.prisma.runtimeIdempotency.update({
      where: { id },
      data: {
        status: IdempotencyStatus.COMPLETED,
        responseJson: response as Prisma.InputJsonValue,
        responseHash: this.hashes.sha256(response),
      },
    });
  }

  async fail(id: bigint, response: unknown): Promise<void> {
    await this.prisma.runtimeIdempotency.update({
      where: { id },
      data: {
        status: IdempotencyStatus.FAILED,
        responseJson: response as Prisma.InputJsonValue,
        responseHash: this.hashes.sha256(response),
      },
    });
  }

}
