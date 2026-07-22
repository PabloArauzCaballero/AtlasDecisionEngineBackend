import { Module } from '@nestjs/common';
import { IdentitySessionController } from './identity-session.controller';
import { IdentitySessionService } from './identity-session.service';
import { SessionCookieService } from './session-cookie.service';
import { SessionOriginService } from './session-origin.service';
import { SessionRateLimitGuard } from './session-rate-limit.guard';

@Module({
  controllers: [IdentitySessionController],
  providers: [
    IdentitySessionService,
    SessionCookieService,
    SessionOriginService,
    SessionRateLimitGuard,
  ],
})
export class IdentitySessionModule {}
