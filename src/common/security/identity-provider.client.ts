import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DomainException } from '../errors/domain-exception';
import {
  identityPinChallengeSchema,
  identityProfileSchema,
  identityProviderSessionSchema,
  type IdentityProfile,
  type IdentitySession,
} from './identity-provider.contract';

type LoginInput = { tenantId: string; email: string; password: string };

/**
 * Cookie names issued by the identity provider's internal auth endpoints. They are the only
 * place login and refresh return tokens; the response body never carries them.
 */
const ACCESS_TOKEN_COOKIE = 'atlas_internal_access';
const REFRESH_TOKEN_COOKIE = 'atlas_internal_refresh';

@Injectable()
export class IdentityProviderClient {
  constructor(private readonly config: ConfigService) {}

  login(input: LoginInput): Promise<IdentitySession> {
    return this.requestSession('/internal/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-tenant-id': input.tenantId },
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

    if (identityPinChallengeSchema.safeParse(payload).success) {
      throw new DomainException(
        'IDENTITY_PIN_CHALLENGE_REQUIRED',
        'This account completes sign-in with an emailed PIN, which this portal does not support yet',
        HttpStatus.NOT_IMPLEMENTED,
      );
    }

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
    const timeoutMs = this.config.get<number>('IDENTITY_PROVIDER_TIMEOUT_MS') ?? 3_000;
    const maxAttempts = (this.config.get<number>('IDENTITY_PROVIDER_RETRY_ATTEMPTS') ?? 2) + 1;
    const backoffMs = this.config.get<number>('IDENTITY_PROVIDER_RETRY_BACKOFF_MS') ?? 300;

    // Bodies are always strings (JSON.stringify) or absent, so `init` is safe to reuse across
    // attempts. Only transient failures retry — a rejected credential (401) surfaces immediately.
    let response: Response;
    for (let attempt = 1; ; attempt++) {
      try {
        response = await fetch(`${baseUrl}${path}`, {
          ...init,
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        // Connection refused / timeout: the provider never answered, so a retry cannot double any
        // side effect. This is the exact failure a dev server produces while it is restarting.
        if (attempt < maxAttempts) {
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
      if (response.status === 401 || response.status === 403) throw this.unauthorized();
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

  private backoff(ms: number): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
