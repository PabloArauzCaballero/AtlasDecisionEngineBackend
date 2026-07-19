import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { MetricsService } from '../observability/metrics.service';
import { PrismaService } from '../prisma/prisma.service';
import type { Prisma } from '@prisma/client';

/** A denial ready to persist, extracted from the request so no Express object is retained. */
type DenialRecord = Prisma.DecisionAccessAuditCreateInput;

/**
 * Persists security-significant authentication and authorization denials.
 *
 * Guards run before interceptors, so AccessAuditInterceptor never sees a request that a
 * guard rejects. The global exception filter is the convergence point for 401, 403 and
 * 429 responses and invokes this service without delaying or changing the response.
 *
 * A denial that fails to persist is not dropped: it is buffered and retried when the
 * database recovers (plan §1.4). The buffer is in-process and bounded — it survives the
 * transient database outages this system actually sees, not a process restart; a
 * cross-restart guarantee would need a persisted outbox, which is a larger change.
 */
@Injectable()
export class AccessDenialAuditorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AccessDenialAuditorService.name);
  private readonly enabled: boolean;
  private readonly maxQueue: number;
  private readonly retryIntervalMs: number;

  /** FIFO buffer of denials awaiting a database that was unavailable when they occurred. */
  private readonly pending: DenialRecord[] = [];
  private retryTimer?: NodeJS.Timeout;
  private flushing = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
    config: ConfigService,
  ) {
    this.enabled = config.get<boolean>('ACCESS_AUDIT_ENABLED') ?? true;
    this.maxQueue = config.get<number>('ACCESS_AUDIT_QUEUE_MAX') ?? 1_000;
    this.retryIntervalMs = (config.get<number>('ACCESS_AUDIT_RETRY_SECONDS') ?? 15) * 1_000;
  }

  onModuleInit(): void {
    if (!this.enabled) return;
    // Drain the buffer periodically. unref() so a pending retry never keeps the process
    // alive on shutdown.
    this.retryTimer = setInterval(() => void this.flushQueued(), this.retryIntervalMs);
    this.retryTimer.unref?.();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.retryTimer) clearInterval(this.retryTimer);
    // A best-effort final drain so a graceful shutdown does not strand buffered denials.
    await this.flushQueued();
  }

  /** Denials that carry security meaning; other 4xx responses are validation traffic. */
  private static readonly AUDITED_STATUSES = new Set([401, 403, 429]);

  /** Returns whether the configured access-audit policy includes the status. */
  shouldAudit(status: number): boolean {
    return this.enabled && AccessDenialAuditorService.AUDITED_STATUSES.has(status);
  }

  /**
   * Records a denied request. The write is attempted immediately; if it fails the denial
   * is buffered for retry rather than lost, and never turns the original 401/403/429 into
   * a 500.
   */
  async record(request: Request, requestId: string, status: number, code: string): Promise<void> {
    if (!this.shouldAudit(status)) return;
    const principal = request.principal;
    const denial: DenialRecord = {
      requestId: requestId.slice(0, 120),
      // Absent on a 401: the request never established an identity.
      principalId: principal?.id?.slice(0, 160) ?? null,
      tenantId: principal?.tenantId ?? null,
      resource: `${request.method} ${request.originalUrl ?? ''}`.slice(0, 160),
      action: request.method.slice(0, 80),
      decision: 'DENY',
      reason: code.slice(0, 200),
      ipAddress: this.clientIp(request)?.slice(0, 64) ?? null,
      status,
    };

    try {
      await this.prisma.decisionAccessAudit.create({ data: denial });
    } catch (error) {
      this.enqueue(denial, error);
    }
  }

  /** Buffers a denial that could not be written, dropping the oldest if the buffer is full. */
  private enqueue(denial: DenialRecord, error: unknown): void {
    if (this.pending.length >= this.maxQueue) {
      // Never silent: a dropped security event is itself reportable.
      this.pending.shift();
      this.metrics.recordProviderFailure('access_audit', 'queue_overflow');
      this.logger.error('Access denial audit buffer overflow: dropped the oldest buffered denial');
    }
    this.pending.push(denial);
    this.metrics.recordProviderFailure('access_audit', 'buffered');
    this.logger.warn(
      `Buffered access denial audit for retry (${this.pending.length} pending): ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  /**
   * Drains buffered denials into the database. Stops on the first failure so a still-down
   * database is not hammered; the remaining entries stay queued for the next cycle.
   */
  private async flushQueued(): Promise<void> {
    if (this.flushing || !this.pending.length) return;
    this.flushing = true;
    try {
      while (this.pending.length) {
        const denial = this.pending[0];
        try {
          await this.prisma.decisionAccessAudit.create({ data: denial });
          this.pending.shift();
        } catch {
          // Database still unavailable; leave this and the rest for the next cycle.
          break;
        }
      }
    } finally {
      this.flushing = false;
    }
  }

  private clientIp(request: Request): string | undefined {
    return request.ip ?? request.socket?.remoteAddress ?? undefined;
  }
}
