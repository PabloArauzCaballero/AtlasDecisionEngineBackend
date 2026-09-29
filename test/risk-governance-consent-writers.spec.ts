/**
 * Los permisos del titular se escriben en Atlas Core; el motor sólo recibe su réplica.
 *
 * Core replica altas y revocaciones con su credencial de gobierno (una API key). Una persona con
 * sesión en el portal del motor ya no puede registrar ni revocar a mano: sería un segundo lugar
 * donde cambia la licitud, que Core no conoce y que su réplica siguiente podría contradecir. La
 * consulta sigue abierta a los mismos roles de antes.
 */
import 'reflect-metadata';
import { DomainException } from '../src/common/errors/domain-exception';
import { REQUIRED_ROLES } from '../src/common/security/security.decorators';
import type { AuthenticatedPrincipal } from '../src/common/security/security.types';
import { RiskGovernanceController } from '../src/modules/risk-governance/risk-governance.controller';
import type { RiskGovernanceService } from '../src/modules/risk-governance/risk-governance.service';

const TENANT = 1n;

// Principales fijos, uno por canal: una persona con sesión (dos mecanismos), un administrador con
// sesión y la réplica de Core, que llega con API key.
const PERSONA_JWT = {
  id: 'persona',
  roles: ['COMPLIANCE'],
  authMethod: 'jwt',
  requestId: 'req-1',
} as unknown as AuthenticatedPrincipal;
const PERSONA_IDP = {
  id: 'persona',
  roles: ['COMPLIANCE'],
  authMethod: 'identity_provider',
  requestId: 'req-1',
} as unknown as AuthenticatedPrincipal;
const ADMIN_CON_SESION = {
  id: 'admin',
  roles: ['PLATFORM_ADMIN'],
  authMethod: 'jwt',
  requestId: 'req-1',
} as unknown as AuthenticatedPrincipal;
const REPLICA_DE_CORE = {
  id: 'atlas-core',
  roles: ['COMPLIANCE'],
  authMethod: 'api_key',
  requestId: 'req-1',
} as unknown as AuthenticatedPrincipal;

function controller() {
  const calls: string[] = [];
  const service = {
    recordConsent: () => {
      calls.push('record');
      return Promise.resolve({ id: '1' });
    },
    revokeConsent: () => {
      calls.push('revoke');
      return Promise.resolve({ id: '1' });
    },
    consentsOf: () => {
      calls.push('lookup');
      return Promise.resolve({ items: [] });
    },
  } as unknown as RiskGovernanceService;
  const ctor = RiskGovernanceController as unknown as new (
    ...args: unknown[]
  ) => RiskGovernanceController;
  return { api: new ctor(service), calls };
}

const grant = {
  subjectReference: 'sujeto',
  purpose: 'credit_bureau_query',
  basis: 'CONSENT',
  grantedAt: '2026-09-01T00:00:00.000Z',
};
const revoke = { subjectReference: 'sujeto', purpose: 'credit_bureau_query' };

function errorOf(run: () => unknown): DomainException | null {
  try {
    run();
    return null;
  } catch (caught) {
    return caught as DomainException;
  }
}

describe('RiskGovernanceController · quién escribe consentimientos', () => {
  it.each([
    ['jwt', PERSONA_JWT],
    ['identity_provider', PERSONA_IDP],
  ] as const)(
    'una sesión de persona (%s) NO registra un permiso: 403 y el servicio no se llama',
    (_via, persona) => {
      const { api, calls } = controller();
      const error = errorOf(() => api.recordConsent(TENANT, persona, grant as never));
      expect(error?.code).toBe('CONSENT_WRITE_MACHINE_ONLY');
      expect(error?.status).toBe(403);
      expect(calls).toEqual([]);
    },
  );

  it.each([
    ['jwt', PERSONA_JWT],
    ['identity_provider', PERSONA_IDP],
  ] as const)('una sesión de persona (%s) NO revoca: se revoca en Core', (_via, persona) => {
    const { api, calls } = controller();
    const error = errorOf(() => api.revokeConsent(TENANT, persona, revoke as never));
    expect(error?.code).toBe('CONSENT_WRITE_MACHINE_ONLY');
    expect(calls).toEqual([]);
  });

  it('ni siquiera PLATFORM_ADMIN con sesión escribe: no es cuestión de rol, es de canal', () => {
    const { api, calls } = controller();
    const error = errorOf(() => api.revokeConsent(TENANT, ADMIN_CON_SESION, revoke as never));
    expect(error?.code).toBe('CONSENT_WRITE_MACHINE_ONLY');
    expect(calls).toEqual([]);
  });

  it('la réplica de Core (API key) registra y revoca', async () => {
    const { api, calls } = controller();
    await api.recordConsent(TENANT, REPLICA_DE_CORE, grant as never);
    await api.revokeConsent(TENANT, REPLICA_DE_CORE, revoke as never);
    expect(calls).toEqual(['record', 'revoke']);
  });

  it('la consulta no cambia: personas de COMPLIANCE, OPERATIONS y AUDITOR leen', async () => {
    const { api, calls } = controller();
    await api.consents(TENANT, revoke as never);
    expect(calls).toEqual(['lookup']);
    const roles = Reflect.getMetadata(
      REQUIRED_ROLES,
      RiskGovernanceController.prototype.consents as object,
    ) as string[];
    expect([...roles].sort()).toEqual(['AUDITOR', 'COMPLIANCE', 'OPERATIONS']);
  });
});
