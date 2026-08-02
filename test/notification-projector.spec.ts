import type { EventBus } from '../src/common/events/event-bus';
import type { DispatchedEvent } from '../src/common/events/event-envelope';
import { DecisionEventType } from '../src/common/events/event-types';
import type { PrismaService } from '../src/common/prisma/prisma.service';
import { NotificationProjectorService } from '../src/modules/notifications/notification-projector.service';
import { NotificationService } from '../src/modules/notifications/notification.service';

function event(overrides: Partial<DispatchedEvent> = {}): DispatchedEvent {
  return {
    outboxEventId: 42n,
    eventType: DecisionEventType.VERSION_SUBMITTED_FOR_REVIEW,
    schemaVersion: '1',
    tenantId: 7n,
    aggregateType: 'DecisionArtifactVersion',
    aggregateId: '5',
    actorId: 'author@atlas.test',
    correlationId: 'req-1',
    causationId: null,
    occurredAt: new Date('2026-07-21T00:00:00.000Z'),
    payload: {
      versionId: '5',
      approvalRequestId: '10',
      artifactCode: 'CREDIT-RISK',
      versionNumber: 3,
      workflowCode: 'STANDARD',
      authorId: 'author@atlas.test',
      reviewerRoles: ['QA_ANALYST', 'RISK_APPROVER'],
    },
    ...overrides,
  };
}

/** A prisma double whose $transaction runs the callback against the provided tx spies. */
function prismaWith(processedCount: number, createManyMock: jest.Mock) {
  const tx = {
    processedEvent: { createMany: jest.fn().mockResolvedValue({ count: processedCount }) },
    notification: { createMany: createManyMock },
  };
  const prisma = {
    $transaction: jest.fn(async (cb: (client: typeof tx) => Promise<number>) => cb(tx)),
  };
  return { prisma, tx };
}

function projector(prisma: unknown): NotificationProjectorService {
  const metrics = { recordNotificationCreated: jest.fn() };
  const notifications = new NotificationService(
    prisma as PrismaService,
    { get: () => 100 } as never,
    metrics as never,
  );
  const projector = new NotificationProjectorService(
    prisma as PrismaService,
    {} as EventBus,
    notifications,
    { get: () => undefined } as never,
  );
  // Estos tests llaman a `handle()` directamente, sin pasar por la suscripción del bus, así
  // que no necesitan un onModuleInit real; se mantiene fuera para no acoplar el ciclo de
  // vida de Nest a una prueba unitaria.
  return projector;
}

describe('NotificationProjectorService', () => {
  it('projects one notification per reviewer role on submit-for-review', async () => {
    const createMany = jest.fn().mockResolvedValue({ count: 2 });
    const { prisma, tx } = prismaWith(1, createMany);

    await projector(prisma).handle(event());

    expect(tx.processedEvent.createMany).toHaveBeenCalledWith({
      data: [{ consumerName: 'notification-projector', outboxEventId: 42n }],
      skipDuplicates: true,
    });
    const rows = createMany.mock.calls[0][0].data;
    expect(rows).toHaveLength(2);
    expect(rows.map((r: { recipientRole: string }) => r.recipientRole)).toEqual([
      'QA_ANALYST',
      'RISK_APPROVER',
    ]);
    expect(rows.every((r: { recipientId?: string }) => r.recipientId === undefined)).toBe(true);
  });

  it('is idempotent: a redelivered event inserts no notifications', async () => {
    const createMany = jest.fn();
    // processedEvent.createMany reports 0 rows => already processed.
    const { prisma, tx } = prismaWith(0, createMany);

    await projector(prisma).handle(event());

    expect(tx.processedEvent.createMany).toHaveBeenCalledTimes(1);
    expect(createMany).not.toHaveBeenCalled();
  });

  it('routes a review outcome to the author by principal id', async () => {
    const createMany = jest.fn().mockResolvedValue({ count: 1 });
    const { prisma } = prismaWith(1, createMany);

    await projector(prisma).handle(
      event({
        eventType: DecisionEventType.VERSION_CHANGES_REQUESTED,
        payload: {
          versionId: '5',
          approvalRequestId: '10',
          artifactCode: 'CREDIT-RISK',
          versionNumber: 3,
          authorId: 'author@atlas.test',
          decidedBy: 'qa@atlas.test',
          comments: 'Tighten threshold',
        },
      }),
    );

    const rows = createMany.mock.calls[0][0].data;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      recipientId: 'author@atlas.test',
      recipientRole: undefined,
      category: 'GOVERNANCE',
    });
    expect(rows[0].body).toContain('Tighten threshold');
  });

  it('publishes nothing for an unmapped event type without throwing', async () => {
    const createMany = jest.fn();
    const { prisma } = prismaWith(1, createMany);

    await expect(
      projector(prisma).handle(event({ eventType: 'runtime.executed' })),
    ).resolves.toBeUndefined();
    expect(createMany).not.toHaveBeenCalled();
  });
});
