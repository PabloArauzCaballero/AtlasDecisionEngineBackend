import { ConfigService } from '@nestjs/config';
import type { MetricsService } from '../src/common/observability/metrics.service';
import type { PrismaService } from '../src/common/prisma/prisma.service';
import { NotificationService } from '../src/modules/notifications/notification.service';

const config = new ConfigService({ MAX_PAGE_SIZE: 100 });
const metrics = { recordNotificationCreated: jest.fn() } as unknown as MetricsService;

describe('NotificationService recipient scoping (RBAC)', () => {
  it('lists only notifications addressed to the caller principal or a held role', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new NotificationService(
      { notification: { findMany } } as unknown as PrismaService,
      config,
      metrics,
    );

    await service.list(7n, { principalId: 'qa@atlas.test', roles: ['QA_ANALYST'] }, {
      pageSize: 25,
    } as never);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 7n,
          OR: [{ recipientId: 'qa@atlas.test' }, { recipientRole: { in: ['QA_ANALYST'] } }],
        }),
      }),
    );
  });

  it('scopes a caller with no roles to their principal id alone', async () => {
    const count = jest.fn().mockResolvedValue(3);
    const service = new NotificationService(
      { notification: { count } } as unknown as PrismaService,
      config,
      metrics,
    );

    const result = await service.unreadCount(7n, { principalId: 'ops@atlas.test', roles: [] });

    expect(result).toEqual({ unread: 3 });
    expect(count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        tenantId: 7n,
        OR: [{ recipientId: 'ops@atlas.test' }],
        readAt: null,
      }),
    });
  });

  it('filters to unread when unreadOnly is requested', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new NotificationService(
      { notification: { findMany } } as unknown as PrismaService,
      config,
      metrics,
    );

    await service.list(7n, { principalId: 'qa@atlas.test', roles: ['QA_ANALYST'] }, {
      pageSize: 25,
      unreadOnly: 'true',
    } as never);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ readAt: null }) }),
    );
  });

  it('markAllRead only touches unread rows the caller can see', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 2 });
    const service = new NotificationService(
      { notification: { updateMany } } as unknown as PrismaService,
      config,
      metrics,
    );

    const result = await service.markAllRead(7n, {
      principalId: 'qa@atlas.test',
      roles: ['QA_ANALYST'],
    });

    expect(result).toEqual({ updated: 2 });
    expect(updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        tenantId: 7n,
        OR: [{ recipientId: 'qa@atlas.test' }, { recipientRole: { in: ['QA_ANALYST'] } }],
        readAt: null,
      }),
      data: { readAt: expect.any(Date) },
    });
  });

  it('markRead raises NOTIFICATION_NOT_FOUND when the row is not visible to the caller', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    const findFirst = jest.fn().mockResolvedValue(null);
    const service = new NotificationService(
      { notification: { updateMany, findFirst } } as unknown as PrismaService,
      config,
      metrics,
    );

    await expect(
      service.markRead(7n, { principalId: 'intruder@atlas.test', roles: [] }, 99n),
    ).rejects.toMatchObject({ code: 'NOTIFICATION_NOT_FOUND' });
  });
});
