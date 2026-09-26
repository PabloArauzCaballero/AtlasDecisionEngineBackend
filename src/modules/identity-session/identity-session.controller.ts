/** Browser session boundary: origin checks, rate limits and HttpOnly refresh-cookie handling. */
import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../../common/security/security.decorators';
import {
  IdentityLoginDto,
  IdentityLoginPinDto,
  IdentityLogoutDto,
  IdentityPasswordChangeConfirmDto,
  IdentityPasswordChangeRequestDto,
} from './identity-session.dto';
import {
  IdentityPasswordChangedDto,
  IdentityPinChallengeDto,
  LogoutResultDto,
} from './identity-session.response.dto';
import { IdentitySessionService, isChallengeResult } from './identity-session.service';
import { SessionCookieService } from './session-cookie.service';
import { SessionOriginService } from './session-origin.service';
import { SessionRateLimitGuard } from './session-rate-limit.guard';

@ApiTags('Portal Session')
@Controller('v1/session')
@Public()
@UseGuards(SessionRateLimitGuard)
export class IdentitySessionController {
  constructor(
    private readonly sessions: IdentitySessionService,
    private readonly cookies: SessionCookieService,
    private readonly origins: SessionOriginService,
  ) {}

  @Post('login')
  @ApiOperation({ summary: 'Authenticate through the configured identity provider' })
  @HttpCode(HttpStatus.OK)
  async login(
    @Headers('origin') origin: string | undefined,
    @Body() body: IdentityLoginDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.origins.assertAllowed(origin);
    const result = await this.sessions.login(body);
    // A challenge is not a session: there is no refresh token yet, so no cookie is issued. The
    // caller gets the challenge token and must come back through `login/pin`.
    if (isChallengeResult(result)) return result.challenge;
    response.setHeader('set-cookie', this.cookies.serialize(result.refreshToken));
    return result.session;
  }

  @Post('login/pin')
  @ApiOperation({ summary: 'Complete a second-factor sign-in with the mailed PIN' })
  @HttpCode(HttpStatus.OK)
  async verifyLoginPin(
    @Headers('origin') origin: string | undefined,
    @Body() body: IdentityLoginPinDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.origins.assertAllowed(origin);
    const result = await this.sessions.verifyLoginPin(body);
    response.setHeader('set-cookie', this.cookies.serialize(result.refreshToken));
    return result.session;
  }

  /**
   * Password change for the signed-in actor, proxied to the identity provider in two steps.
   *
   * The bearer token travels from the caller's header straight upstream: this portal never learns
   * who is changing the password, which is what keeps the endpoint from becoming a way to change
   * someone else's.
   */
  @Post('password/change/request')
  @ApiOperation({ summary: 'Request the mailed code that confirms a password change' })
  @ApiOkResponse({
    description: 'Second-factor challenge; the code travels by mail.',
    type: IdentityPinChallengeDto,
  })
  @HttpCode(HttpStatus.OK)
  async requestPasswordChange(
    @Headers('origin') origin: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: IdentityPasswordChangeRequestDto,
  ) {
    this.origins.assertAllowed(origin);
    return this.sessions.requestPasswordChange(bearerFrom(authorization), body.currentPassword);
  }

  @Post('password/change/confirm')
  @ApiOperation({ summary: 'Confirm a password change with the mailed code' })
  @ApiOkResponse({ description: 'Password changed.', type: IdentityPasswordChangedDto })
  @HttpCode(HttpStatus.OK)
  async confirmPasswordChange(
    @Headers('origin') origin: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: IdentityPasswordChangeConfirmDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.origins.assertAllowed(origin);
    const result = await this.sessions.confirmPasswordChange(bearerFrom(authorization), body);
    // The provider revokes every session of the actor on a successful change, this one included.
    // Leaving the refresh cookie in place would only buy an unexplained 401 on the next call.
    response.setHeader('set-cookie', this.cookies.clear());
    return result;
  }

  @Post('refresh')
  @ApiOperation({ summary: 'Rotate the provider session using the HttpOnly refresh cookie' })
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Headers('origin') origin: string | undefined,
    @Headers('cookie') cookieHeader: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.origins.assertAllowed(origin);
    const result = await this.sessions.refresh(this.cookies.read(cookieHeader));
    response.setHeader('set-cookie', this.cookies.serialize(result.refreshToken));
    return result.session;
  }

  @Post('logout')
  @ApiOperation({ summary: 'Revoke the provider session and clear the refresh cookie' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ description: 'Sesión revocada.', type: LogoutResultDto })
  async logout(
    @Headers('origin') origin: string | undefined,
    @Headers('cookie') cookieHeader: string | undefined,
    @Body() body: IdentityLogoutDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.origins.assertAllowed(origin);
    try {
      await this.sessions.logout(this.cookies.read(cookieHeader), body.allDevices);
      return { loggedOut: true };
    } finally {
      response.setHeader('set-cookie', this.cookies.clear());
    }
  }
}

/** `Authorization: Bearer <token>` → `<token>`. Anything else is treated as no token at all. */
function bearerFrom(header: string | undefined): string | undefined {
  const match = /^Bearer\s+(.+)$/i.exec(header?.trim() ?? '');
  return match?.[1];
}
