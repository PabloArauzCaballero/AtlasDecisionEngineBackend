import { Injectable } from '@nestjs/common';
import { DecisionOutboxEvent, Prisma } from '@prisma/client';
import { EventEnvelope } from './event-envelope';

/**
 * Writes a domain event into the transactional outbox.
 *
 * Deliberately mirrors AuditService.append's contract, with one difference: here the
 * caller's transaction is REQUIRED, not optional. An outbox row that commits while the
 * business change rolls back announces something that never happened; one that is lost
 * while the change commits breaks every downstream projection. Joining the caller's
 * transaction makes the change and its event atomic — the whole point of the pattern.
 * Delivery to consumers is the OutboxRelayService's job, outside this transaction.
 */
@Injectable()
export class OutboxPublisherService {
  async publish(
    tx: Prisma.TransactionClient,
    envelope: EventEnvelope,
  ): Promise<DecisionOutboxEvent> {
    return tx.decisionOutboxEvent.create({
      data: {
        tenantId: envelope.tenantId,
        eventType: envelope.eventType,
        schemaVersion: envelope.schemaVersion ?? '1',
        aggregateType: envelope.aggregateType,
        aggregateId: envelope.aggregateId,
        actorId: envelope.actorId,
        correlationId: envelope.correlationId,
        causationId: envelope.causationId,
        payloadJson: envelope.payload,
      },
    });
  }
}
