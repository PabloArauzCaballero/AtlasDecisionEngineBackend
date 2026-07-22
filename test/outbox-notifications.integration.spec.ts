import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { EventBus } from '../src/common/events/event-bus';
import { DispatchedEvent } from '../src/common/events/event-envelope';
import { DecisionEventType } from '../src/common/events/event-types';
import { OutboxPublisherService } from '../src/common/events/outbox-publisher.service';
import { NotificationProjectorService } from '../src/modules/notifications/notification-projector.service';
import { NotificationService } from '../src/modules/notifications/notification.service';
import { OutboxRelayService } from '../src/modules/outbox-relay/outbox-relay.service';
import type { MetricsService } from '../src/common/observability/metrics.service';
import type { PrismaService } from '../src/common/prisma/prisma.service';
import { uniqueTenantId } from './support/unique-tenant';

/**
 * End-to-end of the event backbone against a real database: a business transaction writes
 * an outbox row, the relay claims and dispatches it, and the projector turns it into inbox
 * notifications — exactly once even when the same event is dispatched twice.
 *
 * Needs Postgres: the claim uses FOR UPDATE SKIP LOCKED and the idempotency guard relies on
 * the unique (consumer_name, outbox_event_id) constraint.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

describeDb('Outbox relay + notification projector (integration)', () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL }) });
  const metrics = {
    setOutboxPending: jest.fn(),
    recordOutboxDispatched: jest.fn(),
    recordOutboxDead: jest.fn(),
    recordNotificationCreated: jest.fn(),
  } as unknown as MetricsService;
  const config = new ConfigService({
    MAX_PAGE_SIZE: 100,
    OUTBOX_MAX_ATTEMPTS: 8,
    OUTBOX_BATCH_SIZE: 25,
  });
  const publisher = new OutboxPublisherService();
  const notifications = new NotificationService(
    prisma as unknown as PrismaService,
    config,
    metrics,
  );
  const tenantId = uniqueTenantId(71);

  const submitPayload = {
    versionId: '5',
    approvalRequestId: '10',
    artifactCode: 'CREDIT-RISK',
    versionNumber: 3,
    workflowCode: 'STANDARD',
    authorId: 'author@atlas.test',
    reviewerRoles: ['QA_ANALYST', 'RISK_APPROVER'],
  };

  afterEach(async () => {
    await prisma.notification.deleteMany({ where: { tenantId } });
    await prisma.decisionOutboxEvent.deleteMany({ where: { tenantId } });
    // ProcessedEvent rows key on the outbox id, which is unique per run, so they never collide.
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('publishes inside the caller transaction and delivers to the projector once', async () => {
    const bus = new EventBus();
    const projector = new NotificationProjectorService(
      prisma as unknown as PrismaService,
      bus,
      notifications,
    );
    projector.onModuleInit();
    const relay = new OutboxRelayService(prisma as unknown as PrismaService, bus, config, metrics);

    // A business transaction that also emits its event: both commit together.
    const outboxRow = await prisma.$transaction((tx) =>
      publisher.publish(tx, {
        eventType: DecisionEventType.VERSION_SUBMITTED_FOR_REVIEW,
        tenantId,
        aggregateType: 'DecisionArtifactVersion',
        aggregateId: '5',
        actorId: 'author@atlas.test',
        correlationId: 'req-int-1',
        payload: submitPayload,
      }),
    );
    expect(outboxRow.status).toBe('PENDING');

    // The relay is cross-tenant infrastructure with no tenant filter, so in a shared
    // database it may also drain PENDING rows left by other suites. Assert that at least
    // this event was delivered and that this specific row reached DISPATCHED, rather than
    // an exact global count that other tests could perturb.
    const delivered = await relay.dispatchBatch();
    expect(delivered).toBeGreaterThanOrEqual(1);

    const dispatched = await prisma.decisionOutboxEvent.findUniqueOrThrow({
      where: { id: outboxRow.id },
    });
    expect(dispatched.status).toBe('DISPATCHED');

    // One notification for each reviewer role, none for the author.
    const qa = await notifications.list(
      tenantId,
      { principalId: 'qa@atlas.test', roles: ['QA_ANALYST'] },
      { pageSize: 25 } as never,
    );
    expect(qa.items).toHaveLength(1);
    expect(qa.items[0].category).toBe('GOVERNANCE');

    // Re-dispatching the very same event (simulating at-least-once redelivery) adds nothing.
    await projector.handle({
      outboxEventId: outboxRow.id,
      eventType: DecisionEventType.VERSION_SUBMITTED_FOR_REVIEW,
      schemaVersion: '1',
      tenantId,
      aggregateType: 'DecisionArtifactVersion',
      aggregateId: '5',
      actorId: 'author@atlas.test',
      correlationId: 'req-int-1',
      causationId: null,
      occurredAt: new Date(),
      payload: submitPayload,
    } as DispatchedEvent);

    const total = await prisma.notification.count({ where: { tenantId } });
    expect(total).toBe(2);

    projector.onModuleDestroy();
  });

  it('marks all visible notifications read', async () => {
    const bus = new EventBus();
    const projector = new NotificationProjectorService(
      prisma as unknown as PrismaService,
      bus,
      notifications,
    );
    projector.onModuleInit();
    const relay = new OutboxRelayService(prisma as unknown as PrismaService, bus, config, metrics);

    await prisma.$transaction((tx) =>
      publisher.publish(tx, {
        eventType: DecisionEventType.VERSION_SUBMITTED_FOR_REVIEW,
        tenantId,
        aggregateType: 'DecisionArtifactVersion',
        aggregateId: '5',
        actorId: 'author@atlas.test',
        payload: submitPayload,
      }),
    );
    await relay.dispatchBatch();

    const recipient = { principalId: 'qa@atlas.test', roles: ['QA_ANALYST'] };
    expect((await notifications.unreadCount(tenantId, recipient)).unread).toBe(1);

    const { updated } = await notifications.markAllRead(tenantId, recipient);
    expect(updated).toBe(1);
    expect((await notifications.unreadCount(tenantId, recipient)).unread).toBe(0);

    projector.onModuleDestroy();
  });
});
