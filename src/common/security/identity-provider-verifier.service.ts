import { HttpStatus, Injectable } from '@nestjs/common';
import { DomainException } from '../errors/domain-exception';
import { IdentityProviderClient } from './identity-provider.client';
import { mapIdentityRoles } from './identity-role-mapper';

export interface VerifiedIdentityPrincipal {
  subject: string;
  tenantId: bigint;
  roles: string[];
}

@Injectable()
export class IdentityProviderVerifierService {
  constructor(private readonly identityProvider: IdentityProviderClient) {}

  async verify(accessToken: string): Promise<VerifiedIdentityPrincipal> {
    const profile = await this.identityProvider.profile(accessToken);
    const roles = mapIdentityRoles([...profile.user.roles, ...profile.user.legacyRoles]);
    if (!roles.length) {
      throw new DomainException(
        'FORBIDDEN',
        'The identity has no Decision Engine role',
        HttpStatus.FORBIDDEN,
      );
    }
    return {
      subject: profile.user.id,
      tenantId: BigInt(profile.user.tenantId),
      roles,
    };
  }
}
