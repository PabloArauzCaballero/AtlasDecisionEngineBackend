import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Notification, Prisma } from '@prisma/client';
import { DomainException } from '../../common/errors/domain-exception';
import { keysetArgs, keysetPage, KeysetPage } from '../../common/http/pagination';
import { MetricsService } from '../../common/observability/metrics.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationListQueryDto } from './notification.dto';

/** Whose inbox is being read: the caller's principal id plus the roles it holds. */
export interface NotificationRecipient {
  principalId: string;
  roles: string[];
}

/** One notification to persist, addressed to a role, a principal, or both. */
export interface CreateNotificationInput {
  tenantId: bigint;
  recipientRole?: string;
  recipientId?: string;
  category: string;
  priority?: string;
  title: string;
  body: string;
  entityType?: string;
  entityId?: string;
  actionUrl?: string;
  eventType: string;
  correlationId?: string;
}

/**
 * Persistent notification inbox.
 *
 * Recipients are resolved server-side from the authenticated principal (roles + id),
 * never from caller input: a notification is visible iff its recipientRole is one of the
 * caller's roles or its recipientId is the caller — authorization lives in the query,
 * not in the UI. Users live in the external identity provider, which is why the model
 * addresses roles rather than a user directory this service does not own.
 */
@Injectable()
export class NotificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly metrics: MetricsService,
  ) {}

  /** Persists projected notifications inside the projector's transaction. */
  async createMany(
    tx: Prisma.TransactionClient,
    notifications: CreateNotificationInput[],
  ): Promise<number> {
    if (!notifications.length) return 0;
    const result = await tx.notification.createMany({
      data: notifications.map((item) => ({
        tenantId: item.tenantId,
        recipientRole: item.recipientRole,
        recipientId: item.recipientId,
        category: item.category,
        priority: item.priority ?? 'NORMAL',
        title: item.title,
        body: item.body,
        entityType: item.entityType,
        entityId: item.entityId,
        actionUrl: item.actionUrl,
        eventType: item.eventType,
        correlationId: item.correlationId,
      })),
    });
    for (const item of notifications) this.metrics.recordNotificationCreated(item.eventType);
    return result.count;
  }

  /** Visibility filter: the caller's own principal id, or any role the caller holds. */
  private recipientWhere(tenantId: bigint, recipient: NotificationRecipient) {
    return {
      tenantId,
      OR: [
        { recipientId: recipient.principalId },
        ...(recipient.roles.length ? [{ recipientRole: { in: recipient.roles } }] : []),
      ],
    };
  }

  async list(
    tenantId: bigint,
    recipient: NotificationRecipient,
    query: NotificationListQueryDto,
  ): Promise<KeysetPage<Notification>> {
    const {
      take,
      pageSize,
      orderBy,
      where: cursorWhere,
    } = keysetArgs(query, this.config.get<number>('MAX_PAGE_SIZE') ?? 100);
    const rows = await this.prisma.notification.findMany({
      where: {
        ...this.recipientWhere(tenantId, recipient),
        ...(query.unreadOnly === 'true' ? { readAt: null } : {}),
        ...(query.category ? { category: query.category } : {}),
        ...cursorWhere,
      },
      orderBy,
      take,
    });
    return keysetPage(rows, pageSize);
  }

  async unreadCount(
    tenantId: bigint,
    recipient: NotificationRecipient,
  ): Promise<{ unread: number }> {
    const unread = await this.prisma.notification.count({
      where: { ...this.recipientWhere(tenantId, recipient), readAt: null },
    });
    return { unread };
  }

  /**
   * Marks one visible notification as read. Idempotent: a second call leaves the original
   * readAt untouched and still succeeds — re-reading is not an error a user can act on.
   */
  async markRead(
    tenantId: bigint,
    recipient: NotificationRecipient,
    notificationId: bigint,
  ): Promise<Notification> {
    await this.prisma.notification.updateMany({
      where: { id: notificationId, ...this.recipientWhere(tenantId, recipient), readAt: null },
      data: { readAt: new Date() },
    });
    // Fetched after the update so both the fresh and the already-read case return the
    // persisted row; a miss here means the notification does not exist for this caller.
    const notification = await this.prisma.notification.findFirst({
      where: { id: notificationId, ...this.recipientWhere(tenantId, recipient) },
    });
    if (!notification) {
      throw new DomainException(
        'NOTIFICATION_NOT_FOUND',
        'Notification not found',
        HttpStatus.NOT_FOUND,
      );
    }
    return notification;
  }

  /** Marks every unread visible notification as read. Idempotent by construction. */
  async markAllRead(
    tenantId: bigint,
    recipient: NotificationRecipient,
  ): Promise<{ updated: number }> {
    const result = await this.prisma.notification.updateMany({
      where: { ...this.recipientWhere(tenantId, recipient), readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: result.count };
  }
}
