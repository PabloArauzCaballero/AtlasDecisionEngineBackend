import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { AuthenticatedPrincipal, ApiAudience } from './security.types';

export const PUBLIC_ROUTE = 'atlas.public-route';
export const REQUIRED_ROLES = 'atlas.required-roles';
export const REQUIRED_AUDIENCE = 'atlas.required-audience';
export const SKIP_RATE_LIMIT = 'atlas.skip-rate-limit';

export const Public = () => SetMetadata(PUBLIC_ROUTE, true);
export const Roles = (...roles: string[]) => SetMetadata(REQUIRED_ROLES, roles);
export const Audience = (audience: ApiAudience) => SetMetadata(REQUIRED_AUDIENCE, audience);
export const SkipRateLimit = () => SetMetadata(SKIP_RATE_LIMIT, true);

export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedPrincipal => {
    const request = ctx.switchToHttp().getRequest<Express.Request>();
    if (!request.principal) throw new Error('Principal not available');
    return request.principal;
  },
);

export const TenantId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): bigint => {
    const request = ctx.switchToHttp().getRequest<Express.Request>();
    if (!request.principal) throw new Error('Principal not available');
    return request.principal.tenantId;
  },
);
