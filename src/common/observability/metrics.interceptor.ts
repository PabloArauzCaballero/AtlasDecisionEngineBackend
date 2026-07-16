import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, finalize } from 'rxjs';
import { MetricsService } from './metrics.service';

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const started = performance.now();
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const route = `${context.getClass().name}.${context.getHandler().name}`;
    return next.handle().pipe(
      finalize(() => {
        this.metrics.recordRequest(
          request.method,
          route,
          response.statusCode,
          Math.max(0, performance.now() - started),
        );
      }),
    );
  }
}
