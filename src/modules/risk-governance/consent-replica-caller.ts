import { HttpStatus } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain-exception';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';

/**
 * Los permisos del titular se ESCRIBEN en Atlas Core; aquí sólo llega su réplica.
 *
 * Core recoge el consentimiento, lo revoca y lo replica al motor por una cola duradera
 * (`decision_consent_replications` + trabajo `sync_engine_consents`) con su credencial de
 * gobierno, que es una API key. Una persona con sesión en el portal del motor podía, además,
 * dar de alta o revocar a mano: un segundo sitio donde cambia la licitud, que Core no conocía y
 * que su réplica siguiente podía contradecir. Por eso la escritura exige una credencial de
 * máquina (API key) además del rol; las personas consultan (`consents/lookup`) y revocan en
 * Core (Portal admin ▸ Proveedores externos ▸ Datos del cliente).
 */
export function assertConsentReplicaCaller(principal: AuthenticatedPrincipal): void {
  if (principal.authMethod === 'api_key') return;
  throw new DomainException(
    'CONSENT_WRITE_MACHINE_ONLY',
    'Los consentimientos se registran y se revocan en Atlas Core; el motor sólo recibe su ' +
      'réplica. Desde una sesión de persona aquí sólo se consultan.',
    HttpStatus.FORBIDDEN,
  );
}
