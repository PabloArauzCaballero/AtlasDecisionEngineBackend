import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { AuditService } from '../src/common/audit/audit.service';
import { HashService } from '../src/common/crypto/hash.service';
import type { PrismaService } from '../src/common/prisma/prisma.service';

/**
 * Audit must be atomic with the action it records. An event that commits on its own
 * can outlive a rolled-back change (evidence of something that never happened), or be lost
 * while the change commits (a change with no evidence).
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

describeDb('AuditService transactionality (integration)', () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL }) });
  const hashes = new HashService(new ConfigService({ AUDIT_HASH_SECRET: 'audit-secret-with-at-least-32-characters!!' }));
  const audit = new AuditService(prisma as unknown as PrismaService, hashes);
  const tenantId = 770077n;

  const eventsFor = () => prisma.decisionAuditEvent.findMany({ where: { tenantId } });

  beforeEach(async () => {
    await prisma.decisionAuditEvent.deleteMany({ where: { tenantId } });
  });

  afterAll(async () => {
    await prisma.decisionAuditEvent.deleteMany({ where: { tenantId } });
    await prisma.$disconnect();
  });

  function input(eventType: string) {
    return {
      tenantId,
      eventType,
      aggregateType: 'Test',
      aggregateId: '1',
      actorId: 'tester',
      payload: {},
    };
  }

  it('leaves no audit event behind when the business transaction rolls back', async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await audit.append(input('ROLLED_BACK_ACTION'), tx);
        // The business work fails after the audit was written inside the same transaction.
        throw new Error('business failure');
      }),
    ).rejects.toThrow('business failure');

    // Before the fix the event committed independently and survived this rollback.
    expect(await eventsFor()).toHaveLength(0);
  });

  it('commits the audit event together with the business transaction', async () => {
    await prisma.$transaction(async (tx) => {
      await audit.append(input('COMMITTED_ACTION'), tx);
    });

    const events = await eventsFor();
    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe('COMMITTED_ACTION');
  });

  it('still opens its own transaction when no caller transaction is supplied', async () => {
    await audit.append(input('STANDALONE_ACTION'));

    expect(await eventsFor()).toHaveLength(1);
  });

  it('keeps the hash chain linked across events written in separate transactions', async () => {
    await prisma.$transaction((tx) => audit.append(input('FIRST'), tx));
    await prisma.$transaction((tx) => audit.append(input('SECOND'), tx));

    const events = await prisma.decisionAuditEvent.findMany({
      where: { tenantId },
      orderBy: { id: 'asc' },
    });
    expect(events).toHaveLength(2);
    expect(events[0]?.previousHash).toBeNull();
    expect(events[1]?.previousHash).toBe(events[0]?.eventHash);
  });
});
