/** Maps provider aliases into the closed platform role vocabulary; unknown roles grant nothing. */
import { PlatformRole, PLATFORM_ROLES } from './platform-roles';

const DIRECT_ROLES = new Set<string>(PLATFORM_ROLES);

/*
 * Las claves son los códigos de rol de AtlasBackend (`internal-rbac.roles.ts`), que es el
 * proveedor de identidad del portal. Hasta el 2026-09-29 ningún rol de Core llegaba como
 * RISK_APPROVER: «Jefatura de riesgo» (`RISK_MANAGER`) no estaba aquí y se descartaba, así
 * que el paso 2 de toda aprobación de gobierno era imposible de firmar y ninguna versión podía
 * desplegarse. Tampoco llegaban `AUDITOR_READONLY` (aquí se esperaba `READONLY_AUDITOR`) ni
 * `COMPLIANCE_MANAGER`.
 */
const ROLE_ALIASES: Readonly<Record<string, readonly PlatformRole[]>> = {
  SUPER_ADMIN: [PlatformRole.PLATFORM_ADMIN],
  SYSTEMS_ADMIN: [PlatformRole.PLATFORM_ADMIN],
  INTERNAL_IDENTITY_ADMIN: [PlatformRole.PLATFORM_ADMIN],
  COMPLIANCE_ANALYST: [PlatformRole.COMPLIANCE],
  COMPLIANCE_MANAGER: [PlatformRole.COMPLIANCE],
  RISK_MANAGER: [PlatformRole.RISK_APPROVER],
  QA_ENGINEER: [PlatformRole.QA_ANALYST],
  READONLY_AUDITOR: [PlatformRole.AUDITOR],
  AUDITOR_READONLY: [PlatformRole.AUDITOR],
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
