import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DomainException } from '../errors/domain-exception';
import { REQUIRED_ROLES } from './security.decorators';

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
    if (principal.roles.includes('PLATFORM_ADMIN') || normalized.some((role) => principal.roles.includes(role))) {
      return true;
    }
    throw new DomainException(
      'FORBIDDEN',
      `One of these roles is required: ${normalized.join(', ')}`,
      HttpStatus.FORBIDDEN,
    );
  }
}
