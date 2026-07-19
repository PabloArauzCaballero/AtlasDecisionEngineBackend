import { Injectable, Logger } from '@nestjs/common';
import { Prisma, DecisionAuditEvent } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { HashService } from '../crypto/hash.service';
import { canonicalize } from '../crypto/canonical-json';

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
 *
 * Callers that own a business transaction must pass it: an audit event that commits
 * independently of the action it records can outlive a rolled-back change (evidence of
 * something that never happened) or be lost while the change commits (a change with no
 * evidence). Joining the caller's transaction makes the action and its evidence atomic.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly hashes: HashService,
  ) {}

  /**
   * @param tx The caller's business transaction. Omit only when the event genuinely has
   *           no accompanying write, in which case a dedicated transaction is opened.
   */
  async append(
    input: AppendAuditEventInput,
    tx?: Prisma.TransactionClient,
  ): Promise<DecisionAuditEvent> {
    const event = tx
      ? await this.appendWithin(tx, input)
      : await this.prisma.$transaction((client) => this.appendWithin(client, input));
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

  private async appendWithin(
    tx: Prisma.TransactionClient,
    input: AppendAuditEventInput,
  ): Promise<DecisionAuditEvent> {
    // Serialize the per-tenant hash chain so concurrent writers cannot create forks.
    // The lock is held until the surrounding transaction ends, which is now the caller's.
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
    const hashKeyId = this.hashes.activeHashKeyId();
    // Freeze the exact canonical string here and hash that, then persist it. Verification
    // hashes this stored string rather than re-serializing payloadJson, so JSONB number
    // normalization on round-trip can never turn a valid event into a false mismatch (D-9).
    const canonicalPayload = canonicalize(payload);
    const eventHash = this.hashes.hmacWithKey(canonicalPayload, hashKeyId);
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
        // Recorded so a later rotation of AUDIT_HASH_SECRET can still verify this event.
        hashKeyId,
        canonicalPayload,
      },
    });
  }
}
