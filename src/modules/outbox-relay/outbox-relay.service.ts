import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { hostname } from 'node:os';
import { DispatchedEvent } from '../../common/events/event-envelope';
import { EventBus } from '../../common/events/event-bus';
import { MetricsService } from '../../common/observability/metrics.service';
import { PrismaService } from '../../common/prisma/prisma.service';

/** An outbox row as returned by the raw claim query (snake_case, post-increment attempt). */
interface ClaimedRow {
  id: bigint;
  tenant_id: bigint;
  event_type: string;
  schema_version: string;
  aggregate_type: string;
  aggregate_id: string;
  actor_id: string;
  correlation_id: string | null;
  causation_id: string | null;
  payload_json: unknown;
  attempt_count: number;
  occurred_at: Date;
}

/**
 * Dispatches transactional-outbox events to the in-process event bus.
 *
 * Same worker shape as TestRunWorkerService: a polling loop that claims work atomically
 * with `FOR UPDATE SKIP LOCKED` plus an expiring lease, so any number of replicas can run
 * it without double-dispatch — and a replica that dies mid-batch merely leaves rows whose
 * lease lapses back into claimability. Delivery is therefore at-least-once; consumers
 * de-duplicate through decision_processed_event.
 *
 * Failure path: a failed emit re-schedules the row with exponential backoff via
 * available_at and, after OUTBOX_MAX_ATTEMPTS, dead-letters it (DEAD) for operator
 * attention — visible through atlas_outbox_dead_total.
 */
@Injectable()
export class OutboxRelayService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxRelayService.name);
  private readonly workerId = `${hostname()}:${process.pid}`;
  private pollTimer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private polling = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: EventBus,
    private readonly config: ConfigService,
    private readonly metrics: MetricsService,
  ) {}

  onModuleInit(): void {
    if (this.config.get<boolean>('OUTBOX_RELAY_ENABLED') ?? true) this.schedule(0);
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.pollTimer) clearTimeout(this.pollTimer);
  }

  private schedule(delay = this.config.get<number>('OUTBOX_RELAY_INTERVAL_MS') ?? 1_000): void {
    if (this.stopped || this.pollTimer) return;
    this.pollTimer = setTimeout(() => {
      this.pollTimer = undefined;
      void this.poll();
    }, delay);
    this.pollTimer.unref?.();
  }

  private async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      // Drain the backlog in batches rather than one batch per interval, so a burst of
      // events does not take backlog/batch polling cycles to clear.
      let dispatched: number;
      do {
        dispatched = await this.dispatchBatch();
      } while (dispatched > 0 && !this.stopped);
      this.metrics.setOutboxPending(
        await this.prisma.decisionOutboxEvent.count({ where: { status: 'PENDING' } }),
      );
    } catch (error) {
      this.logger.error(
        `Outbox relay poll failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.polling = false;
      this.schedule();
    }
  }

  /**
   * Claims one batch of due PENDING events and dispatches them. Returns how many were
   * delivered. Public so tests (and a future admin endpoint) can drive the relay without
   * timers.
   */
  async dispatchBatch(): Promise<number> {
    const batchSize = this.config.get<number>('OUTBOX_BATCH_SIZE') ?? 25;
    const leaseMs = this.config.get<number>('OUTBOX_LEASE_MS') ?? 30_000;
    const rows = await this.prisma.$queryRaw<ClaimedRow[]>(Prisma.sql`
      UPDATE decision_outbox_event
      SET lease_expires_at = ${new Date(Date.now() + leaseMs)},
          locked_by = ${this.workerId},
          attempt_count = attempt_count + 1
      WHERE id IN (
        SELECT id
        FROM decision_outbox_event
        WHERE status = 'PENDING'
          AND available_at <= now()
          AND (lease_expires_at IS NULL OR lease_expires_at < now())
        ORDER BY id ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${batchSize}
      )
      RETURNING id, tenant_id, event_type, schema_version, aggregate_type, aggregate_id,
                actor_id, correlation_id, causation_id, payload_json, attempt_count, occurred_at
    `);

    let delivered = 0;
    for (const row of rows) {
      if (await this.dispatchOne(row)) delivered += 1;
    }
    return delivered;
  }

  private async dispatchOne(row: ClaimedRow): Promise<boolean> {
    const event: DispatchedEvent = {
      outboxEventId: row.id,
      eventType: row.event_type,
      schemaVersion: row.schema_version,
      tenantId: row.tenant_id,
      aggregateType: row.aggregate_type,
      aggregateId: row.aggregate_id,
      actorId: row.actor_id,
      correlationId: row.correlation_id,
      causationId: row.causation_id,
      occurredAt: row.occurred_at,
      payload: row.payload_json,
    };
    try {
      await this.bus.emit(event);
    } catch (error) {
      await this.recordFailure(row, error);
      return false;
    }
    await this.prisma.decisionOutboxEvent.update({
      where: { id: row.id },
      data: {
        status: 'DISPATCHED',
        dispatchedAt: new Date(),
        leaseExpiresAt: null,
        lockedBy: null,
        lastError: null,
      },
    });
    this.metrics.recordOutboxDispatched(row.event_type);
    return true;
  }

  private async recordFailure(row: ClaimedRow, error: unknown): Promise<void> {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    const maxAttempts = this.config.get<number>('OUTBOX_MAX_ATTEMPTS') ?? 8;
    // attempt_count was already incremented by the claim, so it is the attempt just made.
    if (row.attempt_count >= maxAttempts) {
      await this.prisma.decisionOutboxEvent.update({
        where: { id: row.id },
        data: { status: 'DEAD', leaseExpiresAt: null, lockedBy: null, lastError: message },
      });
      this.metrics.recordOutboxDead(row.event_type);
      this.logger.error(
        `Outbox event ${row.id.toString()} (${row.event_type}) dead-lettered after ${row.attempt_count} attempts: ${message}`,
      );
      return;
    }
    await this.prisma.decisionOutboxEvent.update({
      where: { id: row.id },
      data: {
        availableAt: new Date(Date.now() + this.backoffMs(row.attempt_count)),
        leaseExpiresAt: null,
        lockedBy: null,
        lastError: message,
      },
    });
    this.logger.warn(
      `Outbox event ${row.id.toString()} (${row.event_type}) failed attempt ${row.attempt_count}, will retry: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  /** Exponential backoff seeded by the poll interval: 2x, 4x, 8x… capped at five minutes. */
  private backoffMs(attempt: number): number {
    const base = this.config.get<number>('OUTBOX_RELAY_INTERVAL_MS') ?? 1_000;
    return Math.min(300_000, base * 2 ** Math.min(attempt, 8));
  }
}
