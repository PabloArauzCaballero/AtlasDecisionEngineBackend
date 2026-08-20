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

  it('returns the second-factor challenge as an outcome, not as a failure', async () => {
    const challenge = {
      pinChallengeRequired: true,
      challengeToken: 'challenge-token',
      expiresInMinutes: 5,
    };
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: challenge }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const client = new IdentityProviderClient(
      new ConfigService({
        IDENTITY_PROVIDER_URL: 'http://localhost:3005/api/v1',
        IDENTITY_PROVIDER_TIMEOUT_MS: 3_000,
      }),
    );

    // This used to be a 501. The consequence was backwards: a deployment that enforced the second
    // factor could not sign anyone into the portal, while one without a mail channel — and therefore
    // without a second factor — worked perfectly.
    await expect(
      client.login({
        tenantId: '7',
        email: 'admin@example.com',
        password: 'valid-password',
      }),
    ).resolves.toEqual(challenge);
  });

  it('exchanges the challenge token and PIN for a session with its cookies', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ data: { user: identityUser, tokenType: 'Cookie', expiresIn: '900' } }),
        {
          status: 200,
          headers: [
            ['content-type', 'application/json'],
            ['set-cookie', 'atlas_internal_access=access-token-value-long-enough; HttpOnly'],
            ['set-cookie', 'atlas_internal_refresh=refresh-token-value-long-enough; HttpOnly'],
          ],
        },
      ),
    );
    const client = new IdentityProviderClient(
      new ConfigService({
        IDENTITY_PROVIDER_URL: 'http://localhost:3005/api/v1',
        IDENTITY_PROVIDER_TIMEOUT_MS: 3_000,
      }),
    );

    const session = await client.verifyLoginPin({
      challengeToken: 'challenge-token',
      pin: '123456',
    });

    expect(session.accessToken).toBe('access-token-value-long-enough');
    expect(session.refreshToken).toBe('refresh-token-value-long-enough');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:3005/api/v1/internal/auth/login/pin');
    // No tenant header: the challenge already names the actor, and asserting a tenant here would
    // let the caller claim one it never authenticated against.
    expect(init.headers).not.toHaveProperty('x-tenant-id');
  });

  it('retries a transient provider outage and then succeeds', async () => {
    /*
     * The provider dev server REFUSES the connection while it is restarting, then answers. The
     * `cause` matters: it is what distinguishes "nothing was ever sent" from "we stopped
     * waiting". A timeout is not retried, because the provider may have already mailed a PIN.
     */
    const session = {
      accessToken: 'access-token-with-at-least-20-characters',
      refreshToken: 'refresh-token-with-at-least-20-characters',
      tokenType: 'Bearer' as const,
      expiresIn: '1h',
      user: identityUser,
    };
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(
        Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }),
      )
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
      .mockRejectedValue(
        Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }),
      );
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

  /** Config stub for the verifier: only the cache window is read from it. */
  const cacheTtl = (seconds: number) => ({ get: () => seconds }) as unknown as ConfigService;

  it('verifies provider state remotely and maps the principal', async () => {
    const profile = jest.fn().mockResolvedValue({
      user: { ...identityUser, roles: ['COMPLIANCE_ANALYST'] },
    });
    const verifier = new IdentityProviderVerifierService(
      { profile } as unknown as IdentityProviderClient,
      cacheTtl(0),
    );

    await expect(verifier.verify('valid-access-token')).resolves.toEqual({
      subject: '42',
      tenantId: 7n,
      roles: ['COMPLIANCE'],
    });
    expect(profile).toHaveBeenCalledWith('valid-access-token');
  });

  it('rejects a valid provider identity without a Decision Engine role', async () => {
    const profile = jest.fn().mockResolvedValue({ user: identityUser });
    const verifier = new IdentityProviderVerifierService(
      { profile } as unknown as IdentityProviderClient,
      cacheTtl(0),
    );

    await expect(verifier.verify('valid-access-token')).rejects.toMatchObject<
      Partial<DomainException>
    >({
      code: 'FORBIDDEN',
      status: 403,
    });
  });

  /*
   * The cache exists because every protected request revalidated the token
   * against the provider. One portal screen fires a dozen requests, so a dozen
   * validations; a bank statement being classified fires hundreds. The provider
   * hit its 3 s timeout and the engine answered 503 on requests at random —
   * measured: six of six classifications failed with "Identity provider is
   * unavailable" while the provider itself answered a direct probe in 12 ms.
   */
  it('reuses a verified token inside the cache window instead of asking again', async () => {
    const profile = jest.fn().mockResolvedValue({
      user: { ...identityUser, roles: ['COMPLIANCE_ANALYST'] },
    });
    const verifier = new IdentityProviderVerifierService(
      { profile } as unknown as IdentityProviderClient,
      cacheTtl(60),
    );

    const first = await verifier.verify('same-token');
    const second = await verifier.verify('same-token');

    expect(second).toEqual(first);
    expect(profile).toHaveBeenCalledTimes(1);

    // Otro token es otra sesión: no puede resolverse con la entrada del primero.
    await verifier.verify('other-token');
    expect(profile).toHaveBeenCalledTimes(2);
  });

  /*
   * Devolver el objeto guardado dejaría que quien lo recibe se añadiera un rol
   * y que la siguiente petición con el mismo token lo heredara: una escalada de
   * privilegios servida por la caché.
   */
  it('hands out a copy, so a caller cannot grow the cached role list', async () => {
    const profile = jest.fn().mockResolvedValue({
      user: { ...identityUser, roles: ['COMPLIANCE_ANALYST'] },
    });
    const verifier = new IdentityProviderVerifierService(
      { profile } as unknown as IdentityProviderClient,
      cacheTtl(60),
    );

    (await verifier.verify('same-token')).roles.push('PLATFORM_ADMIN');

    await expect(verifier.verify('same-token')).resolves.toEqual({
      subject: '42',
      tenantId: 7n,
      roles: ['COMPLIANCE'],
    });
  });

  /*
   * Un rechazo NO se guarda, en las dos direcciones: un 503 guardado alargaría
   * la caída del proveedor más allá de la caída, y un 401 guardado seguiría
   * rechazando un token que acaba de volverse válido.
   */
  it('does not cache a rejection', async () => {
    const profile = jest
      .fn()
      .mockRejectedValueOnce(new Error('provider down'))
      .mockResolvedValue({ user: { ...identityUser, roles: ['COMPLIANCE_ANALYST'] } });
    const verifier = new IdentityProviderVerifierService(
      { profile } as unknown as IdentityProviderClient,
      cacheTtl(60),
    );

    await expect(verifier.verify('same-token')).rejects.toThrow('provider down');
    await expect(verifier.verify('same-token')).resolves.toMatchObject({ subject: '42' });
    expect(profile).toHaveBeenCalledTimes(2);
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

  /**
   * Un tenant o un usuario que no existen NO son una avería del proveedor.
   *
   * El proveedor responde 409 a un `x-tenant-id` desconocido y 404 a un usuario
   * que no está, y el cliente los mandaba a `502 IDENTITY_PROVIDER_ERROR`. Dos
   * cosas iban mal a la vez: operativamente un 502 significa «el proveedor está
   * caído» y dispara reintentos, alertas y guardia por lo que en realidad es un
   * dedazo en la casilla del tenant; y hacia fuera era un oráculo de
   * enumeración, porque una contraseña mala respondía 401 y un tenant malo 502,
   * de modo que comparando las dos respuestas se averiguaba qué tenants existen.
   *
   * Se prueban los cuatro códigos juntos para fijar la propiedad que importa:
   * **todos producen la MISMA respuesta opaca**.
   */
  it.each([401, 403, 404, 409])(
    'trata el %i del proveedor como credencial rechazada, no como avería',
    async (status) => {
      jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response('{"error":{"code":"WHATEVER"}}', { status }));
      const client = new IdentityProviderClient(
        new ConfigService({
          IDENTITY_PROVIDER_URL: 'http://localhost:3005/api/v1',
          IDENTITY_PROVIDER_TIMEOUT_MS: 3_000,
          IDENTITY_PROVIDER_RETRY_ATTEMPTS: 0,
        }),
      );

      const fallo = await client
        .login({ tenantId: '999999', email: 'analyst@example.com', password: 'valid-password' })
        .catch((error: unknown) => error as DomainException);

      expect(fallo).toBeInstanceOf(DomainException);
      expect((fallo as DomainException).status).toBe(401);
    },
  );

  /** Un 500 del proveedor SÍ es una avería suya, y debe seguir diciéndolo. */
  it('conserva el 502 cuando el proveedor falla de verdad', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('boom', { status: 500 }));
    const client = new IdentityProviderClient(
      new ConfigService({
        IDENTITY_PROVIDER_URL: 'http://localhost:3005/api/v1',
        IDENTITY_PROVIDER_TIMEOUT_MS: 3_000,
        IDENTITY_PROVIDER_RETRY_ATTEMPTS: 0,
      }),
    );

    const fallo = await client
      .login({ tenantId: '7', email: 'analyst@example.com', password: 'valid-password' })
      .catch((error: unknown) => error as DomainException);

    expect((fallo as DomainException).status).toBe(502);
  });
});
