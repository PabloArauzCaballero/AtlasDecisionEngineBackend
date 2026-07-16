import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DomainException } from '../errors/domain-exception';
import {
  identityProfileSchema,
  identitySessionSchema,
  type IdentityProfile,
  type IdentitySession,
} from './identity-provider.contract';

type LoginInput = { tenantId: string; email: string; password: string };

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
    if (!parsed.success || parsed.data.user.status.toUpperCase() !== 'ACTIVE') {
      throw this.unauthorized();
    }
    return parsed.data;
  }

  private async requestSession(path: string, init: RequestInit): Promise<IdentitySession> {
    const payload = await this.request(path, init);
    const parsed = identitySessionSchema.safeParse(payload);
    if (!parsed.success || parsed.data.user.status.toUpperCase() !== 'ACTIVE') throw this.unauthorized();
    return parsed.data;
  }

  private async request(path: string, init: RequestInit): Promise<unknown> {
    const baseUrl = this.config.get<string>('IDENTITY_PROVIDER_URL')?.replace(/\/+$/, '');
    if (!baseUrl) {
      throw new DomainException('IDENTITY_PROVIDER_NOT_CONFIGURED', 'Identity provider is not configured', HttpStatus.SERVICE_UNAVAILABLE);
    }
    const timeoutMs = this.config.get<number>('IDENTITY_PROVIDER_TIMEOUT_MS') ?? 3_000;
    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      throw new DomainException('IDENTITY_PROVIDER_UNAVAILABLE', 'Identity provider is unavailable', HttpStatus.SERVICE_UNAVAILABLE);
    }
    if (!response.ok) {
      if (response.status === 400) throw new DomainException('IDENTITY_REQUEST_INVALID', 'Invalid identity request', HttpStatus.BAD_REQUEST);
      if (response.status === 401 || response.status === 403) throw this.unauthorized();
      if (response.status === 429) throw new DomainException('IDENTITY_RATE_LIMITED', 'Too many authentication attempts', HttpStatus.TOO_MANY_REQUESTS);
      throw new DomainException('IDENTITY_PROVIDER_ERROR', 'Identity provider rejected the request', HttpStatus.BAD_GATEWAY);
    }
    try {
      const payload: unknown = await response.json();
      if (
        payload !== null
        && typeof payload === 'object'
        && 'data' in payload
      ) {
        return (payload as { data: unknown }).data;
      }
      return payload;
    } catch {
      throw new DomainException('IDENTITY_PROVIDER_INVALID_RESPONSE', 'Identity provider returned an invalid response', HttpStatus.BAD_GATEWAY);
    }
  }

  private unauthorized(): DomainException {
    return new DomainException('UNAUTHORIZED', 'Invalid or expired session', HttpStatus.UNAUTHORIZED);
  }
}
