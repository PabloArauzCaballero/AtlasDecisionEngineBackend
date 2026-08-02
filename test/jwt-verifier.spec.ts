import { ConfigService } from '@nestjs/config';
import { generateKeyPairSync, sign } from 'node:crypto';
import { JwtVerifierService } from '../src/common/security/jwt-verifier.service';

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

describe('JwtVerifierService', () => {
  const issuer = 'https://identity.atlas.example';
  const audience = 'atlas-decision-management';
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = jest.fn(
      async () =>
        new Response(
          JSON.stringify({
            keys: [{ ...jwk, kid: 'atlas-key-1', alg: 'RS256', use: 'sig' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    ) as typeof fetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  function service(): JwtVerifierService {
    return new JwtVerifierService(
      new ConfigService({
        JWT_JWKS_URL: 'https://identity.atlas.example/.well-known/jwks.json',
        JWT_ISSUER: issuer,
        JWT_MANAGEMENT_AUDIENCE: audience,
        JWT_RUNTIME_AUDIENCE: 'atlas-decision-runtime',
        JWT_TENANT_CLAIM: 'tenant_id',
        JWT_ROLES_CLAIM: 'roles',
        JWT_JWKS_CACHE_SECONDS: 900,
        JWT_JWKS_TIMEOUT_MS: 3000,
        JWT_CLOCK_SKEW_SECONDS: 0,
      }),
    );
  }

  function token(overrides: Record<string, unknown> = {}): string {
    const now = Math.floor(Date.now() / 1000);
    const header = encode({ alg: 'RS256', typ: 'JWT', kid: 'atlas-key-1' });
    const payload = encode({
      sub: 'risk-user-1',
      iss: issuer,
      aud: audience,
      exp: now + 300,
      iat: now,
      tenant_id: '42',
      roles: ['risk_analyst', 'auditor'],
      ...overrides,
    });
    const signature = sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), privateKey).toString(
      'base64url',
    );
    return `${header}.${payload}.${signature}`;
  }

  it('validates signature and extracts normalized tenant/roles', async () => {
    const principal = await service().verify(token(), 'management');
    expect(principal).toEqual({
      subject: 'risk-user-1',
      tenantId: 42n,
      roles: ['RISK_ANALYST', 'AUDITOR'],
      tokenId: undefined,
    });
  });

  it('rejects a token for the wrong audience', async () => {
    await expect(
      service().verify(token({ aud: 'another-service' }), 'management'),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED', status: 401 });
  });

  it('rejects an expired token', async () => {
    const now = Math.floor(Date.now() / 1000);
    await expect(
      service().verify(token({ exp: now - 1, iat: now - 300 }), 'management'),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED', status: 401 });
  });

  it('rejects a tenant claim outside the database identifier range', async () => {
    await expect(
      service().verify(token({ tenant_id: '9223372036854775808' }), 'management'),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED', status: 401 });
  });
});
