import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { AuditService } from '../src/common/audit/audit.service';
import { HashService } from '../src/common/crypto/hash.service';
import type { PrismaService } from '../src/common/prisma/prisma.service';

/**
 * The audit chain is hash-linked, so tampering is detectable — but detection is not
 * prevention. These exercise the database-level guarantee that an event cannot be
 * modified or removed at all.
 *
 * Nothing here cleans up after itself: append-only means the rows cannot be deleted, so
 * each run uses a tenant id of its own.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

describeDb('decision_audit_event append-only (integration)', () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL }) });
  const hashes = new HashService(
    new ConfigService({ AUDIT_HASH_SECRET: 'audit-secret-with-at-least-32-characters!!' }),
  );
  const audit = new AuditService(prisma as unknown as PrismaService, hashes);
  // Unique per run: these rows are permanent by design.
  const tenantId = BigInt(900000 + (process.pid % 10000));
  let eventId: bigint;

  beforeAll(async () => {
    const event = await audit.append({
      tenantId,
      eventType: 'APPEND_ONLY_PROBE',
      aggregateType: 'Test',
      aggregateId: '1',
      actorId: 'tester',
      payload: { original: true },
    });
    eventId = event.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // Driven through raw SQL on purpose: the guarantee being asserted belongs to the
  // database, so it must hold for any writer, not only for callers going through Prisma.
  // Two independent layers refuse the write, and either satisfies the guarantee: the
  // triggers ("append-only"), and — under the non-superuser runtime role atlas_app — the
  // REVOKE of UPDATE/DELETE/TRUNCATE, which denies it at the grant level ("permission
  // denied") before the trigger even runs.
  const refused = /append-only|permission denied|must be owner/i;

  it('refuses an UPDATE of a recorded event', async () => {
    await expect(
      prisma.$executeRawUnsafe(`UPDATE "decision_audit_event" SET actor_id = 'tampered' WHERE id = ${eventId}`),
    ).rejects.toThrow(refused);
  });

  it('refuses a DELETE of a recorded event', async () => {
    await expect(
      prisma.$executeRawUnsafe(`DELETE FROM "decision_audit_event" WHERE id = ${eventId}`),
    ).rejects.toThrow(refused);
  });

  it('refuses a TRUNCATE of the audit table', async () => {
    // TRUNCATE skips row-level triggers, so it needs its own statement-level guard.
    await expect(
      prisma.$executeRawUnsafe('TRUNCATE TABLE "decision_audit_event"'),
    ).rejects.toThrow(refused);
  });

  it('leaves the event intact and unchanged after every attempt', async () => {
    const event = await prisma.decisionAuditEvent.findUniqueOrThrow({ where: { id: eventId } });
    expect(event.actorId).toBe('tester');
    expect(event.eventType).toBe('APPEND_ONLY_PROBE');
  });

  it('still allows appending new events', async () => {
    const appended = await audit.append({
      tenantId,
      eventType: 'APPEND_ONLY_PROBE_2',
      aggregateType: 'Test',
      aggregateId: '2',
      actorId: 'tester',
      payload: {},
    });
    expect(appended.id).toBeGreaterThan(eventId);
    // The chain must still link to the event the UPDATE failed to alter.
    expect(appended.previousHash).not.toBeNull();
  });
});
