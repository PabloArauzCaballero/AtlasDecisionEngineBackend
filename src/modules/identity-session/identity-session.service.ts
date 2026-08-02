/** Delegates login/refresh/logout to the identity provider and returns only normalized session data. */
import { HttpStatus, Injectable } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain-exception';
import { IdentityProviderClient } from '../../common/security/identity-provider.client';
import type {
  IdentitySession,
  PublicIdentitySession,
} from '../../common/security/identity-provider.contract';
import type { IdentityLoginDto } from './identity-session.dto';

export type SessionResult = { session: PublicIdentitySession; refreshToken: string };

@Injectable()
export class IdentitySessionService {
  constructor(private readonly identityProvider: IdentityProviderClient) {}

  async login(input: IdentityLoginDto): Promise<SessionResult> {
    return this.toResult(await this.identityProvider.login(input));
  }

  async refresh(refreshToken: string | undefined): Promise<SessionResult> {
    if (!refreshToken) throw this.unauthorized();
    return this.toResult(await this.identityProvider.refresh(refreshToken));
  }

  async logout(refreshToken: string | undefined, allDevices: boolean): Promise<void> {
    if (!refreshToken) return;
    await this.identityProvider.logout(refreshToken, allDevices);
  }

  private toResult(response: IdentitySession): SessionResult {
    const { refreshToken, ...session } = response;
    return { session, refreshToken };
  }

  private unauthorized(): DomainException {
    return new DomainException('UNAUTHORIZED', 'No active session', HttpStatus.UNAUTHORIZED);
  }
}
