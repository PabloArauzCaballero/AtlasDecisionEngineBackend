import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import { CacheService } from '../cache/cache.service';
import { DomainException } from '../errors/domain-exception';
import { PUBLIC_ROUTE, SKIP_RATE_LIMIT } from './security.decorators';

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
    private readonly cache: CacheService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!(this.config.get<boolean>('RATE_LIMIT_ENABLED') ?? true)) return true;
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_RATE_LIMIT, [
      context.getHandler(),
      context.getClass(),
    ]);
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip || isPublic) return true;

    const request = context.switchToHttp().getRequest<Express.Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const principal = request.principal;
    if (!principal) return true;
    const windowSeconds = this.config.get<number>('RATE_LIMIT_WINDOW_SECONDS') ?? 60;
    const limit = this.config.get<number>(
      principal.audience === 'runtime'
        ? 'RATE_LIMIT_RUNTIME_REQUESTS'
        : 'RATE_LIMIT_MANAGEMENT_REQUESTS',
    ) ?? 300;
    const route = `${context.getClass().name}.${context.getHandler().name}`;
    const result = await this.cache.consumeFixedWindow(
      `rate:${principal.audience}:${principal.tenantId}:${principal.id}:${route}`,
      windowSeconds,
    );
    response.setHeader('x-ratelimit-limit', String(limit));
    response.setHeader('x-ratelimit-remaining', String(Math.max(0, limit - result.count)));
    response.setHeader('x-ratelimit-reset', String(Math.ceil(Date.now() / 1_000) + result.ttlSeconds));
    if (result.count > limit) {
      response.setHeader('retry-after', String(result.ttlSeconds));
      throw new DomainException(
        'RATE_LIMIT_EXCEEDED',
        'Too many requests',
        HttpStatus.TOO_MANY_REQUESTS,
        { retryAfterSeconds: result.ttlSeconds },
      );
    }
    return true;
  }
}
