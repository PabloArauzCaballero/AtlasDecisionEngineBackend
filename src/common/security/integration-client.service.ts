import { HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { HashService } from '../crypto/hash.service';
import { DomainException } from '../errors/domain-exception';
import type { ApiAudience } from './security.types';

/** Identity and authorization data loaded from the integration client registry. */
export interface ResolvedIntegrationClient {
  /** Stable machine identity written to audit records. */
  clientKey: string;
  /** Explicit route roles granted to the client. */
  roles: string[];
  /** Tenants the credential may select. */
  tenantIds: bigint[];
}

/**
 * Resolves a presented API key into the identity the registry recorded for it.
 *
 * The secret is the only caller-supplied input that participates: roles come from
 * integration_scope and the permitted tenants from integration_tenant_access, so a
 * key holder cannot widen its own authority by sending different headers.
 */
@Injectable()
export class IntegrationClientService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hashes: HashService,
  ) {}

  /**
   * Resolves an active credential for the requested audience.
   *
   * @throws DomainException with an opaque 401 for unknown, inactive, expired or
   * audience-mismatched credentials.
   */
  async resolve(secret: string, audience: ApiAudience): Promise<ResolvedIntegrationClient> {
    const credential = await this.prisma.integrationCredential.findUnique({
      where: { secretHash: this.hashes.sha256(secret) },
      include: { client: { include: { scopes: true, tenantAccess: true } } },
    });

    // Every rejection below is deliberately the same opaque 401: distinguishing
    // "unknown key" from "revoked key" or "wrong audience" would tell a caller
    // probing keys which of its guesses named a real client.
    if (!credential) throw this.unauthorized();
    if (credential.status !== 'ACTIVE') throw this.unauthorized();
    if (credential.expiresAt && credential.expiresAt.getTime() <= Date.now()) throw this.unauthorized();

    const client = credential.client;
    if (client.status !== 'ACTIVE') throw this.unauthorized();
    if (client.audience !== audience) throw this.unauthorized();

    const tenantIds = client.tenantAccess.map((access) => access.tenantId);
    if (!tenantIds.length) throw this.unauthorized();

    // Best-effort usage tracking: a failure to record last use must not deny an
    // otherwise valid caller, and it is outside the request's business transaction.
    void this.prisma.integrationCredential
      .update({ where: { id: credential.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);

    return {
      clientKey: client.clientKey,
      roles: [...new Set(client.scopes.map((scope) => scope.scope.toUpperCase()))],
      tenantIds,
    };
  }

  private unauthorized(): DomainException {
    return new DomainException('UNAUTHORIZED', 'Invalid API key', HttpStatus.UNAUTHORIZED);
  }
}
