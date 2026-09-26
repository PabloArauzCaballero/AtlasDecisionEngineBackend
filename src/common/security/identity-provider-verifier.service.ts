/** Converts trusted provider profiles to ATLAS claims and rejects malformed authority data. */
import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { DomainException } from '../errors/domain-exception';
import { IdentityProviderClient } from './identity-provider.client';
import { mapIdentityRoles } from './identity-role-mapper';

export interface VerifiedIdentityPrincipal {
  subject: string;
  tenantId: bigint;
  roles: string[];
}

/**
 * Upper bound on cached tokens.
 *
 * The cache is keyed by token, so its size follows the number of distinct
 * sessions in flight, not the request rate. A few thousand entries is far more
 * than any deployment holds inside a ten-second window; the cap exists so a
 * pathological caller minting tokens cannot grow the map without limit.
 */
const MAX_ENTRIES = 5_000;

interface CachedIdentity {
  principal: VerifiedIdentityPrincipal;
  expiresAtMs: number;
}

@Injectable()
export class IdentityProviderVerifierService {
  /**
   * Verified tokens, in process and nowhere else.
   *
   * Not Redis on purpose. This holds the answer to "is this credential good?",
   * and a shared store would widen where that answer can be read or tampered
   * with for no gain: each instance revalidating once per window is already
   * cheap. In process it also dies with the process, which is the behaviour
   * anyone would expect from a cache of credentials.
   *
   * Keyed by a digest of the token, never the token: a heap dump or an
   * accidental log of these keys must not hand anyone a working credential.
   */
  private readonly verified = new Map<string, CachedIdentity>();

  constructor(
    private readonly identityProvider: IdentityProviderClient,
    private readonly config: ConfigService,
  ) {}

  async verify(accessToken: string): Promise<VerifiedIdentityPrincipal> {
    const ttlMs = (this.config.get<number>('IDENTITY_PROVIDER_CACHE_TTL_SECONDS') ?? 10) * 1_000;
    const key = ttlMs > 0 ? digest(accessToken) : '';

    if (ttlMs > 0) {
      const hit = this.verified.get(key);
      if (hit !== undefined && hit.expiresAtMs > Date.now()) {
        // Copiada, no compartida: quien la reciba no debe poder añadirse un rol
        // en el arreglo y que el siguiente request lo herede.
        return { ...hit.principal, roles: [...hit.principal.roles] };
      }
      // Vencida: se retira aquí para que un token que dejó de usarse no ocupe
      // sitio hasta que la poda lo alcance.
      if (hit !== undefined) this.verified.delete(key);
    }

    const profile = await this.identityProvider.profile(accessToken);
    const roles = mapIdentityRoles([...profile.user.roles, ...profile.user.legacyRoles]);
    if (!roles.length) {
      throw new DomainException(
        'FORBIDDEN',
        'The identity has no Decision Engine role',
        HttpStatus.FORBIDDEN,
      );
    }
    const principal: VerifiedIdentityPrincipal = {
      subject: profile.user.id,
      tenantId: BigInt(profile.user.tenantId),
      roles,
    };

    /*
     * Sólo se guarda el ÉXITO, y esa asimetría es el diseño.
     *
     * Cachear un rechazo hace daño en las dos direcciones: un 503 guardado
     * alarga una caída del proveedor más allá de la caída misma, y un 401
     * guardado seguiría rechazando un token que acaba de volverse válido. El
     * coste de no cachearlos es volver a preguntar, que es exactamente lo que
     * hay que hacer cuando la respuesta anterior fue «no».
     */
    if (ttlMs > 0) {
      this.prune();
      this.verified.set(key, { principal, expiresAtMs: Date.now() + ttlMs });
    }
    return { ...principal, roles: [...principal.roles] };
  }

  /**
   * Retira lo vencido y, si aun así se llegó al tope, lo más antiguo.
   *
   * `Map` conserva el orden de inserción, así que la primera clave es la más
   * vieja. Se prefiere tirar una entrada válida antes que crecer sin límite:
   * perderla sólo cuesta una verificación más.
   */
  private prune(): void {
    const now = Date.now();
    for (const [key, entry] of this.verified) {
      if (entry.expiresAtMs <= now) this.verified.delete(key);
    }
    while (this.verified.size >= MAX_ENTRIES) {
      const oldest = this.verified.keys().next();
      if (oldest.done === true) break;
      this.verified.delete(oldest.value);
    }
  }
}

function digest(accessToken: string): string {
  return createHash('sha256').update(accessToken).digest('hex');
}
