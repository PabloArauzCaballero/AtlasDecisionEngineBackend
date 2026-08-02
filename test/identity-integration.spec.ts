import { ConfigService } from '@nestjs/config';
import { DomainException } from '../src/common/errors/domain-exception';
import { mapIdentityRoles } from '../src/common/security/identity-role-mapper';
import { IdentityProviderClient } from '../src/common/security/identity-provider.client';
import { IdentityProviderVerifierService } from '../src/common/security/identity-provider-verifier.service';
import { SessionCookieService } from '../src/modules/identity-session/session-cookie.service';

const identityUser = {
  id: '42',
  tenantId: '7',
  email: 'analyst@example.com',
  fullName: 'Atlas Analyst',
  name: 'Atlas Analyst',
  userCode: null,
  status: 'ACTIVE',
  department: null,
  jobTitle: null,
  mustChangePassword: false,
  mfaEnabled: true,
  roles: [] as string[],
  legacyRoles: [] as string[],
  permissions: [] as string[],
};

describe('external identity integration', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('unwraps the AtlasBackend response envelope during login', async () => {
    const session = {
      accessToken: 'access-token-with-at-least-20-characters',
      refreshToken: 'refresh-token-with-at-least-20-characters',
      tokenType: 'Bearer' as const,
      expiresIn: '1h',
      user: identityUser,
    };
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          requestId: 'request-123',
          data: session,
          timestamp: new Date().toISOString(),
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );
    const client = new IdentityProviderClient(
      new ConfigService({
        IDENTITY_PROVIDER_URL: 'http://localhost:3005/api/v1',
        IDENTITY_PROVIDER_TIMEOUT_MS: 3_000,
      }),
    );

    await expect(
      client.login({
        tenantId: '7',
        email: 'analyst@example.com',
        password: 'valid-password',
      }),
    ).resolves.toEqual(session);
  });

  it('recovers session tokens from the provider login cookies', async () => {
    // The provider issues tokens exclusively as HttpOnly cookies and keeps the body
    // token-free; a session must still be rebuilt from that reply.
    const headers = new Headers({ 'content-type': 'application/json' });
    headers.append(
      'set-cookie',
      'atlas_internal_access=access-token-with-at-least-20-characters; Path=/; HttpOnly; SameSite=Lax',
    );
    headers.append(
      'set-cookie',
      'atlas_internal_refresh=refresh-token-with-at-least-20-characters; Path=/; HttpOnly; SameSite=Lax',
    );
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: { user: identityUser, tokenType: 'Cookie', expiresIn: '15m' },
        }),
        { status: 200, headers },
      ),
    );
    const client = new IdentityProviderClient(
      new ConfigService({
        IDENTITY_PROVIDER_URL: 'http://localhost:3005/api/v1',
        IDENTITY_PROVIDER_TIMEOUT_MS: 3_000,
      }),
    );

    await expect(
      client.login({
        tenantId: '7',
        email: 'analyst@example.com',
        password: 'valid-password',
      }),
    ).resolves.toEqual({
      accessToken: 'access-token-with-at-least-20-characters',
      refreshToken: 'refresh-token-with-at-least-20-characters',
      tokenType: 'Bearer',
      expiresIn: '15m',
      user: identityUser,
    });
  });

  it('reports a token-less provider reply as a contract failure, not a bad credential', async () => {
    // Reporting this as 401 is what let the cookie migration masquerade as every user
    // typing the wrong password.
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: { user: identityUser, tokenType: 'Cookie', expiresIn: '15m' },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const client = new IdentityProviderClient(
      new ConfigService({
        IDENTITY_PROVIDER_URL: 'http://localhost:3005/api/v1',
        IDENTITY_PROVIDER_TIMEOUT_MS: 3_000,
      }),
    );

    await expect(
      client.login({
        tenantId: '7',
        email: 'analyst@example.com',
        password: 'valid-password',
      }),
    ).rejects.toMatchObject({ code: 'IDENTITY_PROVIDER_INVALID_RESPONSE' });
  });

  it('rejects an out-of-range provider tenant as an upstream contract failure', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(
          JSON.stringify({ data: { user: { ...identityUser, tenantId: '9223372036854775808' } } }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    const client = new IdentityProviderClient(
      new ConfigService({
        IDENTITY_PROVIDER_URL: 'http://localhost:3005/api/v1',
        IDENTITY_PROVIDER_TIMEOUT_MS: 3_000,
      }),
    );

    await expect(client.profile('valid-access-token')).rejects.toMatchObject({
      code: 'IDENTITY_PROVIDER_INVALID_RESPONSE',
      status: 502,
    });
  });

  it('surfaces the super admin PIN challenge instead of denying the login', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            pinChallengeRequired: true,
            challengeToken: 'challenge-token',
            expiresInMinutes: 5,
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const client = new IdentityProviderClient(
      new ConfigService({
        IDENTITY_PROVIDER_URL: 'http://localhost:3005/api/v1',
        IDENTITY_PROVIDER_TIMEOUT_MS: 3_000,
      }),
    );

    await expect(
      client.login({
        tenantId: '7',
        email: 'admin@example.com',
        password: 'valid-password',
      }),
    ).rejects.toMatchObject({ code: 'IDENTITY_PIN_CHALLENGE_REQUIRED' });
  });

  it('retries a transient provider outage and then succeeds', async () => {
    // The provider dev server drops the first connection while it is restarting, then answers.
    const session = {
      accessToken: 'access-token-with-at-least-20-characters',
      refreshToken: 'refresh-token-with-at-least-20-characters',
      tokenType: 'Bearer' as const,
      expiresIn: '1h',
      user: identityUser,
    };
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValue(
        new Response(JSON.stringify({ data: session }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    const client = new IdentityProviderClient(
      new ConfigService({
        IDENTITY_PROVIDER_URL: 'http://localhost:3005/api/v1',
        IDENTITY_PROVIDER_TIMEOUT_MS: 3_000,
        IDENTITY_PROVIDER_RETRY_BACKOFF_MS: 0,
      }),
    );

    await expect(
      client.login({
        tenantId: '7',
        email: 'analyst@example.com',
        password: 'valid-password',
      }),
    ).resolves.toEqual(session);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry a rejected credential', async () => {
    // A 401 is a definitive answer: retrying would only burn the account's lockout budget.
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('', { status: 401 }));
    const client = new IdentityProviderClient(
      new ConfigService({
        IDENTITY_PROVIDER_URL: 'http://localhost:3005/api/v1',
        IDENTITY_PROVIDER_TIMEOUT_MS: 3_000,
        IDENTITY_PROVIDER_RETRY_BACKOFF_MS: 0,
      }),
    );

    await expect(
      client.login({
        tenantId: '7',
        email: 'analyst@example.com',
        password: 'wrong-password',
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('surfaces IDENTITY_PROVIDER_UNAVAILABLE after exhausting retries', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new TypeError('fetch failed'));
    const client = new IdentityProviderClient(
      new ConfigService({
        IDENTITY_PROVIDER_URL: 'http://localhost:3005/api/v1',
        IDENTITY_PROVIDER_TIMEOUT_MS: 3_000,
        IDENTITY_PROVIDER_RETRY_ATTEMPTS: 2,
        IDENTITY_PROVIDER_RETRY_BACKOFF_MS: 0,
      }),
    );

    await expect(
      client.login({
        tenantId: '7',
        email: 'analyst@example.com',
        password: 'valid-password',
      }),
    ).rejects.toMatchObject({ code: 'IDENTITY_PROVIDER_UNAVAILABLE' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('maps provider roles to the least-privilege Decision Engine roles', () => {
    expect(mapIdentityRoles(['qa_engineer', 'READONLY_AUDITOR', 'unknown'])).toEqual([
      'QA_ANALYST',
      'AUDITOR',
    ]);
  });

  it('verifies provider state remotely and maps the principal', async () => {
    const profile = jest.fn().mockResolvedValue({
      user: { ...identityUser, roles: ['COMPLIANCE_ANALYST'] },
    });
    const verifier = new IdentityProviderVerifierService({
      profile,
    } as unknown as IdentityProviderClient);

    await expect(verifier.verify('valid-access-token')).resolves.toEqual({
      subject: '42',
      tenantId: 7n,
      roles: ['COMPLIANCE'],
    });
    expect(profile).toHaveBeenCalledWith('valid-access-token');
  });

  it('rejects a valid provider identity without a Decision Engine role', async () => {
    const profile = jest.fn().mockResolvedValue({ user: identityUser });
    const verifier = new IdentityProviderVerifierService({
      profile,
    } as unknown as IdentityProviderClient);

    await expect(verifier.verify('valid-access-token')).rejects.toMatchObject<
      Partial<DomainException>
    >({
      code: 'FORBIDDEN',
      status: 403,
    });
  });

  it('keeps refresh tokens in a secure production cookie', () => {
    const cookies = new SessionCookieService(
      new ConfigService({
        NODE_ENV: 'production',
        IDENTITY_REFRESH_COOKIE_NAME: 'atlas_refresh',
        IDENTITY_REFRESH_COOKIE_MAX_AGE_SECONDS: 900,
      }),
    );
    const serialized = cookies.serialize('refresh/with special chars');

    expect(serialized).toContain('HttpOnly');
    expect(serialized).toContain('SameSite=Strict');
    expect(serialized).toContain('Secure');
    expect(serialized).toContain('Path=/v1/session');
    expect(serialized).not.toContain('refresh/with special chars');
    expect(cookies.read(serialized)).toBe('refresh/with special chars');
  });
});
