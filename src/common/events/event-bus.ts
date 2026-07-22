import { Injectable } from '@nestjs/common';
import { DispatchedEvent } from './event-envelope';

export type DispatchedEventHandler = (event: DispatchedEvent) => Promise<void> | void;

/** Subscription key that receives every event regardless of type. */
const ALL_EVENTS = '*';

/**
 * In-process, typed event bus for the current monolith.
 *
 * Handlers run sequentially and a handler failure PROPAGATES to the caller: the relay
 * treats a failed emit as "not delivered", keeps the outbox row PENDING and retries with
 * backoff, which is what makes at-least-once delivery real. Handlers must therefore be
 * idempotent (see decision_processed_event). Scaling path: replace this emitter with a
 * Redis Streams transport (ioredis is already in the stack) behind the same subscribe /
 * emit contract — producers and consumers would not change.
 */
@Injectable()
export class EventBus {
  private readonly handlers = new Map<string, Set<DispatchedEventHandler>>();

  /** Registers a handler for one event type (or every type via subscribeAll). Returns an unsubscribe. */
  subscribe(eventType: string, handler: DispatchedEventHandler): () => void {
    const existing = this.handlers.get(eventType) ?? new Set<DispatchedEventHandler>();
    existing.add(handler);
    this.handlers.set(eventType, existing);
    return () => {
      existing.delete(handler);
      if (existing.size === 0) this.handlers.delete(eventType);
    };
  }

  subscribeAll(handler: DispatchedEventHandler): () => void {
    return this.subscribe(ALL_EVENTS, handler);
  }

  /** Delivers the event to every matching handler, sequentially; the first failure aborts and rethrows. */
  async emit(event: DispatchedEvent): Promise<void> {
    const targets = [
      ...(this.handlers.get(event.eventType) ?? []),
      ...(this.handlers.get(ALL_EVENTS) ?? []),
    ];
    for (const handler of targets) {
      await handler(event);
    }
  }

  hasSubscribers(eventType: string): boolean {
    return (
      (this.handlers.get(eventType)?.size ?? 0) > 0 ||
      (this.handlers.get(ALL_EVENTS)?.size ?? 0) > 0
    );
  }
}
