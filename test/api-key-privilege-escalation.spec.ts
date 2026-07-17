import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { AuthenticationGuard } from '../src/common/security/authentication.guard';
import { RequestContextService } from '../src/common/context/request-context.service';
import type { CacheService } from '../src/common/cache/cache.service';
import type { JwtVerifierService } from '../src/common/security/jwt-verifier.service';
import type { IdentityProviderVerifierService } from '../src/common/security/identity-provider-verifier.service';
import type {
  IntegrationClientService,
  ResolvedIntegrationClient,
} from '../src/common/security/integration-client.service';

/**
 * Security regression: a caller holding an API key must never be able to choose its
 * own tenant or roles. AUTH_MODE=HYBRID is the case that matters, since env.schema.ts
 * only bans plain API_KEY in production — HYBRID is production-legal and still falls
 * through to the API key path whenever no bearer token is sent.
 */
describe('AuthenticationGuard API key privilege escalation', () => {
  const API_KEY = 'integration-key-with-enough-entropy-0123456789';

  // The registry entry a well-behaved caller is entitled to: one tenant, one role.
  const registered: ResolvedIntegrationClient = {
    clientKey: 'billing-integration',
    roles: ['DECISION_CONSUMER'],
    tenantIds: [7n],
  };

  function guard(client: ResolvedIntegrationClient = registered): AuthenticationGuard {
    const config = new ConfigService({
      AUTH_MODE: 'HYBRID',
      RATE_LIMIT_ENABLED: false,
    });
    const cache = {
      consumeFixedWindow: jest.fn(async () => ({ count: 1, ttlSeconds: 60 })),
    } as unknown as CacheService;
    const integrationClients = {
      resolve: jest.fn(async (secret: string) => {
        if (secret !== API_KEY) throw new Error('Invalid API key');
        return client;
      }),
    } as unknown as IntegrationClientService;

    return new AuthenticationGuard(
      new Reflector(),
      config,
      integrationClients,
      { verify: jest.fn() } as unknown as JwtVerifierService,
      { verify: jest.fn() } as unknown as IdentityProviderVerifierService,
      new RequestContextService(),
      cache,
    );
  }

  function context(headers: Record<string, string>): {
    ctx: ExecutionContext;
    request: Record<string, unknown>;
  } {
    const request: Record<string, unknown> = {
      headers,
      ip: '203.0.113.10',
      socket: { remoteAddress: '203.0.113.10' },
    };
    return {
      request,
      ctx: {
        switchToHttp: () => ({ getRequest: () => request }),
        getHandler: () => function handler() {},
        getClass: () => class Controller {},
      } as unknown as ExecutionContext,
    };
  }

  it('ignores roles declared by the caller through x-roles', async () => {
    const { ctx, request } = context({
      'x-api-key': API_KEY,
      'x-principal-id': 'attacker',
      'x-tenant-id': '7',
      'x-roles': 'ADMIN,APPROVER,RELEASE_MANAGER',
    });

    await expect(guard().canActivate(ctx)).resolves.toBe(true);

    // The registry's scopes win; nothing the caller asked for survives.
    expect(request.principal).toMatchObject({
      id: 'billing-integration',
      roles: ['DECISION_CONSUMER'],
      tenantId: 7n,
    });
  });

  it('rejects a tenant the credential is not authorised for', async () => {
    const { ctx } = context({
      'x-api-key': API_KEY,
      'x-tenant-id': '999999',
    });

    await expect(guard().canActivate(ctx)).rejects.toMatchObject({
      code: 'FORBIDDEN_TENANT',
    });
  });

  it('ignores x-principal-id and identifies the caller by its registered client key', async () => {
    const { ctx, request } = context({
      'x-api-key': API_KEY,
      'x-principal-id': 'someone-else',
    });

    await expect(guard().canActivate(ctx)).resolves.toBe(true);
    expect(request.principal).toMatchObject({ id: 'billing-integration' });
  });

  it('infers the tenant for a single-tenant client without any header', async () => {
    const { ctx, request } = context({ 'x-api-key': API_KEY });

    await expect(guard().canActivate(ctx)).resolves.toBe(true);
    expect(request.principal).toMatchObject({ tenantId: 7n });
  });

  it('requires an explicit tenant when the client spans several tenants', async () => {
    const multi: ResolvedIntegrationClient = { ...registered, tenantIds: [7n, 8n] };
    const { ctx } = context({ 'x-api-key': API_KEY });

    await expect(guard(multi).canActivate(ctx)).rejects.toMatchObject({
      code: 'INVALID_SECURITY_CONTEXT',
    });
  });

  it('allows a multi-tenant client to select any tenant it is authorised for', async () => {
    const multi: ResolvedIntegrationClient = { ...registered, tenantIds: [7n, 8n] };
    const { ctx, request } = context({ 'x-api-key': API_KEY, 'x-tenant-id': '8' });

    await expect(guard(multi).canActivate(ctx)).resolves.toBe(true);
    expect(request.principal).toMatchObject({ tenantId: 8n });
  });

  it('rejects a request with no API key at all', async () => {
    const { ctx } = context({ 'x-tenant-id': '7', 'x-roles': 'ADMIN' });

    await expect(guard().canActivate(ctx)).rejects.toThrow();
  });
});
