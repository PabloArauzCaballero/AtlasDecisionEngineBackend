import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { hostname } from 'node:os';
import { runsBackgroundJobs, workerRoleOf } from '../../common/config/worker-role';
import { BackgroundJob } from '../../common/jobs/background-job';
import { JobName } from '../../common/jobs/job-names';
import { JobSchedulerService } from '../../common/jobs/job-scheduler.service';
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
 * Claims work atomically with `FOR UPDATE SKIP LOCKED` plus an expiring lease, so any
 * number of replicas can run it without double-dispatch — and a replica that dies mid-batch
 * merely leaves rows whose lease lapses back into claimability. Delivery is therefore
 * at-least-once; consumers de-duplicate through decision_processed_event.
 *
 * Failure path: a failed emit re-schedules the row with exponential backoff via
 * available_at and, after OUTBOX_MAX_ATTEMPTS, dead-letters it (DEAD) for operator
 * attention — visible through atlas_outbox_dead_total.
 *
 * Cuándo corre lo decide el {@link JobSchedulerService}: este servicio ya no trae
 * temporizador propio. El productor anuncia cada fila con `pg_notify` al hacer commit
 * (ver OutboxPublisherService), así que el reparto ocurre a la latencia del commit y el
 * sondeo queda como red de seguridad con un intervalo largo — antes era al revés, y el
 * relay pagaba un sondeo por segundo aunque no hubiera un solo evento en todo el día.
 */
@Injectable()
export class OutboxRelayService implements OnModuleInit, BackgroundJob {
  private readonly logger = new Logger(OutboxRelayService.name);
  private readonly workerId = `${hostname()}:${process.pid}`;

  readonly name = JobName.OutboxRelay;
  readonly minIdleIntervalMs: number;
  readonly maxIdleIntervalMs: number;
  readonly initialDelayMs = 0;

  /** Última vez que se muestreó el gauge de pendientes; ver {@link sampleBacklog}. */
  private lastBacklogSampleAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: EventBus,
    private readonly config: ConfigService,
    private readonly metrics: MetricsService,
    private readonly scheduler: JobSchedulerService,
  ) {
    this.minIdleIntervalMs = config.get<number>('OUTBOX_RELAY_INTERVAL_MS') ?? 1_000;
    this.maxIdleIntervalMs = Math.max(
      config.get<number>('OUTBOX_RELAY_MAX_INTERVAL_MS') ?? 30_000,
      this.minIdleIntervalMs,
    );
  }

  onModuleInit(): void {
    // El rol dice DÓNDE puede correr el relay (una réplica API pura no lo corre) y el
    // interruptor si está activo; se combinan con Y lógico y ninguno suplanta al otro.
    if (!runsBackgroundJobs(this.config)) {
      this.logger.log(`Outbox relay not started: WORKER_ROLE=${workerRoleOf(this.config)}`);
      return;
    }
    if (!(this.config.get<boolean>('OUTBOX_RELAY_ENABLED') ?? true)) {
      this.logger.log('Outbox relay disabled by configuration');
      return;
    }
    this.scheduler.register(this);
  }

  /**
   * Un ciclo del orquestador: reparte un lote y devuelve cuántos eventos entregó. Devolver
   * el número es lo que hace que una ráfaga se drene sin esperar un intervalo por lote,
   * sin necesidad del bucle `do/while` que este servicio tenía dentro.
   */
  async runOnce(): Promise<number> {
    const dispatched = await this.dispatchBatch();
    if (dispatched === 0) await this.sampleBacklog();
    return dispatched;
  }

  /**
   * Muestrea la profundidad del outbox para el gauge.
   *
   * Solo cuando el relay queda ocioso —si acaba de repartir, va a volver enseguida— y como
   * mucho una vez por `OUTBOX_BACKLOG_SAMPLE_MS`. Antes se contaba en CADA sondeo: un
   * `count(*)` sobre la tabla de eventos, una vez por segundo y por réplica, para alimentar
   * un gauge que Prometheus raspa cada 15 s. La medida costaba más que lo medido.
   */
  private async sampleBacklog(): Promise<void> {
    const intervalMs = this.config.get<number>('OUTBOX_BACKLOG_SAMPLE_MS') ?? 30_000;
    const now = Date.now();
    if (now - this.lastBacklogSampleAt < intervalMs) return;
    this.lastBacklogSampleAt = now;
    this.metrics.setOutboxPending(
      await this.prisma.decisionOutboxEvent.count({ where: { status: 'PENDING' } }),
    );
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
