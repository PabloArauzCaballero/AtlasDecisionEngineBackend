/** Delegates login/refresh/logout to the identity provider and returns only normalized session data. */
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DomainException } from '../../common/errors/domain-exception';
import { IdentityProviderClient } from '../../common/security/identity-provider.client';
import {
  isPinChallenge,
  type IdentityPasswordChanged,
  type IdentityPasswordResetRequested,
  type IdentityPinChallenge,
  type IdentitySession,
  type PublicIdentitySession,
} from '../../common/security/identity-provider.contract';
import type {
  IdentityLoginDto,
  IdentityLoginPinDto,
  IdentityPasswordChangeConfirmDto,
  IdentityPasswordResetConfirmDto,
  IdentityPasswordResetRequestDto,
} from './identity-session.dto';
import type { SessionCookie } from './session-cookie.service';

/** `startedAt`: epoch ms of the sign-in that opened the session; a refresh carries it forward. */
export type SessionResult = {
  session: PublicIdentitySession;
  refreshToken: string;
  startedAt: number;
};

/** Tolerance for a clock a little ahead on another replica, so a fresh session is not «future». */
const CLOCK_SKEW_MS = 5 * 60_000;
export type LoginResult = SessionResult | { challenge: IdentityPinChallenge };

export function isChallengeResult(
  result: LoginResult,
): result is { challenge: IdentityPinChallenge } {
  return 'challenge' in result;
}

@Injectable()
export class IdentitySessionService {
  private readonly logger = new Logger(IdentitySessionService.name);

  constructor(
    private readonly identityProvider: IdentityProviderClient,
    private readonly config: ConfigService,
  ) {}

  /** Injectable clock, so the absolute limit can be tested without waiting twelve hours. */
  protected now(): number {
    return Date.now();
  }

  /**
   * The password step. It does not always produce a session: when the provider enforces a second
   * factor it produces the challenge the caller must answer with `verifyLoginPin`. Both are
   * successes, and only one of them has a refresh token to put in a cookie.
   */
  async login(input: IdentityLoginDto): Promise<LoginResult> {
    const outcome = await this.identityProvider.login(input);
    if (isPinChallenge(outcome)) return { challenge: outcome };
    return this.toResult(outcome, this.now());
  }

  async verifyLoginPin(input: IdentityLoginPinDto): Promise<SessionResult> {
    return this.toResult(await this.identityProvider.verifyLoginPin(input), this.now());
  }

  /**
   * MOT-08 — rotates the session ONLY while it is younger than its absolute lifetime.
   *
   * The limit used to exist only in the portal, which restarted the clock on every reload: a stolen
   * cookie, or a tab kept alive, stretched the session forever. Here the start instant comes from
   * the signed cookie (`SessionCookieService`) and is carried, unchanged, into the next cookie. A
   * cookie that cannot prove its start —old format or tampered— is treated as an expired session:
   * the person signs in once more. When the limit is reached the provider session is revoked too,
   * so the token cannot be replayed elsewhere.
   */
  async refresh(cookie: SessionCookie | undefined): Promise<SessionResult> {
    if (!cookie?.refreshToken) throw this.unauthorized();
    const { refreshToken, startedAt } = cookie;
    const now = this.now();
    const tooOld = startedAt !== null && now - startedAt > this.absoluteLifetimeMs();
    const future = startedAt !== null && startedAt > now + CLOCK_SKEW_MS;

    if (startedAt === null || tooOld || future) {
      await this.revokeQuietly(refreshToken);
      throw new DomainException(
        'SESSION_EXPIRED',
        'The session reached its absolute lifetime; sign in again',
        HttpStatus.UNAUTHORIZED,
      );
    }
    return this.toResult(await this.identityProvider.refresh(refreshToken), startedAt);
  }

  private absoluteLifetimeMs(): number {
    const hours = Number(this.config.get('IDENTITY_SESSION_ABSOLUTE_MAX_HOURS') ?? 12);
    return (Number.isFinite(hours) && hours > 0 ? hours : 12) * 3_600_000;
  }

  /** Best effort: the 401 is the answer either way, and a provider outage must not turn it 5xx. */
  private async revokeQuietly(refreshToken: string): Promise<void> {
    try {
      await this.identityProvider.logout(refreshToken, false);
    } catch (error) {
      this.logger.warn(
        `Could not revoke an expired session at the provider: ${(error as Error).message}`,
      );
    }
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

  /**
   * Forgotten password, for someone WITHOUT a session. Unlike the change above there is no token to
   * name the actor: the mailbox does, because the code only reaches whoever reads it.
   */
  requestPasswordReset(
    input: IdentityPasswordResetRequestDto,
  ): Promise<IdentityPasswordResetRequested> {
    return this.identityProvider.requestPasswordReset({
      tenantId: input.tenantId,
      email: input.email,
    });
  }

  confirmPasswordReset(input: IdentityPasswordResetConfirmDto): Promise<IdentityPasswordChanged> {
    return this.identityProvider.confirmPasswordReset({
      tenantId: input.tenantId,
      email: input.email,
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

  private toResult(response: IdentitySession, startedAt: number): SessionResult {
    const { refreshToken, ...session } = response;
    return { session, refreshToken, startedAt };
  }

  private unauthorized(): DomainException {
    return new DomainException('UNAUTHORIZED', 'No active session', HttpStatus.UNAUTHORIZED);
  }
}
