import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { HashService } from '../src/common/crypto/hash.service';
import { AuditQueryService } from '../src/modules/audit-query/audit-query.service';
import { PostgresDecisionAuditReadAdapter } from '../src/modules/audit-query/adapters/postgres-decision-audit-read.adapter';
import { directReadAdapterFactory } from './support/read-adapter';
import { uniqueTenantId } from './support/unique-tenant';

/**
 * Regression: listAuditEvents used to filter DecisionAuditEvent by a
 * non-existent `createdAt` column, so any from/to query threw PrismaClientValidationError.
 * This exercises the query against a real database with a date window.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

describeDb('AuditQueryService date filtering (integration)', () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL }) });
  const hashes = new HashService(new ConfigService({ AUDIT_HASH_SECRET: 'test-secret' }));
  const service = new AuditQueryService(
    new PostgresDecisionAuditReadAdapter(directReadAdapterFactory(prisma)),
    hashes,
    new ConfigService({ MAX_PAGE_SIZE: 100 }),
  );
  // The audit table is append-only at the database level, so this run cannot clean up
  // after itself and must not see rows written by a previous one: it uses its own tenant.
  const tenantId = uniqueTenantId(5);

  beforeAll(async () => {
    await prisma.decisionAuditEvent.create({
      data: {
        tenantId,
        eventType: 'TEST_EVENT',
        aggregateType: 'TEST',
        aggregateId: '1',
        actorId: 'tester',
        payloadJson: {},
        eventHash: 'deadbeef',
        occurredAt: new Date('2026-07-15T12:00:00.000Z'),
      },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('returns events within a from/to window without throwing', async () => {
    const result = await service.listAuditEvents(tenantId, {
      from: '2026-07-15T00:00:00.000Z',
      to: '2026-07-16T00:00:00.000Z',
      page: 1,
      pageSize: 10,
    });

    expect(result.total).toBe(1);
    expect(result.items).toHaveLength(1);
  });

  it('excludes events outside the window', async () => {
    const result = await service.listAuditEvents(tenantId, {
      from: '2026-07-16T00:00:00.000Z',
      to: '2026-07-17T00:00:00.000Z',
      page: 1,
      pageSize: 10,
    });

    expect(result.total).toBe(0);
  });
});
