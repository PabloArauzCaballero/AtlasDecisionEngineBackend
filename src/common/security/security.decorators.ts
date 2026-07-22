import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { PlatformRole } from './platform-roles';
import type { AuthenticatedPrincipal, ApiAudience } from './security.types';

export const PUBLIC_ROUTE = 'atlas.public-route';
export const REQUIRED_ROLES = 'atlas.required-roles';
export const REQUIRED_AUDIENCE = 'atlas.required-audience';
export const SKIP_RATE_LIMIT = 'atlas.skip-rate-limit';

export const Public = () => SetMetadata(PUBLIC_ROUTE, true);
/**
 * Declares the roles a route accepts.
 *
 * Typed as {@link PlatformRole} rather than `string`, so a misspelt or retired role name is a
 * compile error instead of a route that silently no identity can satisfy. The existing literal
 * call sites keep working unchanged — a valid literal is assignable to the union — while an
 * invalid one now fails the build. Deliberately does NOT collapse the per-route tuples: each
 * route's set of allowed roles is a distinct authorization decision, and merging them would
 * quietly widen or narrow access.
 */
export const Roles = (...roles: PlatformRole[]) => SetMetadata(REQUIRED_ROLES, roles);
export const Audience = (audience: ApiAudience) => SetMetadata(REQUIRED_AUDIENCE, audience);
export const SkipRateLimit = () => SetMetadata(SKIP_RATE_LIMIT, true);

export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedPrincipal => {
    const request = ctx.switchToHttp().getRequest<Express.Request>();
    if (!request.principal) throw new Error('Principal not available');
    return request.principal;
  },
);

export const TenantId = createParamDecorator((_data: unknown, ctx: ExecutionContext): bigint => {
  const request = ctx.switchToHttp().getRequest<Express.Request>();
  if (!request.principal) throw new Error('Principal not available');
  return request.principal.tenantId;
});
