import { Injectable, Logger } from '@nestjs/common';
import { Prisma, DecisionAuditEvent } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { HashService } from '../crypto/hash.service';

export interface AppendAuditEventInput {
  tenantId: bigint;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  actorId: string;
  requestId?: string;
  payload: Prisma.InputJsonValue;
}

/**
 * Every business action across modules (artifacts, variables, testing, governance,
 * deployments, runtime, manual review, traceability) records its audit trail through
 * this single `append` call, which makes it the one place that needs a log statement
 * to cover "every action in every layer" instead of instrumenting each service.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly hashes: HashService,
  ) {}

  async append(input: AppendAuditEventInput): Promise<DecisionAuditEvent> {
    const event = await this.prisma.$transaction(async (tx) => {
      // Serialize the per-tenant hash chain so concurrent writers cannot create forks.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${input.tenantId})`;
      const previous = await tx.decisionAuditEvent.findFirst({
        where: { tenantId: input.tenantId },
        orderBy: { id: 'desc' },
        select: { eventHash: true },
      });
      const payload = {
        tenantId: input.tenantId.toString(),
        eventType: input.eventType,
        aggregateType: input.aggregateType,
        aggregateId: input.aggregateId,
        actorId: input.actorId,
        requestId: input.requestId ?? null,
        payload: input.payload,
        previousHash: previous?.eventHash ?? null,
      };
      const eventHash = this.hashes.hmac(payload);
      return tx.decisionAuditEvent.create({
        data: {
          tenantId: input.tenantId,
          eventType: input.eventType,
          aggregateType: input.aggregateType,
          aggregateId: input.aggregateId,
          actorId: input.actorId,
          requestId: input.requestId,
          payloadJson: input.payload,
          previousHash: previous?.eventHash,
          eventHash,
        },
      });
    });
    this.logger.log({
      eventType: event.eventType,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      tenantId: input.tenantId.toString(),
      actorId: event.actorId,
      requestId: event.requestId,
    }, 'AuditService');
    return event;
  }
}
