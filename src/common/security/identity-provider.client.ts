import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { numeroDeConfig } from '../config/config-coercion.util';
import { DomainException } from '../errors/domain-exception';
import {
  identityPinChallengeSchema,
  identityProfileSchema,
  identityProviderSessionSchema,
  type IdentityLoginOutcome,
  type IdentityProfile,
  type IdentitySession,
} from './identity-provider.contract';

type LoginInput = { tenantId: string; email: string; password: string };
type PinInput = { challengeToken: string; pin: string };

/**
 * Cookie names issued by the identity provider's internal auth endpoints. They are the only
 * place login and refresh return tokens; the response body never carries them.
 */
const ACCESS_TOKEN_COOKIE = 'atlas_internal_access';
const REFRESH_TOKEN_COOKIE = 'atlas_internal_refresh';

@Injectable()
export class IdentityProviderClient {
  constructor(private readonly config: ConfigService) {}

  /**
   * A password check yields a session or a PIN challenge, and both are successful outcomes.
   *
   * The challenge used to be turned into a 501 here, which inverted the security incentive: a
   * deployment that configured a mail channel — and therefore actually enforced the second factor
   * on internal actors — locked every operator out of the portal, while a deployment with no
   * channel let everyone in with a password alone and worked fine.
   */
  async login(input: LoginInput): Promise<IdentityLoginOutcome> {
    const { payload, response } = await this.send('/internal/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-tenant-id': input.tenantId },
      body: JSON.stringify(input),
    });

    const challenge = identityPinChallengeSchema.safeParse(payload);
    if (challenge.success) return challenge.data;

    return this.toSession(payload, response);
  }

  /**
   * Second step: the challenge token plus the mailed PIN, exchanged for the session.
   *
   * No tenant header: the challenge already names the actor it was issued for, and the provider
   * resolves the tenant from it. Sending one would let the caller assert a tenant it has not
   * authenticated against.
   */
  verifyLoginPin(input: PinInput): Promise<IdentitySession> {
    return this.requestSession('/internal/auth/login/pin', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
  }

  refresh(refreshToken: string): Promise<IdentitySession> {
    return this.requestSession('/internal/auth/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
  }

  async logout(refreshToken: string, allDevices: boolean): Promise<void> {
    await this.request('/internal/auth/logout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken, allDevices }),
    });
  }

  async profile(accessToken: string): Promise<IdentityProfile> {
    const payload = await this.request('/internal/auth/me', {
      method: 'GET',
      headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
    });
    const parsed = identityProfileSchema.safeParse(payload);
    if (!parsed.success) {
      throw new DomainException(
        'IDENTITY_PROVIDER_INVALID_RESPONSE',
        'Identity provider returned a profile that does not match the expected contract',
        HttpStatus.BAD_GATEWAY,
      );
    }
    if (parsed.data.user.status.toUpperCase() !== 'ACTIVE') {
      throw this.unauthorized();
    }
    return parsed.data;
  }

  /**
   * Rebuilds a session from the provider's cookie-based reply: the body describes the user
   * while the tokens arrive as Set-Cookie. Body tokens are still honoured when present so a
   * provider that answers with the older token-in-body shape keeps working.
   */
  private async requestSession(path: string, init: RequestInit): Promise<IdentitySession> {
    const { payload, response } = await this.send(path, init);
    return this.toSession(payload, response);
  }

  private toSession(payload: unknown, response: Response): IdentitySession {
    const parsed = identityProviderSessionSchema.safeParse(payload);
    // Only a rejected credential is an authentication failure. A session that cannot be read
    // is a contract problem, and reporting it as "invalid credentials" is what previously hid
    // this drift behind a login screen that simply refused every correct password.
    if (!parsed.success) {
      throw new DomainException(
        'IDENTITY_PROVIDER_INVALID_RESPONSE',
        'Identity provider returned a session that does not match the expected contract',
        HttpStatus.BAD_GATEWAY,
      );
    }
    if (parsed.data.user.status.toUpperCase() !== 'ACTIVE') throw this.unauthorized();

    const cookies = this.setCookies(response);
    const accessToken = parsed.data.accessToken ?? cookies[ACCESS_TOKEN_COOKIE];
    const refreshToken = parsed.data.refreshToken ?? cookies[REFRESH_TOKEN_COOKIE];
    if (!accessToken || !refreshToken) {
      throw new DomainException(
        'IDENTITY_PROVIDER_INVALID_RESPONSE',
        'Identity provider did not return session tokens',
        HttpStatus.BAD_GATEWAY,
      );
    }

    return {
      user: parsed.data.user,
      expiresIn: parsed.data.expiresIn,
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
    };
  }

  /** Parses Set-Cookie into {name: value}; the provider sends one cookie per header. */
  private setCookies(response: Response): Record<string, string> {
    const entries: Record<string, string> = {};
    for (const header of response.headers.getSetCookie()) {
      const [pair] = header.split(';');
      const separator = pair?.indexOf('=') ?? -1;
      if (!pair || separator === -1) continue;
      const name = pair.slice(0, separator).trim();
      const value = pair.slice(separator + 1).trim();
      if (!name || !value) continue;
      try {
        entries[name] = decodeURIComponent(value);
      } catch {
        entries[name] = value;
      }
    }
    return entries;
  }

  private async request(path: string, init: RequestInit): Promise<unknown> {
    return (await this.send(path, init)).payload;
  }

  private async send(
    path: string,
    init: RequestInit,
  ): Promise<{ payload: unknown; response: Response }> {
    const baseUrl = this.config.get<string>('IDENTITY_PROVIDER_URL')?.replace(/\/+$/, '');
    if (!baseUrl) {
      throw new DomainException(
        'IDENTITY_PROVIDER_NOT_CONFIGURED',
        'Identity provider is not configured',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    /*
     * El login tiene su propio presupuesto: firma la contraseña y, con segundo factor, emite el
     * PIN y se lo entrega al canal de correo. Medido, ~4,7 s contra el proveedor local, por
     * encima de los 3 s que le sobran a cualquier lectura.
     */
    const esLogin = path.startsWith('/internal/auth/login');
    const timeoutMs = esLogin
      ? numeroDeConfig(this.config, 'IDENTITY_PROVIDER_LOGIN_TIMEOUT_MS', 12_000)
      : numeroDeConfig(this.config, 'IDENTITY_PROVIDER_TIMEOUT_MS', 3_000);
    const maxAttempts = numeroDeConfig(this.config, 'IDENTITY_PROVIDER_RETRY_ATTEMPTS', 2) + 1;
    const backoffMs = numeroDeConfig(this.config, 'IDENTITY_PROVIDER_RETRY_BACKOFF_MS', 300);

    // Bodies are always strings (JSON.stringify) or absent, so `init` is safe to reuse across
    // attempts. Only transient failures retry — a rejected credential (401) surfaces immediately.
    let response: Response;
    for (let attempt = 1; ; attempt++) {
      try {
        response = await fetch(`${baseUrl}${path}`, {
          ...init,
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        /*
         * Retry only when the request PROVABLY never reached the provider.
         *
         * This used to retry on any thrown error, on the premise that "the provider never
         * answered, so a retry cannot double any side effect". That premise is false for a
         * timeout, and it produced a real defect: `/internal/auth/login` mails a PIN, and
         * mailing takes longer than the 3 s default, so the first attempt aborted AFTER the
         * provider had already issued and sent the code. The retry issued a second one — and
         * because issuing a PIN invalidates the previous, the operator received two mails of
         * which the FIRST one no longer worked. Measured: one POST /v1/session/login, two rows
         * in `auth_one_time_codes` 1,6 s apart.
         *
         * A refused connection is different in kind: nothing was written to the socket, so
         * nothing on the other side happened. That is the failure a dev server produces while
         * it restarts, which is what the retry was for.
         */
        if (attempt < maxAttempts && this.neverArrived(error)) {
          await this.backoff(backoffMs * attempt);
          continue;
        }
        throw new DomainException(
          'IDENTITY_PROVIDER_UNAVAILABLE',
          'Identity provider is unavailable',
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
      // 502/503/504 are the provider (or a proxy) reporting itself momentarily unavailable — retry.
      // Every other non-2xx is a definitive answer and must not be retried.
      if (
        (response.status === 502 || response.status === 503 || response.status === 504) &&
        attempt < maxAttempts
      ) {
        await this.backoff(backoffMs * attempt);
        continue;
      }
      break;
    }
    if (!response.ok) {
      if (response.status === 400)
        throw new DomainException(
          'IDENTITY_REQUEST_INVALID',
          'Invalid identity request',
          HttpStatus.BAD_REQUEST,
        );
      /*
       * 404 and 409 are the provider saying "no such account here", not "I am broken".
       *
       * A 404 is an unknown user; a 409 is a tenant that does not exist or does not match
       * the credential (measured: the provider answers 409 for an unknown `x-tenant-id`).
       * Both are definitive answers from a HEALTHY provider, so they belong with 401/403.
       *
       * They used to fall through to BAD_GATEWAY, and that was wrong twice over. Operationally
       * a 502 means "the identity provider is down": it fires retries, alerts and an on-call
       * page for what is really a typo in the tenant box. And for the caller it is an
       * enumeration oracle — a wrong password answered 401 while a wrong tenant answered 502,
       * so the pair of responses told an attacker which tenants exist. Mapping both to the
       * same opaque 401 removes the signal.
       */
      if (
        response.status === 401 ||
        response.status === 403 ||
        response.status === 404 ||
        response.status === 409
      )
        throw this.unauthorized();
      if (response.status === 429)
        throw new DomainException(
          'IDENTITY_RATE_LIMITED',
          'Too many authentication attempts',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      throw new DomainException(
        'IDENTITY_PROVIDER_ERROR',
        'Identity provider rejected the request',
        HttpStatus.BAD_GATEWAY,
      );
    }
    try {
      const payload: unknown = await response.json();
      if (payload !== null && typeof payload === 'object' && 'data' in payload) {
        return { payload: (payload as { data: unknown }).data, response };
      }
      return { payload, response };
    } catch {
      throw new DomainException(
        'IDENTITY_PROVIDER_INVALID_RESPONSE',
        'Identity provider returned an invalid response',
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  private unauthorized(): DomainException {
    return new DomainException(
      'UNAUTHORIZED',
      'Invalid or expired session',
      HttpStatus.UNAUTHORIZED,
    );
  }

  /**
   * Whether the request demonstrably never reached the provider.
   *
   * `AbortSignal.timeout` rejects with a `TimeoutError`, and that only says WE stopped waiting:
   * the provider may have finished the work — issued a PIN, mailed it, rotated a token — and be
   * writing the response. A refused or reset connection is the opposite: the socket never
   * carried the request, so repeating it is free.
   *
   * Anything unrecognised is treated as "it may have arrived". Guessing the other way is what
   * duplicates side effects, and a login the operator has to repeat is a far smaller cost than
   * a second PIN that silently kills the first.
   */
  private neverArrived(error: unknown): boolean {
    if (error instanceof DOMException && error.name === 'TimeoutError') return false;
    const causa = (error as { cause?: { code?: string } })?.cause?.code;
    return (
      causa === 'ECONNREFUSED' ||
      causa === 'ENOTFOUND' ||
      causa === 'EAI_AGAIN' ||
      causa === 'ECONNRESET'
    );
  }

  private backoff(ms: number): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
