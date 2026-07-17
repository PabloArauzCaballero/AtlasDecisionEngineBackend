import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Persists security-significant authentication and authorization denials.
 *
 * Guards run before interceptors, so AccessAuditInterceptor never sees a request that a
 * guard rejects. The global exception filter is the convergence point for 401, 403 and
 * 429 responses and invokes this service without delaying or changing the response.
 */
@Injectable()
export class AccessDenialAuditorService {
  private readonly logger = new Logger(AccessDenialAuditorService.name);
  private readonly enabled: boolean;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.enabled = config.get<boolean>('ACCESS_AUDIT_ENABLED') ?? true;
  }

  /** Denials that carry security meaning; other 4xx responses are validation traffic. */
  private static readonly AUDITED_STATUSES = new Set([401, 403, 429]);

  /** Returns whether the configured access-audit policy includes the status. */
  shouldAudit(status: number): boolean {
    return this.enabled && AccessDenialAuditorService.AUDITED_STATUSES.has(status);
  }

  /**
   * Records a denied request on a best-effort basis.
   *
   * Persistence failures are logged and never replace the original HTTP response.
   */
  async record(request: Request, requestId: string, status: number, code: string): Promise<void> {
    if (!this.shouldAudit(status)) return;
    const principal = request.principal;
    try {
      await this.prisma.decisionAccessAudit.create({
        data: {
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
        },
      });
    } catch (error) {
      // Never let auditing turn a clean 401 into a 500. The rejection still reaches the
      // caller and the structured log retains the event.
      this.logger.error(
        `Failed to persist access denial audit: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private clientIp(request: Request): string | undefined {
    return request.ip ?? request.socket?.remoteAddress ?? undefined;
  }
}
