import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { Observable, catchError, tap, throwError } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AccessAuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AccessAuditInterceptor.name);
  private readonly enabled: boolean;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.enabled = config.get<boolean>('ACCESS_AUDIT_ENABLED') ?? true;
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const principal = request.principal;
    if (!this.enabled || !principal) return next.handle();

    const resource = `${request.method} ${context.getClass().name}.${context.getHandler().name}`;
    const record = (decision: 'ALLOW' | 'DENY', reason?: string) =>
      this.prisma.decisionAccessAudit
        .create({
          data: {
            requestId: principal.requestId,
            principalId: principal.id,
            tenantId: principal.tenantId,
            resource: resource.slice(0, 160),
            action: request.method,
            decision,
            reason: reason?.slice(0, 200),
          },
        })
        .catch((error: unknown) => {
          this.logger.error(
            `Failed to persist access audit: ${error instanceof Error ? error.message : String(error)}`,
          );
        });

    return next.handle().pipe(
      tap(() => void record('ALLOW')),
      catchError((error: unknown) => {
        void record('DENY', error instanceof Error ? error.message : 'unknown');
        return throwError(() => error);
      }),
    );
  }
}
