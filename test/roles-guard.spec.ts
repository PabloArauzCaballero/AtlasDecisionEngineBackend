import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { RolesGuard } from '../src/common/security/roles.guard';
import type { AuthenticatedPrincipal, AuthMethod } from '../src/common/security/security.types';

/**
 * PLATFORM_ADMIN is a global wildcard, so it may only be honoured when it
 * arrives on a signed token — never when it was granted to an API key.
 */
describe('RolesGuard PLATFORM_ADMIN wildcard', () => {
  function context(
    principal: AuthenticatedPrincipal | undefined,
    required: string[],
  ): ExecutionContext {
    const reflector = new Reflector();
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(required);
    const request: Record<string, unknown> = { principal };
    return {
      _reflector: reflector,
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => function handler() {},
      getClass: () => class Controller {},
    } as unknown as ExecutionContext & { _reflector: Reflector };
  }

  function guardFor(ctx: ExecutionContext): RolesGuard {
    return new RolesGuard((ctx as unknown as { _reflector: Reflector })._reflector);
  }

  function principal(roles: string[], authMethod: AuthMethod): AuthenticatedPrincipal {
    return { id: 'c', tenantId: 1n, roles, audience: 'management', requestId: 'r', authMethod };
  }

  it('honours PLATFORM_ADMIN from a JWT for any required role', () => {
    const ctx = context(principal(['PLATFORM_ADMIN'], 'jwt'), ['RISK_ANALYST']);
    expect(guardFor(ctx).canActivate(ctx)).toBe(true);
  });

  it('honours PLATFORM_ADMIN from the identity provider', () => {
    const ctx = context(principal(['PLATFORM_ADMIN'], 'identity_provider'), ['AUDITOR']);
    expect(guardFor(ctx).canActivate(ctx)).toBe(true);
  });

  it('refuses PLATFORM_ADMIN granted to an API key', () => {
    const ctx = context(principal(['PLATFORM_ADMIN'], 'api_key'), ['RISK_ANALYST']);
    expect(() => guardFor(ctx).canActivate(ctx)).toThrow();
  });

  it('still allows an API key that holds the specific required role', () => {
    const ctx = context(principal(['RISK_ANALYST'], 'api_key'), ['RISK_ANALYST']);
    expect(guardFor(ctx).canActivate(ctx)).toBe(true);
  });
});
