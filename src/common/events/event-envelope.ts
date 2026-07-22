import type { Prisma } from '@prisma/client';

/**
 * What a producer hands to {@link OutboxPublisherService.publish} from inside its own
 * business transaction. Correlation/causation/actor/tenant travel on the envelope, not
 * the payload, so every consumer can rely on them without parsing event-specific bodies.
 */
export interface EventEnvelope {
  eventType: string;
  /** Contract version of the payload shape. Defaults to '1'. */
  schemaVersion?: string;
  tenantId: bigint;
  aggregateType: string;
  aggregateId: string;
  actorId: string;
  /** Usually the originating requestId, so an event chain can be traced end to end. */
  correlationId?: string;
  /** Id of the event (or command) that directly caused this one, when there is one. */
  causationId?: string;
  payload: Prisma.InputJsonValue;
}

/** An outbox row as the relay hands it to bus subscribers. */
export interface DispatchedEvent {
  /** Outbox row id — the idempotency key consumers record in decision_processed_event. */
  outboxEventId: bigint;
  eventType: string;
  schemaVersion: string;
  tenantId: bigint;
  aggregateType: string;
  aggregateId: string;
  actorId: string;
  correlationId: string | null;
  causationId: string | null;
  occurredAt: Date;
  payload: unknown;
}
