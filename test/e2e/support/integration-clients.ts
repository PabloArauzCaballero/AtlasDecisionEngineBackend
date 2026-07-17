import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';

export const TENANT_ID = '1';

/**
 * Role-scoped credentials for e2e runs.
 *
 * Roles used to be asserted by the caller through x-roles, so a single key could
 * impersonate any role and the negative authorization tests were satisfied by simply
 * sending a weaker header. Now that roles live in the registry, exercising
 * "this role may not do that" requires a credential that genuinely holds only that role.
 */
// PLATFORM_ADMIN as a wildcard is only honoured on signed tokens. API-key clients may
// still hold PLATFORM_ADMIN as the specific role required by deployment routes.
const ALL_MANAGEMENT_ROLES = [
  'AUDITOR',
  'COMPLIANCE',
  'FRAUD_ANALYST',
  'OPERATIONS',
  'PLATFORM_ADMIN',
  'QA_ANALYST',
  'RISK_ANALYST',
  'RISK_APPROVER',
];

export const E2E_CLIENTS = {
  admin: { clientKey: 'e2e-admin', secret: 'e2e-admin-secret-0123456789abcdef', audience: 'management', roles: ALL_MANAGEMENT_ROLES },
  author: { clientKey: 'e2e-author', secret: 'e2e-author-secret-0123456789abcdef', audience: 'management', roles: ['RISK_ANALYST', 'QA_ANALYST'] },
  auditor: { clientKey: 'e2e-auditor', secret: 'e2e-auditor-secret-0123456789abcdef', audience: 'management', roles: ['AUDITOR'] },
  platformAdmin: { clientKey: 'e2e-platform-admin', secret: 'e2e-platform-admin-secret-0123456789abcdef', audience: 'management', roles: ['PLATFORM_ADMIN'] },
  qaAnalyst: { clientKey: 'e2e-qa', secret: 'e2e-qa-secret-0123456789abcdef', audience: 'management', roles: ['QA_ANALYST'] },
  riskAnalyst: { clientKey: 'e2e-risk', secret: 'e2e-risk-secret-0123456789abcdef', audience: 'management', roles: ['RISK_ANALYST'] },
  riskApprover: { clientKey: 'e2e-risk-approver', secret: 'e2e-risk-approver-secret-0123456789abcdef', audience: 'management', roles: ['RISK_APPROVER'] },
  runtime: { clientKey: 'e2e-runtime', secret: 'e2e-runtime-secret-0123456789abcdef', audience: 'runtime', roles: ['DECISION_RUNTIME'] },
} as const;

export type E2eClientName = keyof typeof E2E_CLIENTS;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export async function provisionE2eClients(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required to provision e2e integration clients');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  try {
    for (const definition of Object.values(E2E_CLIENTS)) {
      await prisma.integrationClient.deleteMany({ where: { clientKey: definition.clientKey } });
      await prisma.integrationClient.create({
        data: {
          clientKey: definition.clientKey,
          displayName: `E2E ${definition.clientKey}`,
          audience: definition.audience,
          status: 'ACTIVE',
          scopes: { create: definition.roles.map((scope) => ({ scope })) },
          tenantAccess: { create: [{ tenantId: BigInt(TENANT_ID) }] },
          credentials: { create: [{ secretHash: sha256(definition.secret), label: 'e2e' }] },
        },
      });
    }
  } finally {
    await prisma.$disconnect();
  }
}

export function headersFor(name: E2eClientName): Record<string, string> {
  return { 'x-api-key': E2E_CLIENTS[name].secret, 'x-tenant-id': TENANT_ID };
}
