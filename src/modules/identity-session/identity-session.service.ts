/** Delegates login/refresh/logout to the identity provider and returns only normalized session data. */
import { HttpStatus, Injectable } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain-exception';
import { IdentityProviderClient } from '../../common/security/identity-provider.client';
import {
  isPinChallenge,
  type IdentityPasswordChanged,
  type IdentityPinChallenge,
  type IdentitySession,
  type PublicIdentitySession,
} from '../../common/security/identity-provider.contract';
import type {
  IdentityLoginDto,
  IdentityLoginPinDto,
  IdentityPasswordChangeConfirmDto,
} from './identity-session.dto';

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

  /**
   * Password change, step one. The access token comes from the caller's `Authorization` header and
   * is forwarded untouched: this service never holds a credential of its own for the actor.
   */
  async requestPasswordChange(
    accessToken: string | undefined,
    currentPassword: string,
  ): Promise<IdentityPinChallenge> {
    return this.identityProvider.requestPasswordChange(
      this.requireAccessToken(accessToken),
      currentPassword,
    );
  }

  async confirmPasswordChange(
    accessToken: string | undefined,
    input: IdentityPasswordChangeConfirmDto,
  ): Promise<IdentityPasswordChanged> {
    return this.identityProvider.confirmPasswordChange(this.requireAccessToken(accessToken), {
      challengeToken: input.challengeToken,
      code: input.code,
      newPassword: input.newPassword,
    });
  }

  private requireAccessToken(accessToken: string | undefined): string {
    if (!accessToken) throw this.unauthorized();
    return accessToken;
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
