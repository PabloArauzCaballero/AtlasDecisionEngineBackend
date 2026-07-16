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
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      requestId: 'request-123',
      data: session,
      timestamp: new Date().toISOString(),
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    const client = new IdentityProviderClient(new ConfigService({
      IDENTITY_PROVIDER_URL: 'http://localhost:3005/api/v1',
      IDENTITY_PROVIDER_TIMEOUT_MS: 3_000,
    }));

    await expect(client.login({
      tenantId: '7',
      email: 'analyst@example.com',
      password: 'valid-password',
    })).resolves.toEqual(session);
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
    const verifier = new IdentityProviderVerifierService({ profile } as unknown as IdentityProviderClient);

    await expect(verifier.verify('valid-access-token')).resolves.toEqual({
      subject: '42',
      tenantId: 7n,
      roles: ['COMPLIANCE'],
    });
    expect(profile).toHaveBeenCalledWith('valid-access-token');
  });

  it('rejects a valid provider identity without a Decision Engine role', async () => {
    const profile = jest.fn().mockResolvedValue({ user: identityUser });
    const verifier = new IdentityProviderVerifierService({ profile } as unknown as IdentityProviderClient);

    await expect(verifier.verify('valid-access-token')).rejects.toMatchObject<Partial<DomainException>>({
      code: 'FORBIDDEN',
      status: 403,
    });
  });

  it('keeps refresh tokens in a secure production cookie', () => {
    const cookies = new SessionCookieService(new ConfigService({
      NODE_ENV: 'production',
      IDENTITY_REFRESH_COOKIE_NAME: 'atlas_refresh',
      IDENTITY_REFRESH_COOKIE_MAX_AGE_SECONDS: 900,
    }));
    const serialized = cookies.serialize('refresh/with special chars');

    expect(serialized).toContain('HttpOnly');
    expect(serialized).toContain('SameSite=Strict');
    expect(serialized).toContain('Secure');
    expect(serialized).toContain('Path=/v1/session');
    expect(serialized).not.toContain('refresh/with special chars');
    expect(cookies.read(serialized)).toBe('refresh/with special chars');
  });
});
