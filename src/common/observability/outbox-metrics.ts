import { Injectable } from '@nestjs/common';
import { Counter, Gauge } from 'prom-client';
import { MetricsRegistry } from './metrics-registry';

/**
 * Métricas del outbox transaccional y de las notificaciones que se proyectan desde él.
 */
@Injectable()
export class OutboxMetrics {
  // Depth of the transactional outbox backlog. Sampled by the relay on every poll; a
  // sustained climb means dispatch is failing or cannot keep up with producers.
  private readonly outboxPending = new Gauge({
    name: 'atlas_outbox_pending',
    help: 'Outbox events currently PENDING dispatch.',
    registers: [],
  });

  private readonly outboxDispatched = new Counter({
    name: 'atlas_outbox_dispatched_total',
    help: 'Outbox events successfully dispatched to the event bus.',
    labelNames: ['event_type'],
    registers: [],
  });

  private readonly outboxDead = new Counter({
    name: 'atlas_outbox_dead_total',
    help: 'Outbox events moved to the DEAD letter state after exhausting retries.',
    labelNames: ['event_type'],
    registers: [],
  });

  private readonly notificationsCreated = new Counter({
    name: 'atlas_notification_created_total',
    help: 'Notifications projected into the inbox, by originating event type.',
    labelNames: ['event_type'],
    registers: [],
  });

  constructor(shared: MetricsRegistry = new MetricsRegistry()) {
    shared.registry.registerMetric(this.outboxPending);
    shared.registry.registerMetric(this.outboxDispatched);
    shared.registry.registerMetric(this.outboxDead);
    shared.registry.registerMetric(this.notificationsCreated);
  }

  /** Records the current PENDING depth of the transactional outbox. */
  setOutboxPending(count: number): void {
    this.outboxPending.set(count);
  }

  /** Counts an outbox event delivered to the bus. Event types are catalogue constants, safe as labels. */
  recordOutboxDispatched(eventType: string): void {
    this.outboxDispatched.inc({ event_type: eventType || 'UNKNOWN' });
  }

  /** Counts an outbox event dead-lettered after exhausting its retry budget. */
  recordOutboxDead(eventType: string): void {
    this.outboxDead.inc({ event_type: eventType || 'UNKNOWN' });
  }

  /** Counts a notification projected into the inbox from a domain event. */
  recordNotificationCreated(eventType: string): void {
    this.notificationsCreated.inc({ event_type: eventType || 'UNKNOWN' });
  }
}
