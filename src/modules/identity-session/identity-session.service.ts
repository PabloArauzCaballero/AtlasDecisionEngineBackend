/** Delegates login/refresh/logout to the identity provider and returns only normalized session data. */
import { HttpStatus, Injectable } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain-exception';
import { IdentityProviderClient } from '../../common/security/identity-provider.client';
import {
  isPinChallenge,
  type IdentityPinChallenge,
  type IdentitySession,
  type PublicIdentitySession,
} from '../../common/security/identity-provider.contract';
import type { IdentityLoginDto, IdentityLoginPinDto } from './identity-session.dto';

export type SessionResult = { session: PublicIdentitySession; refreshToken: string };
export type LoginResult = SessionResult | { challenge: IdentityPinChallenge };

export function isChallengeResult(
  result: LoginResult,
): result is { challenge: IdentityPinChallenge } {
  return 'challenge' in result;
}

@Injectable()
export class IdentitySessionService {
  constructor(private readonly identityProvider: IdentityProviderClient) {}

  /**
   * The password step. It does not always produce a session: when the provider enforces a second
   * factor it produces the challenge the caller must answer with `verifyLoginPin`. Both are
   * successes, and only one of them has a refresh token to put in a cookie.
   */
  async login(input: IdentityLoginDto): Promise<LoginResult> {
    const outcome = await this.identityProvider.login(input);
    if (isPinChallenge(outcome)) return { challenge: outcome };
    return this.toResult(outcome);
  }

  async verifyLoginPin(input: IdentityLoginPinDto): Promise<SessionResult> {
    return this.toResult(await this.identityProvider.verifyLoginPin(input));
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
