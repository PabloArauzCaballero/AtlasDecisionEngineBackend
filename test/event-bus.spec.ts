import { EventBus } from '../src/common/events/event-bus';
import type { DispatchedEvent } from '../src/common/events/event-envelope';

function event(overrides: Partial<DispatchedEvent> = {}): DispatchedEvent {
  return {
    outboxEventId: 1n,
    eventType: 'version.approved',
    schemaVersion: '1',
    tenantId: 7n,
    aggregateType: 'ApprovalRequest',
    aggregateId: '10',
    actorId: 'qa@atlas.test',
    correlationId: 'req-1',
    causationId: null,
    occurredAt: new Date('2026-07-21T00:00:00.000Z'),
    payload: {},
    ...overrides,
  };
}

describe('EventBus', () => {
  it('delivers an event to type-specific and wildcard subscribers', async () => {
    const bus = new EventBus();
    const typed = jest.fn();
    const wildcard = jest.fn();
    bus.subscribe('version.approved', typed);
    bus.subscribeAll(wildcard);

    await bus.emit(event());

    expect(typed).toHaveBeenCalledTimes(1);
    expect(wildcard).toHaveBeenCalledTimes(1);
  });

  it('does not deliver an event to handlers for a different type', async () => {
    const bus = new EventBus();
    const other = jest.fn();
    bus.subscribe('version.rejected', other);

    await bus.emit(event({ eventType: 'version.approved' }));

    expect(other).not.toHaveBeenCalled();
  });

  it('propagates a handler failure so the relay treats the emit as not delivered', async () => {
    const bus = new EventBus();
    bus.subscribeAll(() => {
      throw new Error('projector down');
    });

    await expect(bus.emit(event())).rejects.toThrow('projector down');
  });

  it('stops delivering to a handler once it unsubscribes', async () => {
    const bus = new EventBus();
    const handler = jest.fn();
    const unsubscribe = bus.subscribe('version.approved', handler);

    await bus.emit(event());
    unsubscribe();
    await bus.emit(event());

    expect(handler).toHaveBeenCalledTimes(1);
    expect(bus.hasSubscribers('version.approved')).toBe(false);
  });
});
