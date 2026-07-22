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
});
