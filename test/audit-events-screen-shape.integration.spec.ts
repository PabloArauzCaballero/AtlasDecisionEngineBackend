import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { AuditService } from '../src/common/audit/audit.service';
import { HashService } from '../src/common/crypto/hash.service';
import type { PrismaService } from '../src/common/prisma/prisma.service';
import { PostgresDecisionAuditReadAdapter } from '../src/modules/audit-query/adapters/postgres-decision-audit-read.adapter';
import { AuditQueryService } from '../src/modules/audit-query/audit-query.service';
import { directReadAdapterFactory } from './support/read-adapter';
import { uniqueTenantId } from './support/unique-tenant';

/**
 * La Bitácora de auditoría del portal, con eventos REALES escritos por `AuditService`.
 *
 * La pantalla leía `createdAt`, `ipAddress` y `currentHash`, que la fila no tiene (`occurredAt` y
 * `eventHash` sí; la IP no se guarda), así que tres de sus seis columnas salían «—» en una vista
 * que se vende como «cadena inmutable con hash». Estas pruebas fijan las claves que el portal
 * lee, que lo que enseña la cadena coincide con lo que `chain/verify` recorre, y que el buscador
 * encuentra por parte del valor lo que la ayuda promete.
 */
const DATABASE_URL = process.env.ADMIN_DATABASE_URL ?? process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

describeDb('Bitácora de auditoría · lo que lee la pantalla (integration)', () => {
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
  const tenantId = uniqueTenantId(63);
  const otherTenantId = uniqueTenantId(64);

  const EVENTS: Array<{ eventType: string; aggregateType: string; actorId: string }> = [
    { eventType: 'ARTIFACT_DEPLOYED', aggregateType: 'Deployment', actorId: 'usr_204' },
    { eventType: 'MANUAL_REVIEW_ASSIGNED', aggregateType: 'ManualReviewCase', actorId: 'ana' },
    { eventType: 'ARTIFACT_APPROVED', aggregateType: 'Artifact', actorId: 'usr_204' },
  ];

  beforeAll(async () => {
    for (const [index, event] of EVENTS.entries()) {
      await audit.append({
        tenantId,
        ...event,
        aggregateId: `agg-${index}`,
        requestId: `req-audit-${index}`,
        payload: { index },
      });
    }
    await audit.append({
      tenantId: otherTenantId,
      eventType: 'ARTIFACT_DEPLOYED',
      aggregateType: 'Deployment',
      aggregateId: 'ajeno',
      actorId: 'usr_204',
      payload: {},
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const page = (filters: Record<string, unknown> = {}) =>
    query.listAuditEvents(tenantId, { page: 1, pageSize: 25, ...filters });
  const types = async (filters: Record<string, unknown>) =>
    ((await page(filters)).items as Array<{ eventType: string }>).map((item) => item.eventType);

  it('cada fila trae las claves que la pantalla lee, y ninguna de las que no existen', async () => {
    const { items } = await page();
    expect(items).toHaveLength(3);
    for (const row of items as Array<Record<string, unknown>>) {
      expect(row.occurredAt).toBeInstanceOf(Date);
      expect(typeof row.eventType).toBe('string');
      expect(typeof row.actorId).toBe('string');
      expect(typeof row.eventHash).toBe('string');
      expect((row.eventHash as string).length).toBeGreaterThanOrEqual(32);
      expect('previousHash' in row).toBe(true);
      // Lo que la pantalla leía antes y nunca llegó: la IP no se guarda.
      expect(row).not.toHaveProperty('ipAddress');
      expect(row).not.toHaveProperty('createdAt');
      expect(row).not.toHaveProperty('currentHash');
    }
  });

  it('el «Hash anterior» de cada fila es el «Hash actual» de la anterior, y el último es el de chain/verify', async () => {
    const rows = (await page()).items as Array<{ eventHash: string; previousHash: string | null }>;
    // La página viene del más nuevo al más viejo.
    expect(rows[2]?.previousHash).toBeNull();
    expect(rows[1]?.previousHash).toBe(rows[2]?.eventHash);
    expect(rows[0]?.previousHash).toBe(rows[1]?.eventHash);

    const verification = await query.verifyAuditChain(tenantId);
    expect(verification).toMatchObject({ valid: true, eventCount: 3, invalid: [] });
    expect(verification.headHash).toBe(rows[0]?.eventHash);
  });

  it('el buscador encuentra por parte del tipo de evento, sin mayúsculas: «deploy» halla ARTIFACT_DEPLOYED', async () => {
    expect(await types({ search: 'deploy' })).toEqual(['ARTIFACT_DEPLOYED']);
    // Con la igualdad exacta de antes (`eventType`), «deploy» no encontraba nada.
    expect(await types({ eventType: 'deploy' })).toEqual([]);
    expect((await types({ search: 'artifact_' })).sort()).toEqual([
      'ARTIFACT_APPROVED',
      'ARTIFACT_DEPLOYED',
    ]);
  });

  it('el buscador también recorre el actor, el tipo de objeto, su identificador y el request ID', async () => {
    expect(await types({ search: 'ANA' })).toEqual(['MANUAL_REVIEW_ASSIGNED']);
    expect(await types({ search: 'manualreviewcase' })).toEqual(['MANUAL_REVIEW_ASSIGNED']);
    expect(await types({ search: 'agg-2' })).toEqual(['ARTIFACT_APPROVED']);
    expect(await types({ search: 'req-audit-0' })).toEqual(['ARTIFACT_DEPLOYED']);
  });

  it('`%` y `_` se buscan como texto y el buscador no cruza de tenant', async () => {
    expect(await types({ search: '%' })).toEqual([]);
    expect(await types({ search: 'MANUAL_REVIEW' })).toEqual(['MANUAL_REVIEW_ASSIGNED']);
    expect(await types({ search: 'MANUAL%REVIEW' })).toEqual([]);
    expect(await types({ search: 'ajeno' })).toEqual([]);
  });

  it('la vista por cursor acepta el mismo texto', async () => {
    const { items } = await query.listAuditEventsByCursor(tenantId, {
      pageSize: 10,
      search: 'deploy',
    });
    expect(items).toHaveLength(1);
  });

  it('un texto de sólo espacios no filtra', async () => {
    expect(await types({ search: '   ' })).toHaveLength(3);
  });
});
