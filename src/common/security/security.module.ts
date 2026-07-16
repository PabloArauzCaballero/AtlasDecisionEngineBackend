import { Global, Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AccessAuditInterceptor } from './access-audit.interceptor';
import { AuthenticationGuard } from './authentication.guard';
import { JwtVerifierService } from './jwt-verifier.service';
import { IdentityProviderVerifierService } from './identity-provider-verifier.service';
import { IdentityProviderClient } from './identity-provider.client';
import { RateLimitGuard } from './rate-limit.guard';
import { RolesGuard } from './roles.guard';

@Global()
@Module({
  providers: [
    JwtVerifierService,
    IdentityProviderVerifierService,
    IdentityProviderClient,
    { provide: APP_GUARD, useClass: AuthenticationGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_INTERCEPTOR, useClass: AccessAuditInterceptor },
  ],
  exports: [JwtVerifierService, IdentityProviderVerifierService, IdentityProviderClient],
})
export class SecurityModule {}
