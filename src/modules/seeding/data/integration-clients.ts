import type { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
// A plain constant array, not a Nest provider, so importing it keeps the seed's
// no-framework boundary intact while pinning the roles to the same source of truth the
// guard and mapper use.
import { PLATFORM_ROLES, RUNTIME_DECISION_ROLE } from '../../../common/security/platform-roles';

export interface BootstrapClientSummary {
  clientKey: string;
  audience: string;
  roles: string[];
  tenantIds: string[];
}

/** Mirrors HashService.sha256 for plain strings; the seed must not import Nest providers. */
function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function parseList(value: string | undefined, fallback: string[]): string[] {
  const parsed = (value ?? '')
    .split(',')
    .map((entry) => entry.trim().toUpperCase())
    .filter(Boolean);
  return parsed.length ? parsed : fallback;
}

/**
 * Registers the bootstrap API clients declared through environment variables.
 *
 * Identity for API key callers lives in the database, so without this step a fresh
 * API-key installation has no registered callers. Roles come from explicit operator
 * configuration rather than request headers.
 *
 * Idempotent by client key, so running the seed twice converges on the same state.
 */
export async function seedIntegrationClients(
  prisma: PrismaClient,
): Promise<BootstrapClientSummary[]> {
  const tenantId = BigInt(process.env.BOOTSTRAP_TENANT_ID ?? '1');
  const definitions = [
    {
      clientKey: 'bootstrap-management',
      displayName: 'Bootstrap management client',
      audience: 'management',
      secret: process.env.MANAGEMENT_API_KEY,
      // PLATFORM_ADMIN as a wildcard is only honoured on signed tokens, so the
      // bootstrap API key is granted every enforced management role explicitly instead —
      // otherwise a fresh install could not administer anything before the IdP is wired up.
      roles: parseList(process.env.BOOTSTRAP_MANAGEMENT_ROLES, [...PLATFORM_ROLES]),
    },
    {
      clientKey: 'bootstrap-runtime',
      displayName: 'Bootstrap runtime client',
      audience: 'runtime',
      secret: process.env.RUNTIME_API_KEY,
      roles: parseList(process.env.BOOTSTRAP_RUNTIME_ROLES, [RUNTIME_DECISION_ROLE]),
    },
  ];

  const summaries: BootstrapClientSummary[] = [];
  for (const definition of definitions) {
    if (!definition.secret) continue;

    const client = await prisma.integrationClient.upsert({
      where: { clientKey: definition.clientKey },
      create: {
        clientKey: definition.clientKey,
        displayName: definition.displayName,
        audience: definition.audience,
        status: 'ACTIVE',
      },
      update: {
        displayName: definition.displayName,
        audience: definition.audience,
        status: 'ACTIVE',
      },
    });

    // Scopes and tenant access are replaced wholesale so that removing a role from
    // configuration actually withdraws it instead of leaving a stale grant behind.
    await prisma.integrationScope.deleteMany({
      where: { clientId: client.id, scope: { notIn: definition.roles } },
    });
    for (const scope of definition.roles) {
      await prisma.integrationScope.upsert({
        where: { clientId_scope: { clientId: client.id, scope } },
        create: { clientId: client.id, scope },
        update: {},
      });
    }

    await prisma.integrationTenantAccess.deleteMany({
      where: { clientId: client.id, tenantId: { not: tenantId } },
    });
    await prisma.integrationTenantAccess.upsert({
      where: { clientId_tenantId: { clientId: client.id, tenantId } },
      create: { clientId: client.id, tenantId },
      update: {},
    });

    const secretHash = sha256(definition.secret);
    const existing = await prisma.integrationCredential.findUnique({ where: { secretHash } });
    if (!existing) {
      // Rotating the configured secret must not leave the previous one usable.
      await prisma.integrationCredential.deleteMany({ where: { clientId: client.id } });
      await prisma.integrationCredential.create({
        data: { clientId: client.id, secretHash, label: 'bootstrap', status: 'ACTIVE' },
      });
    } else if (existing.status !== 'ACTIVE') {
      await prisma.integrationCredential.update({
        where: { id: existing.id },
        data: { status: 'ACTIVE', revokedAt: null },
      });
    }

    summaries.push({
      clientKey: definition.clientKey,
      audience: definition.audience,
      roles: definition.roles,
      tenantIds: [tenantId.toString()],
    });
  }

  return summaries;
}
