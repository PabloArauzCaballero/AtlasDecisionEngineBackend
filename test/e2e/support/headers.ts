export const TENANT_ID = '1';
export const MANAGEMENT_API_KEY = 'change-me-management-with-at-least-24-characters';
export const RUNTIME_API_KEY = 'change-me-runtime-with-at-least-24-characters';

export function managementHeaders(principalId: string, roles: string[]): Record<string, string> {
  return {
    'x-api-key': MANAGEMENT_API_KEY,
    'x-tenant-id': TENANT_ID,
    'x-principal-id': principalId,
    'x-roles': roles.join(','),
  };
}

export function runtimeHeaders(principalId: string): Record<string, string> {
  return {
    'x-api-key': RUNTIME_API_KEY,
    'x-tenant-id': TENANT_ID,
    'x-principal-id': principalId,
    'x-roles': 'DECISION_RUNTIME',
  };
}
