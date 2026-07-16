import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, finalize } from 'rxjs';

/** One structured log line per request/response — the HTTP-layer counterpart to MetricsInterceptor. */
@Injectable()
export class AccessLogInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HttpAccess');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const started = performance.now();
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const route = `${context.getClass().name}.${context.getHandler().name}`;

    return next.handle().pipe(
      finalize(() => {
        const durationMs = Math.round(performance.now() - started);
        const record = {
          method: request.method,
          path: request.originalUrl,
          route,
          statusCode: response.statusCode,
          durationMs,
          principalId: request.principal?.id,
          tenantId: request.principal?.tenantId?.toString(),
        };
        if (response.statusCode >= 500) this.logger.error(record, 'HttpAccess');
        else this.logger.log(record, 'HttpAccess');
      }),
    );
  }
}
