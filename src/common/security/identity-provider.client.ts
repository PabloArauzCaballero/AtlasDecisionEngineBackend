import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { numeroDeConfig } from '../config/config-coercion.util';
import { DomainException } from '../errors/domain-exception';
import { IdentityProviderTransport } from './identity-provider.transport';
import { parseOrBadGateway, toSession, unauthorized } from './identity-provider.session';
import {
  identityPasswordChangedSchema,
  identityPasswordResetRequestedSchema,
  identityPinChallengeSchema,
  identityProfileSchema,
  type IdentityLoginOutcome,
  type IdentityPasswordChanged,
  type IdentityPasswordResetRequested,
  type IdentityPinChallenge,
  type IdentityProfile,
  type IdentitySession,
} from './identity-provider.contract';

type LoginInput = { tenantId: string; email: string; password: string };
type PinInput = { challengeToken: string; pin: string };
type ResetInput = { tenantId: string; email: string };

/**
 * The portal only signs in internal actors (`/internal/auth/login`), so a forgotten password is
 * recovered for that same kind of account and no other: a customer or merchant who shares an
 * e-mail with an operator must not get a code for the operator's account through this screen.
 */
const RESET_ACTOR_TYPE = 'internal_user';

@Injectable()
export class IdentityProviderClient {
  private readonly transport: IdentityProviderTransport;

  constructor(private readonly config: ConfigService) {
    this.transport = new IdentityProviderTransport(config);
  }

  /**
   * A password check yields a session or a PIN challenge, and both are successful outcomes.
   *
   * The challenge used to be turned into a 501 here, which inverted the security incentive: a
   * deployment that configured a mail channel — and therefore actually enforced the second factor
   * on internal actors — locked every operator out of the portal, while a deployment with no
   * channel let everyone in with a password alone and worked fine.
   */
  async login(input: LoginInput): Promise<IdentityLoginOutcome> {
    const { payload, response } = await this.transport.send('/internal/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-tenant-id': input.tenantId },
      body: JSON.stringify(input),
    });

    const challenge = identityPinChallengeSchema.safeParse(payload);
    if (challenge.success) return challenge.data;

    return toSession(payload, response);
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
    await this.transport.request('/internal/auth/logout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken, allDevices }),
    });
  }

  /**
   * First step of a password change for the signed-in actor: the provider checks the current
   * password and mails a code, answering with the same challenge shape as the login.
   *
   * No tenant header, for the same reason as `verifyLoginPin`: the actor comes from the bearer
   * token, and letting the caller assert a tenant it has not authenticated against is exactly the
   * hole `TenantGuard` exists to close.
   */
  async requestPasswordChange(
    accessToken: string,
    currentPassword: string,
  ): Promise<IdentityPinChallenge> {
    const payload = await this.transport.requestPropagatingMessage(
      '/auth/password/change/request',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${accessToken}`,
          accept: 'application/json',
        },
        body: JSON.stringify({ currentPassword }),
      },
    );
    return parseOrBadGateway(identityPinChallengeSchema, payload, 'a password-change challenge');
  }

  /** Second step: the challenge token and the mailed code, exchanged for the new password. */
  async confirmPasswordChange(
    accessToken: string,
    body: { challengeToken: string; code: string; newPassword: string },
  ): Promise<IdentityPasswordChanged> {
    const payload = await this.transport.requestPropagatingMessage(
      '/auth/password/change/confirm',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${accessToken}`,
          accept: 'application/json',
        },
        body: JSON.stringify(body),
      },
    );
    return parseOrBadGateway(
      identityPasswordChangedSchema,
      payload,
      'a password-change confirmation',
    );
  }

  /**
   * "Forgot password", step one: the provider mails a one-time code IF the account exists.
   *
   * The reply is identical either way, and that is the provider's anti-enumeration guarantee;
   * nothing here may add a signal on top (a different status, a different delay budget). What does
   * propagate is a refusal that is about the SERVICE and not the account — no mail channel
   * configured (503), too many requests (429) — because those are the same for every address.
   *
   * It gets the login's time budget: mailing the code is what makes the login slow too, and
   * aborting while the provider writes the mail would report a failure for a code already sent.
   */
  async requestPasswordReset(input: ResetInput): Promise<IdentityPasswordResetRequested> {
    const payload = await this.transport.requestPropagatingMessage(
      '/auth/password-reset/request',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-tenant-id': input.tenantId,
          accept: 'application/json',
        },
        body: JSON.stringify({ actorType: RESET_ACTOR_TYPE, identifier: input.email }),
      },
      numeroDeConfig(this.config, 'IDENTITY_PROVIDER_LOGIN_TIMEOUT_MS', 12_000),
    );
    return parseOrBadGateway(
      identityPasswordResetRequestedSchema,
      payload,
      'a password-reset acknowledgement',
    );
  }

  /**
   * Step two: the mailed code and the new password. The provider answers every failure — unknown
   * account, no active code, wrong or expired code — with the same message, so propagating it
   * tells the person what to do without telling anyone whether the address is registered.
   */
  async confirmPasswordReset(
    input: ResetInput & { code: string; newPassword: string },
  ): Promise<IdentityPasswordChanged> {
    const payload = await this.transport.requestPropagatingMessage('/auth/password-reset/confirm', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-tenant-id': input.tenantId,
        accept: 'application/json',
      },
      body: JSON.stringify({
        actorType: RESET_ACTOR_TYPE,
        identifier: input.email,
        code: input.code,
        newPassword: input.newPassword,
      }),
    });
    return parseOrBadGateway(
      identityPasswordChangedSchema,
      payload,
      'a password-reset confirmation',
    );
  }

  async profile(accessToken: string): Promise<IdentityProfile> {
    const payload = await this.transport.request('/internal/auth/me', {
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
      throw unauthorized();
    }
    return parsed.data;
  }

  /**
   * Rebuilds a session from the provider's cookie-based reply: the body describes the user
   * while the tokens arrive as Set-Cookie. Body tokens are still honoured when present so a
   * provider that answers with the older token-in-body shape keeps working.
   */
  private async requestSession(path: string, init: RequestInit): Promise<IdentitySession> {
    const { payload, response } = await this.transport.send(path, init);
    return toSession(payload, response);
  }
}
