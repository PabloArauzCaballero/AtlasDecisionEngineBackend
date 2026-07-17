import type { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Reflector } from '@nestjs/core';
import type { CacheService } from '../src/common/cache/cache.service';
import { RequestContextService } from '../src/common/context/request-context.service';
import { AuthenticationGuard } from '../src/common/security/authentication.guard';
import type { IdentityProviderVerifierService } from '../src/common/security/identity-provider-verifier.service';
import type { IntegrationClientService } from '../src/common/security/integration-client.service';
import type { JwtVerifierService } from '../src/common/security/jwt-verifier.service';
import { REQUIRED_AUDIENCE } from '../src/common/security/security.decorators';

describe('AuthenticationGuard identity-provider audience isolation', () => {
  it('does not promote a management bearer token to the runtime audience', async () => {
    const reflector = {
      getAllAndOverride: jest.fn((key: string) =>
        key === REQUIRED_AUDIENCE ? 'runtime' : undefined,
      ),
    } as unknown as Reflector;
    const identityProvider = {
      verify: jest.fn().mockResolvedValue({
        subject: 'qa-user',
        tenantId: 7n,
        roles: ['QA_ANALYST'],
      }),
    };
    const guard = new AuthenticationGuard(
      reflector,
      new ConfigService({
        AUTH_MODE: 'IDENTITY_PROVIDER',
        RATE_LIMIT_ENABLED: false,
      }),
      {} as IntegrationClientService,
      {} as JwtVerifierService,
      identityProvider as unknown as IdentityProviderVerifierService,
      new RequestContextService(),
      {} as CacheService,
    );
    const request = {
      headers: { authorization: 'Bearer identity-provider-access-token' },
      ip: '127.0.0.1',
      socket: { remoteAddress: '127.0.0.1' },
    };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => function handler() {},
      getClass: () => class Controller {},
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      code: 'RUNTIME_CREDENTIAL_REQUIRED',
      status: 401,
    });
    expect(identityProvider.verify).not.toHaveBeenCalled();
  });
});
