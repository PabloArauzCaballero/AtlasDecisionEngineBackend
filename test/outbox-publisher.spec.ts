import type { Prisma } from '@prisma/client';
import { OutboxPublisherService } from '../src/common/events/outbox-publisher.service';
import type { JobSignalService } from '../src/common/jobs/job-signal.service';
import { DecisionEventType } from '../src/common/events/event-types';
import { TracingService } from '../src/common/observability/tracing.service';
import { MessagingTraceService } from '../src/common/observability/messaging-trace.service';

function fakeJobSignal(): JobSignalService {
  return { notify: jest.fn().mockResolvedValue(undefined) } as unknown as JobSignalService;
}

describe('OutboxPublisherService', () => {
  it('writes the outbox row on the caller-supplied transaction, never its own', async () => {
    const create = jest.fn().mockResolvedValue({ id: 99n });
    const tx = { decisionOutboxEvent: { create } } as unknown as Prisma.TransactionClient;
    const jobSignal = fakeJobSignal();
    const publisher = new OutboxPublisherService(
      jobSignal,
      new MessagingTraceService(new TracingService()),
    );

    await publisher.publish(tx, {
      eventType: DecisionEventType.VERSION_APPROVED,
      tenantId: 7n,
      aggregateType: 'ApprovalRequest',
      aggregateId: '10',
      actorId: 'qa@atlas.test',
      correlationId: 'req-1',
      payload: { versionId: '5' },
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: 'version.approved',
        tenantId: 7n,
        aggregateType: 'ApprovalRequest',
        aggregateId: '10',
        actorId: 'qa@atlas.test',
        correlationId: 'req-1',
        // Defaulted when the caller omits it, so every consumer can rely on it.
        schemaVersion: '1',
        payloadJson: { versionId: '5' },
      }),
    });
    // Anuncia el trabajo en la MISMA transacción que el INSERT, para que el relay solo
    // despierte si el commit de negocio realmente ocurrió.
    expect(jobSignal.notify).toHaveBeenCalledWith(tx, 'outbox-relay');
  });

  it('carries an explicit schemaVersion through unchanged', async () => {
    const create = jest.fn().mockResolvedValue({ id: 1n });
    const tx = { decisionOutboxEvent: { create } } as unknown as Prisma.TransactionClient;

    await new OutboxPublisherService(
      fakeJobSignal(),
      new MessagingTraceService(new TracingService()),
    ).publish(tx, {
      eventType: 'version.approved',
      schemaVersion: '2',
      tenantId: 1n,
      aggregateType: 'ApprovalRequest',
      aggregateId: '1',
      actorId: 'a',
      payload: {},
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ schemaVersion: '2' }),
    });
  });
});
