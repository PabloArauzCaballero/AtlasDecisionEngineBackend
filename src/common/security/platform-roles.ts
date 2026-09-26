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

/**
 * Rol de la audiencia `runtime`, deliberadamente FUERA de `PlatformRole`.
 *
 * Lo llevan las credenciales que sólo ejecutan decisiones en producción — el seed lo asigna
 * por defecto (`integration-clients.ts`) y `.env.example` lo documenta en
 * `BOOTSTRAP_RUNTIME_ROLES`. Vivía como literal suelto en la semilla y en el arnés e2e, sin
 * pasar por este fichero: exactamente la deriva que el comentario de arriba dice que hay que
 * evitar.
 *
 * No se mete en `PlatformRole` a propósito. `PLATFORM_ROLES` se expande con `@Roles(...)` en
 * rutas de gestión (las notificaciones, por ejemplo), así que añadirlo ahí le daría a una
 * credencial de ejecución acceso al plano de gestión. Son dos planos distintos y el tipo lo
 * refleja.
 */
export const RUNTIME_DECISION_ROLE = 'DECISION_RUNTIME';

export type RuntimeRole = typeof RUNTIME_DECISION_ROLE;

/**
 * Todo lo que `@Roles(...)` acepta: los roles de gestión más el de ejecución.
 *
 * Sigue siendo una unión cerrada, que es lo que hace que un nombre mal escrito sea un error
 * de compilación y no una ruta que ninguna identidad puede satisfacer.
 */
export type AuthorizationRole = PlatformRole | RuntimeRole;

/** Narrows an arbitrary string to a canonical platform role. */
export function isPlatformRole(value: string): value is PlatformRole {
  return (PLATFORM_ROLES as readonly string[]).includes(value);
}
