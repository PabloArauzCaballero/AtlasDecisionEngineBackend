/** Applies a stricter IP budget to public login/refresh/logout routes before provider calls. */
import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { CacheService } from '../../common/cache/cache.service';
import { DomainException } from '../../common/errors/domain-exception';

@Injectable()
export class SessionRateLimitGuard implements CanActivate {
  constructor(
    private readonly config: ConfigService,
    private readonly cache: CacheService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!(this.config.get<boolean>('RATE_LIMIT_ENABLED') ?? true)) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const windowSeconds = this.config.get<number>('RATE_LIMIT_WINDOW_SECONDS') ?? 60;
    const limit = this.config.get<number>('IDENTITY_SESSION_RATE_LIMIT') ?? 20;
    const route = context.getHandler().name;
    const result = await this.cache.consumeFixedWindow(
      `identity-session:${request.ip ?? request.socket.remoteAddress ?? 'unknown'}:${route}`,
      windowSeconds,
    );

    response.setHeader('x-ratelimit-limit', String(limit));
    response.setHeader('x-ratelimit-remaining', String(Math.max(0, limit - result.count)));
    response.setHeader(
      'x-ratelimit-reset',
      String(Math.ceil(Date.now() / 1_000) + result.ttlSeconds),
    );
    if (result.count <= limit) return true;

    response.setHeader('retry-after', String(result.ttlSeconds));
    throw new DomainException(
      'RATE_LIMIT_EXCEEDED',
      'Too many session requests',
      HttpStatus.TOO_MANY_REQUESTS,
      { retryAfterSeconds: result.ttlSeconds },
    );
  }
}
