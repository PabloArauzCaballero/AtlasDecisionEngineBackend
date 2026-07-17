/** Logical API boundary used to prevent management credentials from invoking runtime routes. */
export type ApiAudience = 'management' | 'runtime';

/** Authentication mechanism that established the principal. */
export type AuthMethod = 'api_key' | 'jwt' | 'identity_provider';

/**
 * Server-established request identity.
 *
 * Controllers and services consume this object instead of reading security headers directly.
 */
export interface AuthenticatedPrincipal {
  /** Stable subject or registered integration client key. */
  id: string;
  /** Tenant selected from signed claims or registered client access. */
  tenantId: bigint;
  /** Normalized uppercase roles granted by the trusted identity source. */
  roles: string[];
  audience: ApiAudience;
  requestId: string;
  authMethod: AuthMethod;
  /** Optional JWT identifier used for token-level traceability. */
  tokenId?: string;
}

declare global {
  namespace Express {
    interface Request {
      principal?: AuthenticatedPrincipal;
    }
  }
}
