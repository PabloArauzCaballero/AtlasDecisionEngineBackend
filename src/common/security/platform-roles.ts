/**
 * Canonical platform authorization roles — the single source of truth.
 *
 * Route guards, the identity role mapper, the segregation-of-duties approval steps and
 * the bootstrap seed all refer here rather than repeating string literals. In a
 * governance engine a divergent role name is not a typo: an approval step that requires
 * a role no identity can ever be granted silently becomes unsatisfiable, and a guard
 * that checks the wrong wildcard is an authorization hole. Centralising the names lets
 * the type checker catch that class of drift.
 */
export const PlatformRole = {
  /** Global wildcard — honoured only on signed IdP identities, never on API keys. */
  PLATFORM_ADMIN: 'PLATFORM_ADMIN',
  RISK_ANALYST: 'RISK_ANALYST',
  FRAUD_ANALYST: 'FRAUD_ANALYST',
  QA_ANALYST: 'QA_ANALYST',
  RISK_APPROVER: 'RISK_APPROVER',
  COMPLIANCE: 'COMPLIANCE',
  AUDITOR: 'AUDITOR',
  OPERATIONS: 'OPERATIONS',
} as const;

export type PlatformRole = (typeof PlatformRole)[keyof typeof PlatformRole];

/** Every directly-assignable platform role; identity aliases resolve into these. */
export const PLATFORM_ROLES: readonly PlatformRole[] = Object.values(PlatformRole);

/** Narrows an arbitrary string to a canonical platform role. */
export function isPlatformRole(value: string): value is PlatformRole {
  return (PLATFORM_ROLES as readonly string[]).includes(value);
}
