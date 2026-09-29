import { E2E_CLIENTS, headersFor, TENANT_ID } from './integration-clients';

export { TENANT_ID };
export const MANAGEMENT_API_KEY = E2E_CLIENTS.admin.secret;
export const RUNTIME_API_KEY = E2E_CLIENTS.runtime.secret;

/**
 * Identity for API key callers resolves from the integration client registry,
 * so roles can no longer be asserted per request. Each requested role maps to a credential
 * that genuinely holds only that role; anything else falls back to the admin client, which
 * is what the majority of specs need in order to reach the behaviour under test.
 */
export function managementHeaders(
  principalId: string,
  roles: string[] = [],
): Record<string, string> {
  if (principalId === 'e2e.author') return headersFor('author');
  if (principalId === 'e2e.qa-approver') return headersFor('qaAnalyst');
  if (principalId === 'e2e.risk-approver') return headersFor('riskApprover');
  if (principalId === 'e2e.platform-admin') return headersFor('platformAdmin');
  if (principalId === 'e2e.artifact-creator') return headersFor('artifactCreator');
  if (roles.includes('AUDITOR')) return headersFor('auditor');
  if (roles.includes('PLATFORM_ADMIN')) return headersFor('platformAdmin');
  if (roles.includes('QA_ANALYST')) return headersFor('qaAnalyst');
  if (roles.includes('RISK_ANALYST')) return headersFor('riskAnalyst');
  if (roles.includes('FRAUD_ANALYST')) return headersFor('fraudAnalyst');
  if (roles.includes('RISK_APPROVER')) return headersFor('riskApprover');
  return headersFor('admin');
}

/**
 * La credencial que da de alta artefactos. Sólo PLATFORM_ADMIN crea: el resto de roles con
 * acceso consulta el inventario y propone cambios sobre lo que ya existe.
 */
export function artifactCreatorHeaders(): Record<string, string> {
  return headersFor('artifactCreator');
}

export function runtimeHeaders(_principalId: string): Record<string, string> {
  return headersFor('runtime');
}
