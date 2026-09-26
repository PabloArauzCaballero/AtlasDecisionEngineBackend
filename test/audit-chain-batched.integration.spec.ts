import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { AuditService } from '../src/common/audit/audit.service';
import { AuditQueryService } from '../src/modules/audit-query/audit-query.service';
import { PostgresDecisionAuditReadAdapter } from '../src/modules/audit-query/adapters/postgres-decision-audit-read.adapter';
import { directReadAdapterFactory } from './support/read-adapter';
import { HashService } from '../src/common/crypto/hash.service';
import type { PrismaService } from '../src/common/prisma/prisma.service';
import { uniqueTenantId } from './support/unique-tenant';

/**
 * P1 (plan §10 audit-chain-verifier): the chain must be verified in bounded batches, not by
 * loading the whole tenant chain into memory. This exercises a chain longer than the batch
 * size, so the running previousHash has to thread correctly across batch boundaries.
 */
const DATABASE_URL = process.env.ADMIN_DATABASE_URL ?? process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

describeDb('Audit chain batched verification (integration)', () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL }) });
  const hashes = new HashService(
    new ConfigService({ AUDIT_HASH_SECRET: 'audit-secret-with-at-least-32-characters!!' }),
  );
  const audit = new AuditService(prisma as unknown as PrismaService, hashes);
  // Batch size 2 forces multiple batches over a 5-event chain.
  const query = new AuditQueryService(
    new PostgresDecisionAuditReadAdapter(directReadAdapterFactory(prisma)),
    hashes,
    new ConfigService({ MAX_PAGE_SIZE: 100, AUDIT_VERIFY_BATCH_SIZE: 2 }),
  );
  const tenantId = uniqueTenantId(2);
  const EVENTS = 5;

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('verifies a chain that spans several batches as valid', async () => {
    for (let i = 0; i < EVENTS; i += 1) {
      await audit.append({
        tenantId,
        eventType: `BATCH_${i}`,
        aggregateType: 'Test',
        aggregateId: String(i),
        actorId: 'tester',
        payload: { index: i },
      });
    }

    const result = await query.verifyAuditChain(tenantId);
    expect(result.eventCount).toBe(EVENTS); // counted across batches
    expect(result.valid).toBe(true);
    expect(result.invalid).toEqual([]);
    expect(result.headHash).toBeTruthy();
  });

  it('reports an empty chain as valid with no events', async () => {
    const emptyTenant = tenantId + 1n;
    const result = await query.verifyAuditChain(emptyTenant);
    expect(result.eventCount).toBe(0);
    expect(result.valid).toBe(true);
    expect(result.headHash).toBeNull();
  });
});
