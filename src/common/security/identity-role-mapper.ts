const DIRECT_ROLES = new Set([
  'PLATFORM_ADMIN',
  'RISK_ANALYST',
  'FRAUD_ANALYST',
  'QA_ANALYST',
  'RISK_APPROVER',
  'COMPLIANCE',
  'AUDITOR',
  'OPERATIONS',
]);

const ROLE_ALIASES: Readonly<Record<string, readonly string[]>> = {
  SUPER_ADMIN: ['PLATFORM_ADMIN'],
  SYSTEMS_ADMIN: ['PLATFORM_ADMIN'],
  INTERNAL_IDENTITY_ADMIN: ['PLATFORM_ADMIN'],
  COMPLIANCE_ANALYST: ['COMPLIANCE'],
  QA_ENGINEER: ['QA_ANALYST'],
  READONLY_AUDITOR: ['AUDITOR'],
  OPS_MANAGER: ['OPERATIONS'],
  OPERATIONS_AGENT: ['OPERATIONS'],
  SUPPORT_AGENT: ['OPERATIONS'],
  INTERNAL_OPERATOR: ['OPERATIONS'],
};

export function mapIdentityRoles(roleCodes: readonly string[]): string[] {
  const mapped = new Set<string>();
  for (const value of roleCodes) {
    const normalized = value.trim().toUpperCase();
    if (!normalized) continue;
    if (DIRECT_ROLES.has(normalized)) mapped.add(normalized);
    for (const alias of ROLE_ALIASES[normalized] ?? []) mapped.add(alias);
  }
  return [...mapped];
}
