import {
  CallHandler,
  ExecutionContext,
  HttpStatus,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Observable, TimeoutError, catchError, throwError, timeout } from 'rxjs';
import { DomainException } from '../errors/domain-exception';

@Injectable()
export class RequestTimeoutInterceptor implements NestInterceptor {
  private readonly timeoutMs: number;

  constructor(config: ConfigService) {
    this.timeoutMs = config.get<number>('REQUEST_TIMEOUT_MS') ?? 15_000;
  }

  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      timeout(this.timeoutMs),
      catchError((error: unknown) => {
        if (error instanceof TimeoutError) {
          return throwError(
            () =>
              new DomainException(
                'REQUEST_TIMEOUT',
                `Request exceeded ${this.timeoutMs} ms`,
                HttpStatus.GATEWAY_TIMEOUT,
              ),
          );
        }
        return throwError(() => error);
      }),
    );
  }
}
