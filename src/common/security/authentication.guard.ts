import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import { CacheService } from '../cache/cache.service';
import { RequestContextService } from '../context/request-context.service';
import { HashService } from '../crypto/hash.service';
import { DomainException } from '../errors/domain-exception';
import { PUBLIC_ROUTE, REQUIRED_AUDIENCE } from './security.decorators';
import type { ApiAudience, AuthenticatedPrincipal } from './security.types';
import { JwtVerifierService } from './jwt-verifier.service';
import { IdentityProviderVerifierService } from './identity-provider-verifier.service';

@Injectable()
export class AuthenticationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
    private readonly hashes: HashService,
    private readonly jwt: JwtVerifierService,
    private readonly identityProvider: IdentityProviderVerifierService,
    private readonly requestContext: RequestContextService,
    private readonly cache: CacheService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const audience = this.reflector.getAllAndOverride<ApiAudience>(REQUIRED_AUDIENCE, [
      context.getHandler(),
      context.getClass(),
    ]) ?? 'management';

    try {
      request.principal = await this.authenticate(request, audience);
    } catch (error) {
      await this.enforceFailureRateLimit(request);
      throw error;
    }
    this.requestContext.enrich({
      tenantId: request.principal.tenantId.toString(),
      principalId: request.principal.id,
      audience: request.principal.audience,
      authMethod: request.principal.authMethod,
    });
    return true;
  }

  private async authenticate(request: Request, audience: ApiAudience): Promise<AuthenticatedPrincipal> {
    const mode = this.config.get<string>('AUTH_MODE') ?? 'API_KEY';
    const bearer = this.bearerToken(request);

    if (bearer && (mode === 'IDENTITY_PROVIDER' || mode === 'IDENTITY_HYBRID')) {
      const verified = await this.identityProvider.verify(bearer);
      return {
        id: verified.subject,
        tenantId: verified.tenantId,
        roles: verified.roles,
        audience,
        requestId: this.requestId(request),
        authMethod: 'identity_provider',
      };
    }
    if (bearer && (mode === 'JWT' || mode === 'HYBRID')) {
      const verified = await this.jwt.verify(bearer, audience);
      return {
        id: verified.subject,
        tenantId: verified.tenantId,
        roles: verified.roles,
        audience,
        requestId: this.requestId(request),
        authMethod: 'jwt',
        tokenId: verified.tokenId,
      };
    }
    if (mode === 'API_KEY' || mode === 'HYBRID' || mode === 'IDENTITY_HYBRID') {
      return this.authenticateApiKey(request, audience);
    }
    throw new DomainException('UNAUTHORIZED', 'Bearer token is required', HttpStatus.UNAUTHORIZED);
  }

  /**
   * Guards short-circuit on the first failure, so a bad credential never reaches
   * RateLimitGuard (registered after this one) and failed attempts would otherwise
   * be completely unthrottled. Only failures consume this budget, so legitimate
   * traffic never competes with it; each failure beyond the limit is answered with
   * 429 instead of leaking further into credential validation.
   */
  private async enforceFailureRateLimit(request: Request): Promise<void> {
    if (!(this.config.get<boolean>('RATE_LIMIT_ENABLED') ?? true)) return;
    const windowSeconds = this.config.get<number>('RATE_LIMIT_WINDOW_SECONDS') ?? 60;
    const limit = this.config.get<number>('AUTH_FAILURE_RATE_LIMIT') ?? 20;
    const result = await this.cache.consumeFixedWindow(`auth-fail:${this.clientIp(request)}`, windowSeconds);
    if (result.count > limit) {
      throw new DomainException(
        'AUTH_RATE_LIMIT_EXCEEDED',
        'Too many failed authentication attempts',
        HttpStatus.TOO_MANY_REQUESTS,
        { retryAfterSeconds: result.ttlSeconds },
      );
    }
  }

  private clientIp(request: Request): string {
    return request.ip ?? request.socket?.remoteAddress ?? 'unknown';
  }

  private authenticateApiKey(request: Request, audience: ApiAudience): AuthenticatedPrincipal {
    const apiKey = this.header(request, 'x-api-key');
    const expected = this.config.get<string>(
      audience === 'runtime' ? 'RUNTIME_API_KEY' : 'MANAGEMENT_API_KEY',
    );
    const valid = Boolean(apiKey && expected) && this.hashes.equals(
      this.hashes.sha256(apiKey as string),
      this.hashes.sha256(expected as string),
    );
    if (!valid) throw new DomainException('UNAUTHORIZED', 'Invalid API key', HttpStatus.UNAUTHORIZED);

    const principalId = this.header(request, 'x-principal-id');
    const tenantHeader = this.header(request, 'x-tenant-id');
    if (!principalId || !tenantHeader || !/^[1-9]\d*$/.test(tenantHeader)) {
      throw new DomainException(
        'INVALID_SECURITY_CONTEXT',
        'x-principal-id and a positive numeric x-tenant-id are required for API key authentication',
        HttpStatus.UNAUTHORIZED,
      );
    }
    const roles = (this.header(request, 'x-roles') ?? '')
      .split(',')
      .map((role) => role.trim().toUpperCase())
      .filter(Boolean);
    return {
      id: principalId.slice(0, 160),
      tenantId: BigInt(tenantHeader),
      roles: [...new Set(roles)],
      audience,
      requestId: this.requestId(request),
      authMethod: 'api_key',
    };
  }

  private bearerToken(request: Request): string | undefined {
    const authorization = this.header(request, 'authorization');
    if (!authorization) return undefined;
    const [scheme, token, ...rest] = authorization.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token || rest.length) {
      throw new DomainException('UNAUTHORIZED', 'Malformed Authorization header', HttpStatus.UNAUTHORIZED);
    }
    return token;
  }

  private requestId(request: Request): string {
    return this.header(request, 'x-request-id') ?? randomUUID();
  }

  private header(request: Request, name: string): string | undefined {
    const value = request.headers[name];
    return Array.isArray(value) ? value[0] : value;
  }
}
