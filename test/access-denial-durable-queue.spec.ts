import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { AccessDenialAuditorService } from '../src/common/security/access-denial-auditor.service';
import { MetricsService } from '../src/common/observability/metrics.service';
import type { PrismaService } from '../src/common/prisma/prisma.service';

/**
 * Plan §1.4 durable queue: a denial that fails to persist must be buffered and retried when
 * the database recovers, not dropped. Pure unit test with a fake Prisma whose availability
 * we toggle — no database required.
 */
describe('AccessDenialAuditorService durable buffer', () => {
  function makeRequest(): Request {
    return {
      method: 'GET',
      originalUrl: '/v1/artifacts',
      ip: '203.0.113.5',
      socket: { remoteAddress: '203.0.113.5' },
      headers: {},
    } as unknown as Request;
  }

  function build(config: Record<string, unknown> = {}) {
    const created: unknown[] = [];
    let available = true;
    const prisma = {
      decisionAccessAudit: {
        create: jest.fn(async ({ data }: { data: unknown }) => {
          if (!available) throw new Error('database unavailable');
          created.push(data);
          return data;
        }),
      },
    } as unknown as PrismaService;

    const service = new AccessDenialAuditorService(
      prisma,
      new MetricsService(),
      new ConfigService({ ACCESS_AUDIT_QUEUE_MAX: 3, ACCESS_AUDIT_RETRY_SECONDS: 3600, ...config }),
    );
    return {
      service,
      created,
      setAvailable: (v: boolean) => {
        available = v;
      },
      // The flush timer runs hourly in tests; drive it directly instead.
      flush: () => (service as unknown as { flushQueued: () => Promise<void> }).flushQueued(),
    };
  }

  it('persists a denial immediately when the database is up', async () => {
    const { service, created } = build();
    await service.record(makeRequest(), 'req-1', 401, 'UNAUTHORIZED');
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ decision: 'DENY', status: 401, reason: 'UNAUTHORIZED' });
  });

  it('buffers a denial instead of losing it when the write fails', async () => {
    const { service, created, setAvailable, flush } = build();
    setAvailable(false);

    // record() must not throw even though the DB is down (never turn a 401 into a 500).
    await expect(service.record(makeRequest(), 'req-2', 403, 'FORBIDDEN')).resolves.toBeUndefined();
    expect(created).toHaveLength(0);

    // Database recovers; the retry cycle drains the buffer.
    setAvailable(true);
    await flush();
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ requestId: 'req-2', status: 403 });
  });

  it('preserves order and drains all buffered denials once the database returns', async () => {
    const { service, created, setAvailable, flush } = build();
    setAvailable(false);
    await service.record(makeRequest(), 'a', 401, 'UNAUTHORIZED');
    await service.record(makeRequest(), 'b', 403, 'FORBIDDEN');

    setAvailable(true);
    await flush();

    expect(created.map((c) => (c as { requestId: string }).requestId)).toEqual(['a', 'b']);
  });

  it('drops the oldest when the bounded buffer overflows, never silently', async () => {
    const { service, created, setAvailable, flush } = build({ ACCESS_AUDIT_QUEUE_MAX: 2 });
    setAvailable(false);
    await service.record(makeRequest(), 'oldest', 401, 'UNAUTHORIZED');
    await service.record(makeRequest(), 'middle', 401, 'UNAUTHORIZED');
    await service.record(makeRequest(), 'newest', 401, 'UNAUTHORIZED'); // evicts 'oldest'

    setAvailable(true);
    await flush();

    const ids = created.map((c) => (c as { requestId: string }).requestId);
    expect(ids).toEqual(['middle', 'newest']);
    expect(ids).not.toContain('oldest');
  });

  it('keeps entries queued if the database is still down mid-flush', async () => {
    const { service, created, setAvailable, flush } = build();
    setAvailable(false);
    await service.record(makeRequest(), 'stuck', 429, 'RATE_LIMITED');

    // Still down: flush is a no-op that leaves the entry buffered.
    await flush();
    expect(created).toHaveLength(0);

    setAvailable(true);
    await flush();
    expect(created).toHaveLength(1);
  });
});
