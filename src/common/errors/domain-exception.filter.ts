import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import type { AccessDenialAuditorService } from '../security/access-denial-auditor.service';
import type { MetricsService } from '../observability/metrics.service';
import { DomainException } from './domain-exception';

@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(DomainExceptionFilter.name);

  constructor(
    private readonly config: ConfigService,
    /** Optional so the filter stays usable in contexts without a database. */
    private readonly denialAuditor?: AccessDenialAuditorService,
    /** Optional so the filter stays usable in contexts without the metrics registry. */
    private readonly metrics?: MetricsService,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const request = host.switchToHttp().getRequest<Request>();
    const requestId = String(
      request.principal?.requestId ?? request.headers['x-request-id'] ?? randomUUID(),
    );

    if (exception instanceof DomainException) {
      this.metrics?.recordError(exception.code);
      this.logRejection(request, requestId, exception.status, exception.code, exception.message);
      this.auditDenial(request, requestId, exception.status, exception.code);
      response.status(exception.status).json({
        type: `https://atlas.local/errors/${exception.code.toLowerCase()}`,
        title: exception.code,
        status: exception.status,
        requestId,
        error: {
          code: exception.code,
          message: exception.message,
          details: exception.details,
        },
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const bodyObject = typeof body === 'object' ? (body as Record<string, unknown>) : undefined;
      const message = typeof body === 'string' ? body : (bodyObject?.message ?? exception.message);
      this.metrics?.recordError(`HTTP_${status}`);
      this.logRejection(request, requestId, status, `HTTP_${status}`, String(message));
      this.auditDenial(request, requestId, status, `HTTP_${status}`);
      response.status(status).json({
        type: `https://atlas.local/errors/http-${status}`,
        title: `HTTP_${status}`,
        status,
        requestId,
        error: {
          code: `HTTP_${status}`,
          message,
          details: bodyObject,
        },
      });
      return;
    }

    const internalMessage = exception instanceof Error ? exception.message : String(exception);
    this.metrics?.recordError('INTERNAL_ERROR');
    this.logger.error(
      `Unhandled error for ${request.method} ${request.originalUrl}: ${internalMessage}`,
      exception instanceof Error ? exception.stack : undefined,
    );
    const production = this.config.get<string>('NODE_ENV') === 'production';
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      type: 'https://atlas.local/errors/internal-error',
      title: 'INTERNAL_ERROR',
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      requestId,
      error: {
        code: 'INTERNAL_ERROR',
        message: production ? 'An unexpected server error occurred' : internalMessage,
      },
    });
  }

  /**
   * Fire-and-forget: the response must not wait on the audit write, and an audit failure
   * must never change the status the caller receives.
   */
  private auditDenial(request: Request, requestId: string, status: number, code: string): void {
    void this.denialAuditor?.record(request, requestId, status, code);
  }

  /** 4xx are expected traffic (auth/validation/business-rule denials) and logged at warn; 5xx at error. */
  private logRejection(
    request: Request,
    requestId: string,
    status: number,
    code: string,
    message: string,
  ): void {
    const line = `${request.method} ${request.originalUrl} rejected with ${status} ${code}: ${message}`;
    if (status >= 500) this.logger.error(line, undefined, requestId);
    else this.logger.warn(line, requestId);
  }
}
