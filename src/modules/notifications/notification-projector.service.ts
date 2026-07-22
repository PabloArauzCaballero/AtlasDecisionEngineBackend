import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DispatchedEvent } from '../../common/events/event-envelope';
import { DecisionEventType } from '../../common/events/event-types';
import { EventBus } from '../../common/events/event-bus';
import { PlatformRole } from '../../common/security/platform-roles';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateNotificationInput, NotificationService } from './notification.service';

/** Reads a string field defensively from an event payload of unknown shape. */
function field(payload: unknown, key: string): string | undefined {
  const value = (payload as Record<string, unknown> | null | undefined)?.[key];
  return typeof value === 'string' && value.length ? value : undefined;
}

function stringArray(payload: unknown, key: string): string[] {
  const value = (payload as Record<string, unknown> | null | undefined)?.[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

/**
 * Projects domain events into inbox notifications — the ONLY producer of notifications.
 * Controllers never create them directly; anything worth telling a user about must first
 * be a published event, which keeps the inbox complete and replayable by construction.
 *
 * Exactly-once effect on at-least-once delivery: the ProcessedEvent insert (unique on
 * consumerName + outboxEventId, ON CONFLICT DO NOTHING) and the notification rows share
 * one transaction, so a redelivered event finds the marker and contributes nothing.
 */
@Injectable()
export class NotificationProjectorService implements OnModuleInit, OnModuleDestroy {
  static readonly CONSUMER_NAME = 'notification-projector';

  private readonly logger = new Logger(NotificationProjectorService.name);
  private unsubscribe?: () => void;

  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: EventBus,
    private readonly notifications: NotificationService,
  ) {}

  onModuleInit(): void {
    this.unsubscribe = this.bus.subscribeAll((event) => this.handle(event));
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
  }

  /**
   * Consumes one dispatched event. A throw here propagates to the relay, which keeps the
   * outbox row PENDING and retries with backoff — so this must only throw on real
   * persistence failures, never on merely unmapped event types.
   */
  async handle(event: DispatchedEvent): Promise<void> {
    const specs = this.project(event);
    if (!specs.length) return;
    const created = await this.prisma.$transaction(async (tx) => {
      const marker = await tx.processedEvent.createMany({
        data: [
          {
            consumerName: NotificationProjectorService.CONSUMER_NAME,
            outboxEventId: event.outboxEventId,
          },
        ],
        skipDuplicates: true,
      });
      if (marker.count === 0) return 0; // Already processed: a redelivery, not new work.
      return this.notifications.createMany(tx, specs);
    });
    if (created > 0) {
      this.logger.log(
        `Projected ${created} notification(s) from ${event.eventType} #${event.outboxEventId.toString()}`,
      );
    }
  }

  /** Maps one event to the notifications it produces (v1 rules). Unknown types map to none. */
  private project(event: DispatchedEvent): CreateNotificationInput[] {
    const base = {
      tenantId: event.tenantId,
      eventType: event.eventType,
      correlationId: event.correlationId ?? undefined,
      entityType: event.aggregateType,
      entityId: event.aggregateId,
    };
    const artifactCode = field(event.payload, 'artifactCode') ?? 'artefacto';
    const requestId = field(event.payload, 'approvalRequestId');
    const actionUrl = requestId ? `/approval-requests/${requestId}` : undefined;
    const authorId = field(event.payload, 'authorId');
    const comments = field(event.payload, 'comments');

    switch (event.eventType) {
      case DecisionEventType.VERSION_SUBMITTED_FOR_REVIEW:
        // One notification per required reviewer role, so each queue sees its own work.
        return stringArray(event.payload, 'reviewerRoles').map((role) => ({
          ...base,
          recipientRole: role,
          category: 'GOVERNANCE',
          title: `Revisión solicitada: ${artifactCode}`,
          body: `Se envió una versión de ${artifactCode} a revisión y requiere aprobación del rol ${role}.`,
          actionUrl,
        }));
      case DecisionEventType.VERSION_CHANGES_REQUESTED:
        if (!authorId) return [];
        return [
          {
            ...base,
            recipientId: authorId,
            category: 'GOVERNANCE',
            title: `Cambios solicitados: ${artifactCode}`,
            body: comments
              ? `Un revisor solicitó cambios en ${artifactCode}: ${comments}`
              : `Un revisor solicitó cambios en la versión enviada de ${artifactCode}.`,
            actionUrl,
          },
        ];
      case DecisionEventType.VERSION_APPROVED:
        if (!authorId) return [];
        return [
          {
            ...base,
            recipientId: authorId,
            category: 'GOVERNANCE',
            title: `Versión aprobada: ${artifactCode}`,
            body: `Todos los pasos de aprobación de ${artifactCode} fueron completados. La versión está lista para desplegarse.`,
            actionUrl,
          },
        ];
      case DecisionEventType.VERSION_REJECTED:
        if (!authorId) return [];
        return [
          {
            ...base,
            recipientId: authorId,
            category: 'GOVERNANCE',
            priority: 'HIGH',
            title: `Versión rechazada: ${artifactCode}`,
            body: comments
              ? `La versión de ${artifactCode} fue rechazada: ${comments}`
              : `La versión de ${artifactCode} fue rechazada durante la revisión.`,
            actionUrl,
          },
        ];
      case DecisionEventType.VERSION_PUBLISHED:
        return [
          {
            ...base,
            recipientRole: PlatformRole.OPERATIONS,
            category: 'DEPLOYMENT',
            title: `Versión publicada: ${artifactCode}`,
            body: `Una nueva versión de ${artifactCode} quedó activa en ${field(event.payload, 'environmentCode') ?? 'un ambiente'}.`,
            actionUrl: '/deployments',
          },
        ];
      case DecisionEventType.SECURITY_RISK_DETECTED:
        return [PlatformRole.COMPLIANCE, PlatformRole.FRAUD_ANALYST].map((role) => ({
          ...base,
          recipientRole: role,
          category: 'SECURITY',
          priority: 'HIGH',
          title: 'Riesgo de seguridad detectado',
          body: field(event.payload, 'summary') ?? 'Se detectó un riesgo que requiere revisión.',
        }));
      default:
        return [];
    }
  }
}
