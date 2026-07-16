export type ApiAudience = 'management' | 'runtime';
export type AuthMethod = 'api_key' | 'jwt' | 'identity_provider';

export interface AuthenticatedPrincipal {
  id: string;
  tenantId: bigint;
  roles: string[];
  audience: ApiAudience;
  requestId: string;
  authMethod: AuthMethod;
  tokenId?: string;
}

declare global {
  namespace Express {
    interface Request {
      principal?: AuthenticatedPrincipal;
    }
  }
}
