import { HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { HashService } from '../crypto/hash.service';
import { DomainException } from '../errors/domain-exception';
import type { ApiAudience } from './security.types';

/**
 * Skip the `lastUsedAt` write unless the recorded timestamp is older than this. The
 * column drives operational "last seen" reporting, not authorization, so second-level
 * precision buys nothing while a write on every authenticated request amplifies load on
 * the runtime hot path. Throttling collapses a per-request write to one per window.
 */
const LAST_USED_THROTTLE_MS = 5 * 60 * 1_000;

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
    if (credential.expiresAt && credential.expiresAt.getTime() <= Date.now())
      throw this.unauthorized();

    const client = credential.client;
    if (client.status !== 'ACTIVE') throw this.unauthorized();
    if (client.audience !== audience) throw this.unauthorized();

    const tenantIds = client.tenantAccess.map((access) => access.tenantId);
    if (!tenantIds.length) throw this.unauthorized();

    // Best-effort usage tracking: a failure to record last use must not deny an
    // otherwise valid caller, and it is outside the request's business transaction.
    // Throttled so a busy credential does not issue a write on every request; the
    // guard on lastUsedAt keeps concurrent requests in the same window from stacking
    // redundant updates (a slightly stale timestamp is acceptable, a lost write is not).
    const now = Date.now();
    const lastUsedMs = credential.lastUsedAt?.getTime() ?? 0;
    if (now - lastUsedMs >= LAST_USED_THROTTLE_MS) {
      void this.prisma.integrationCredential
        .updateMany({
          where: {
            id: credential.id,
            OR: [
              { lastUsedAt: null },
              { lastUsedAt: { lt: new Date(now - LAST_USED_THROTTLE_MS) } },
            ],
          },
          data: { lastUsedAt: new Date(now) },
        })
        .catch(() => undefined);
    }

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
