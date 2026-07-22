import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DomainException } from '../errors/domain-exception';
import { REQUIRED_ROLES } from './security.decorators';
import { PlatformRole } from './platform-roles';

/**
 * Enforces route roles against the trusted principal established by AuthenticationGuard.
 *
 * PLATFORM_ADMIN acts as a global wildcard only for signed identity mechanisms.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(REQUIRED_ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;

    const request = context.switchToHttp().getRequest<Express.Request>();
    const principal = request.principal;
    if (!principal) return false;
    const normalized = required.map((role) => role.toUpperCase());
    // PLATFORM_ADMIN is a global wildcard, so it is only honoured when it arrives on a
    // signed token from the IdP — never when it was granted to an API key. An API key
    // must still hold the specific role a route requires.
    const adminWildcard =
      principal.roles.includes(PlatformRole.PLATFORM_ADMIN) &&
      (principal.authMethod === 'jwt' || principal.authMethod === 'identity_provider');
    if (adminWildcard || normalized.some((role) => principal.roles.includes(role))) {
      return true;
    }
    throw new DomainException(
      'FORBIDDEN',
      `One of these roles is required: ${normalized.join(', ')}`,
      HttpStatus.FORBIDDEN,
    );
  }
}
