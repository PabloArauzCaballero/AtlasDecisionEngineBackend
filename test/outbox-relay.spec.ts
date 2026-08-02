import { ConfigService } from '@nestjs/config';
import type { EventBus } from '../src/common/events/event-bus';
import type { JobSchedulerService } from '../src/common/jobs/job-scheduler.service';
import type { MetricsService } from '../src/common/observability/metrics.service';
import type { PrismaService } from '../src/common/prisma/prisma.service';
import { OutboxRelayService } from '../src/modules/outbox-relay/outbox-relay.service';

type RelayInternals = {
  dispatchBatch: () => Promise<number>;
  runOnce: () => Promise<number>;
};

function claimedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 5n,
    tenant_id: 7n,
    event_type: 'version.approved',
    schema_version: '1',
    aggregate_type: 'ApprovalRequest',
    aggregate_id: '10',
    actor_id: 'qa@atlas.test',
    correlation_id: 'req-1',
    causation_id: null,
    payload_json: { versionId: '5' },
    attempt_count: 1,
    occurred_at: new Date('2026-07-21T00:00:00.000Z'),
    ...overrides,
  };
}

function build(prisma: unknown, bus: unknown, config: ConfigService) {
  const metrics = {
    setOutboxPending: jest.fn(),
    recordOutboxDispatched: jest.fn(),
    recordOutboxDead: jest.fn(),
  } as unknown as MetricsService;
  // dispatchBatch() se ejerce directamente en estas pruebas; el orquestador nunca entra en
  // juego, así que un doble sin comportamiento basta.
  const scheduler = { register: jest.fn() } as unknown as JobSchedulerService;
  const relay = new OutboxRelayService(
    prisma as PrismaService,
    bus as EventBus,
    config,
    metrics,
    scheduler,
  );
  return { relay: relay as unknown as RelayInternals, metrics };
}

describe('OutboxRelayService.dispatchBatch', () => {
  it('marks a successfully dispatched event DISPATCHED and counts it', async () => {
    const update = jest.fn().mockResolvedValue({});
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([claimedRow()]),
      decisionOutboxEvent: { update },
    };
    const emit = jest.fn().mockResolvedValue(undefined);
    const { relay, metrics } = build(prisma, { emit }, new ConfigService({}));

    const delivered = await relay.dispatchBatch();

    expect(delivered).toBe(1);
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ outboxEventId: 5n, eventType: 'version.approved', tenantId: 7n }),
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 5n },
        data: expect.objectContaining({ status: 'DISPATCHED', leaseExpiresAt: null }),
      }),
    );
    expect(metrics.recordOutboxDispatched).toHaveBeenCalledWith('version.approved');
  });

  it('reschedules a failed event with backoff while attempts remain', async () => {
    const update = jest.fn().mockResolvedValue({});
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([claimedRow({ attempt_count: 2 })]),
      decisionOutboxEvent: { update },
    };
    const emit = jest.fn().mockRejectedValue(new Error('bus down'));
    const { relay, metrics } = build(
      prisma,
      { emit },
      new ConfigService({ OUTBOX_MAX_ATTEMPTS: 8 }),
    );

    const delivered = await relay.dispatchBatch();

    expect(delivered).toBe(0);
    const data = update.mock.calls[0][0].data;
    expect(data.availableAt).toBeInstanceOf(Date);
    expect(data.availableAt.getTime()).toBeGreaterThan(Date.now());
    expect(data.status).toBeUndefined(); // stays PENDING
    expect(data.lastError).toContain('bus down');
    expect(metrics.recordOutboxDead).not.toHaveBeenCalled();
  });

  it('dead-letters an event once it exhausts OUTBOX_MAX_ATTEMPTS', async () => {
    const update = jest.fn().mockResolvedValue({});
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([claimedRow({ attempt_count: 8 })]),
      decisionOutboxEvent: { update },
    };
    const emit = jest.fn().mockRejectedValue(new Error('still down'));
    const { relay, metrics } = build(
      prisma,
      { emit },
      new ConfigService({ OUTBOX_MAX_ATTEMPTS: 8 }),
    );

    await relay.dispatchBatch();

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 5n },
        data: expect.objectContaining({ status: 'DEAD', leaseExpiresAt: null }),
      }),
    );
    expect(metrics.recordOutboxDead).toHaveBeenCalledWith('version.approved');
  });

  it('returns zero without touching the bus when no event is due', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      decisionOutboxEvent: { update: jest.fn() },
    };
    const emit = jest.fn();
    const { relay } = build(prisma, { emit }, new ConfigService({}));

    expect(await relay.dispatchBatch()).toBe(0);
    expect(emit).not.toHaveBeenCalled();
  });
});

describe('OutboxRelayService.runOnce (orchestrator entry point)', () => {
  it('samples the backlog gauge only when the batch was empty', async () => {
    const count = jest.fn().mockResolvedValue(3);
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      decisionOutboxEvent: { update: jest.fn(), count },
    };
    const { relay, metrics } = build(prisma, { emit: jest.fn() }, new ConfigService({}));

    const processed = await (relay as unknown as RelayInternals).runOnce();

    expect(processed).toBe(0);
    expect(count).toHaveBeenCalledWith({ where: { status: 'PENDING' } });
    expect(metrics.setOutboxPending).toHaveBeenCalledWith(3);
  });

  it('skips the backlog sample when the batch delivered events', async () => {
    const count = jest.fn().mockResolvedValue(0);
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([claimedRow()]),
      decisionOutboxEvent: { update: jest.fn().mockResolvedValue({}), count },
    };
    const { relay, metrics } = build(
      prisma,
      { emit: jest.fn().mockResolvedValue(undefined) },
      new ConfigService({}),
    );

    const processed = await (relay as unknown as RelayInternals).runOnce();

    expect(processed).toBe(1);
    expect(count).not.toHaveBeenCalled();
    expect(metrics.setOutboxPending).not.toHaveBeenCalled();
  });

  it('throttles repeated backlog samples to OUTBOX_BACKLOG_SAMPLE_MS', async () => {
    const count = jest.fn().mockResolvedValue(0);
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      decisionOutboxEvent: { update: jest.fn(), count },
    };
    const { relay, metrics } = build(
      prisma,
      { emit: jest.fn() },
      new ConfigService({ OUTBOX_BACKLOG_SAMPLE_MS: 60_000 }),
    );

    await (relay as unknown as RelayInternals).runOnce();
    await (relay as unknown as RelayInternals).runOnce();

    expect(count).toHaveBeenCalledTimes(1);
    expect(metrics.setOutboxPending).toHaveBeenCalledTimes(1);
  });
});
