import {
  PlatformRole,
  PLATFORM_ROLES,
  isPlatformRole,
} from '../src/common/security/platform-roles';
import { mapIdentityRoles } from '../src/common/security/identity-role-mapper';

/**
 * Pins the single source of truth for authorization roles. Its value is catching drift:
 * an alias, an SoD approval step or the bootstrap seed pointing at a role name no
 * identity can hold is an unsatisfiable authorization rule, not a harmless typo.
 */
describe('Platform role canon', () => {
  it('exposes a duplicate-free set matching the PlatformRole map', () => {
    expect(new Set(PLATFORM_ROLES).size).toBe(PLATFORM_ROLES.length);
    expect([...PLATFORM_ROLES].sort()).toEqual(Object.values(PlatformRole).sort());
  });

  it('recognises only canonical role names', () => {
    expect(isPlatformRole(PlatformRole.RISK_APPROVER)).toBe(true);
    // The demo seed's approver taxonomy (QA_APPROVER, COMPLIANCE_APPROVER) is
    // deliberately outside the enforced role canon.
    expect(isPlatformRole('QA_APPROVER')).toBe(false);
    expect(isPlatformRole('')).toBe(false);
  });

  it('maps every identity role and alias into canonical roles only', () => {
    const mapped = mapIdentityRoles([
      'super_admin',
      'compliance_analyst',
      'qa_engineer',
      'ops_manager',
      'RISK_ANALYST',
      'unknown-role',
    ]);

    expect(mapped.length).toBeGreaterThan(0);
    for (const role of mapped) expect(isPlatformRole(role)).toBe(true);
    expect(mapped).toEqual(
      expect.arrayContaining([
        PlatformRole.PLATFORM_ADMIN,
        PlatformRole.COMPLIANCE,
        PlatformRole.QA_ANALYST,
        PlatformRole.OPERATIONS,
        PlatformRole.RISK_ANALYST,
      ]),
    );
    expect(mapped).not.toContain('UNKNOWN-ROLE');
  });

  it('keeps the segregation-of-duties approval roles within the canon', () => {
    // Mirrors GovernanceService.requestApproval steps; a PlatformRole rename that
    // forgets one of these is caught here rather than at runtime as a dead approval step.
    for (const role of [
      PlatformRole.QA_ANALYST,
      PlatformRole.RISK_APPROVER,
      PlatformRole.COMPLIANCE,
    ]) {
      expect(isPlatformRole(role)).toBe(true);
    }
  });

  it('ningún cargo de Core que trabaja en el Motor llega sin rol', () => {
    // Antes de 2026-10-08 estos cargos entraban con cero roles y veían el portal vacío.
    for (const code of ['OPERATIONS_MANAGER', 'OPERATIONS_ANALYST', 'MERCHANT_OPERATIONS']) {
      expect(mapIdentityRoles([code])).toEqual([PlatformRole.OPERATIONS]);
    }
    for (const code of [
      'FINANCE_MANAGER',
      'EXECUTIVE_READONLY',
      'DATA_GOVERNANCE_MANAGER',
      'DATA_QUALITY_ANALYST',
    ]) {
      expect(mapIdentityRoles([code])).toEqual([PlatformRole.AUDITOR]);
    }
    // Cobranza no tiene nada que hacer en el Motor: sigue sin rol a propósito.
    expect(mapIdentityRoles(['COLLECTIONS_AGENT', 'COLLECTIONS_MANAGER'])).toEqual([]);
  });

  it('los roles de Core que firman gobierno llegan al Motor', () => {
    // Sin RISK_MANAGER → RISK_APPROVER nadie podía firmar el paso 2 de una aprobación.
    expect(mapIdentityRoles(['RISK_MANAGER'])).toEqual([PlatformRole.RISK_APPROVER]);
    expect(mapIdentityRoles(['QA_ENGINEER'])).toEqual([PlatformRole.QA_ANALYST]);
    expect(mapIdentityRoles(['AUDITOR_READONLY'])).toEqual([PlatformRole.AUDITOR]);
    expect(mapIdentityRoles(['COMPLIANCE_MANAGER'])).toEqual([PlatformRole.COMPLIANCE]);
    // Un super admin administra la plataforma, pero no firma por otros.
    expect(mapIdentityRoles(['SUPER_ADMIN'])).toEqual([PlatformRole.PLATFORM_ADMIN]);
  });
});
