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
 * Plan §2.5 / D-9: verifying an audit event must not depend on JSONB re-serialization.
 * Postgres JSONB re-normalizes some numbers on round-trip (a high-precision decimal returns
 * with one fewer digit), which would flip a genuine event to a false EVENT_HASH_MISMATCH.
 * Freezing the signed canonical string and verifying against it removes that dependency.
 */
const DATABASE_URL = process.env.ADMIN_DATABASE_URL ?? process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

describeDb('Audit canonical payload verification (integration)', () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL }) });
  const hashes = new HashService(
    new ConfigService({ AUDIT_HASH_SECRET: 'audit-secret-with-at-least-32-characters!!' }),
  );
  const audit = new AuditService(prisma as unknown as PrismaService, hashes);
  const query = new AuditQueryService(
    new PostgresDecisionAuditReadAdapter(directReadAdapterFactory(prisma)),
    hashes,
    new ConfigService({ MAX_PAGE_SIZE: 100 }),
  );
  // Unique per run: append-only rows cannot be cleaned up.
  const tenantId = uniqueTenantId(1);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('verifies a chain whose payload contains a JSONB-normalizing value', async () => {
    // This exact value round-trips through JSONB as 1.234567890123457 (one digit fewer),
    // which is what used to break verification.
    await audit.append({
      tenantId,
      eventType: 'D9_PROBE',
      aggregateType: 'Test',
      aggregateId: '1',
      actorId: 'tester',
      // Perder precisión al leerlo es EXACTAMENTE lo que esta prueba comprueba (D-9): que
      // congelar la carga canónica evita que la normalización numérica de JSONB convierta
      // un evento válido en una discrepancia de hash al verificarlo.
      // eslint-disable-next-line no-loss-of-precision
      payload: { amount: 1.23456789012345678, note: 'high precision' },
    });
    await audit.append({
      tenantId,
      eventType: 'D9_PROBE_2',
      aggregateType: 'Test',
      aggregateId: '2',
      actorId: 'tester',
      // Por encima de Number.MAX_SAFE_INTEGER, también a propósito.
      // eslint-disable-next-line no-loss-of-precision
      payload: { values: [1.0, 2.5, 9007199254740993] },
    });

    const result = await query.verifyAuditChain(tenantId);
    expect(result.valid).toBe(true);
    expect(result.invalid).toEqual([]);
    expect(result.eventCount).toBe(2);
  });

  it('stores the canonical payload string alongside the event', async () => {
    const event = await audit.append({
      tenantId,
      eventType: 'D9_PROBE_3',
      aggregateType: 'Test',
      aggregateId: '3',
      actorId: 'tester',
      payload: { x: 3.14159265358979312 },
    });
    const stored = await prisma.decisionAuditEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(stored.canonicalPayload).toBeTruthy();
    // The stored string is exactly what the HMAC was computed over.
    expect(hashes.hmacWithKey(stored.canonicalPayload as string, stored.hashKeyId)).toBe(
      stored.eventHash,
    );
  });

  it('still detects a genuinely tampered event', async () => {
    const event = await audit.append({
      tenantId,
      eventType: 'D9_TAMPER',
      aggregateType: 'Test',
      aggregateId: '4',
      actorId: 'tester',
      payload: { ok: true },
    });
    // Tamper with the frozen canonical string (as an attacker altering the record would):
    // hashing the altered string no longer matches the stored eventHash.
    const rehash = hashes.hmacWithKey('{"tampered":true}', event.hashKeyId);
    expect(rehash).not.toBe(event.eventHash);
  });
});
