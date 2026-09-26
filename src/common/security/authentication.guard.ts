import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import { CacheService } from '../cache/cache.service';
import { RequestContextService } from '../context/request-context.service';
import { DomainException } from '../errors/domain-exception';
import { PUBLIC_ROUTE, REQUIRED_AUDIENCE } from './security.decorators';
import type { ApiAudience, AuthenticatedPrincipal } from './security.types';
import { JwtVerifierService } from './jwt-verifier.service';
import { IdentityProviderVerifierService } from './identity-provider-verifier.service';
import { IntegrationClientService } from './integration-client.service';

/**
 * Establishes the trusted principal for every protected request.
 *
 * JWT and identity-provider modes derive authority from verified claims. API key modes
 * derive identity, roles and tenant access exclusively from the integration client registry.
 */
@Injectable()
export class AuthenticationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
    private readonly integrationClients: IntegrationClientService,
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
    const audience =
      this.reflector.getAllAndOverride<ApiAudience>(REQUIRED_AUDIENCE, [
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

  private async authenticate(
    request: Request,
    audience: ApiAudience,
  ): Promise<AuthenticatedPrincipal> {
    const mode = this.config.get<string>('AUTH_MODE') ?? 'API_KEY';
    const bearer = this.bearerToken(request);

    if (bearer && (mode === 'IDENTITY_PROVIDER' || mode === 'IDENTITY_HYBRID')) {
      if (audience === 'runtime') {
        throw new DomainException(
          'RUNTIME_CREDENTIAL_REQUIRED',
          'Runtime routes require a credential with a verifiable runtime audience',
          HttpStatus.UNAUTHORIZED,
        );
      }
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
    const result = await this.cache.consumeFixedWindow(
      `auth-fail:${this.clientIp(request)}`,
      windowSeconds,
    );
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

  /**
   * Identity comes from the integration client registry, never from headers. The
   * caller may still send x-tenant-id, but only to select among the tenants its
   * credential is already authorised for — it can never introduce a new one, and
   * roles are not caller-supplied at all.
   */
  private async authenticateApiKey(
    request: Request,
    audience: ApiAudience,
  ): Promise<AuthenticatedPrincipal> {
    const apiKey = this.header(request, 'x-api-key');
    if (!apiKey) {
      throw new DomainException('UNAUTHORIZED', 'Invalid API key', HttpStatus.UNAUTHORIZED);
    }
    const client = await this.integrationClients.resolve(apiKey, audience);
    return {
      id: client.clientKey,
      tenantId: this.resolveTenant(request, client.tenantIds),
      roles: client.roles,
      audience,
      requestId: this.requestId(request),
      authMethod: 'api_key',
    };
  }

  private resolveTenant(request: Request, allowed: bigint[]): bigint {
    const requested = this.header(request, 'x-tenant-id');
    if (!requested) {
      // Selecting a tenant implicitly is only unambiguous for single-tenant clients.
      if (allowed.length === 1) return allowed[0];
      throw new DomainException(
        'INVALID_SECURITY_CONTEXT',
        'x-tenant-id is required for clients authorised on multiple tenants',
        HttpStatus.UNAUTHORIZED,
      );
    }
    if (!/^[1-9]\d*$/.test(requested)) {
      throw new DomainException(
        'INVALID_SECURITY_CONTEXT',
        'x-tenant-id must be a positive integer',
        HttpStatus.UNAUTHORIZED,
      );
    }
    const tenantId = BigInt(requested);
    if (!allowed.some((candidate) => candidate === tenantId)) {
      throw new DomainException(
        'FORBIDDEN_TENANT',
        'Client is not authorised for the requested tenant',
        HttpStatus.FORBIDDEN,
      );
    }
    return tenantId;
  }

  private bearerToken(request: Request): string | undefined {
    const authorization = this.header(request, 'authorization');
    if (!authorization) return undefined;
    const [scheme, token, ...rest] = authorization.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token || rest.length) {
      throw new DomainException(
        'UNAUTHORIZED',
        'Malformed Authorization header',
        HttpStatus.UNAUTHORIZED,
      );
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
