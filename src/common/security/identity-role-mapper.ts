import { PlatformRole, PLATFORM_ROLES } from './platform-roles';

const DIRECT_ROLES = new Set<string>(PLATFORM_ROLES);

const ROLE_ALIASES: Readonly<Record<string, readonly PlatformRole[]>> = {
  SUPER_ADMIN: [PlatformRole.PLATFORM_ADMIN],
  SYSTEMS_ADMIN: [PlatformRole.PLATFORM_ADMIN],
  INTERNAL_IDENTITY_ADMIN: [PlatformRole.PLATFORM_ADMIN],
  COMPLIANCE_ANALYST: [PlatformRole.COMPLIANCE],
  QA_ENGINEER: [PlatformRole.QA_ANALYST],
  READONLY_AUDITOR: [PlatformRole.AUDITOR],
  OPS_MANAGER: [PlatformRole.OPERATIONS],
  OPERATIONS_AGENT: [PlatformRole.OPERATIONS],
  SUPPORT_AGENT: [PlatformRole.OPERATIONS],
  INTERNAL_OPERATOR: [PlatformRole.OPERATIONS],
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
