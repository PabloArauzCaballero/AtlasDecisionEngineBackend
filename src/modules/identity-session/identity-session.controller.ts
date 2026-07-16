import { Body, Controller, Headers, HttpCode, HttpStatus, Post, Res, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../../common/security/security.decorators';
import { IdentityLoginDto, IdentityLogoutDto } from './identity-session.dto';
import { IdentitySessionService } from './identity-session.service';
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
  @HttpCode(HttpStatus.OK)
  async login(
    @Headers('origin') origin: string | undefined,
    @Body() body: IdentityLoginDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.origins.assertAllowed(origin);
    const result = await this.sessions.login(body);
    response.setHeader('set-cookie', this.cookies.serialize(result.refreshToken));
    return result.session;
  }

  @Post('refresh')
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
  @HttpCode(HttpStatus.OK)
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
