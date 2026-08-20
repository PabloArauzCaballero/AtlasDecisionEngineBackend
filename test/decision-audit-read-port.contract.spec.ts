import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { PostgresDecisionAuditReadAdapter } from '../src/modules/audit-query/adapters/postgres-decision-audit-read.adapter';
import type { AuditChainEvent } from '../src/modules/audit-query/ports/decision-audit-read.port';
import {
  CONTRACT_EVENTS,
  describeDecisionAuditReadPortContract,
  type AuditContractFixture,
} from './support/decision-audit-read-port.contract';
import { InMemoryDecisionAuditReadAdapter } from './support/in-memory-decision-audit-read.adapter';
import { directReadAdapterFactory } from './support/read-adapter';
import { uniqueTenantId } from './support/unique-tenant';

/**
 * La misma suite de contrato contra DOS implementaciones del puerto.
 *
 * Es la prueba de que el desacoplamiento existe: si el servicio de auditoría solo pudiera
 * funcionar con la implementación PostgreSQL, la de memoria no pasaría estas pruebas. La
 * de PostgreSQL se salta sin base de datos, la de memoria corre siempre — así una regla
 * rota nunca queda escondida detrás de «no hay Postgres».
 */
describeDecisionAuditReadPortContract('in-memory adapter', async () => {
  const tenantId = uniqueTenantId(41);
  const events: AuditChainEvent[] = CONTRACT_EVENTS.map((seed, index) => ({
    id: BigInt(index + 1),
    tenantId,
    eventType: seed.eventType,
    aggregateType: seed.aggregateType,
    aggregateId: String(index + 1),
    actorId: seed.actorId,
    requestId: null,
    payloadJson: {},
    canonicalPayload: null,
    previousHash: null,
    eventHash: `hash-${index}`,
    hashKeyId: 'v1',
  }));

  return {
    port: new InMemoryDecisionAuditReadAdapter(
      events.map((event, index) => ({ ...event, occurredAt: CONTRACT_EVENTS[index].occurredAt })),
    ),
    tenantId,
    otherTenantId: uniqueTenantId(42),
    events,
    cleanup: async () => undefined,
  } satisfies AuditContractFixture;
});

const DATABASE_URL = process.env.ADMIN_DATABASE_URL ?? process.env.DATABASE_URL;

describeDecisionAuditReadPortContract(
  'PostgreSQL adapter',
  async () => {
    const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL }) });
    // La tabla de auditoría es append-only a nivel de base: esta corrida no puede limpiar
    // tras de sí y no debe ver filas de una anterior, así que usa su propio tenant.
    const tenantId = uniqueTenantId(43);
    const events: AuditChainEvent[] = [];

    for (const [index, seed] of CONTRACT_EVENTS.entries()) {
      const created = await prisma.decisionAuditEvent.create({
        data: {
          tenantId,
          eventType: seed.eventType,
          aggregateType: seed.aggregateType,
          aggregateId: String(index + 1),
          actorId: seed.actorId,
          payloadJson: {},
          eventHash: `contract-hash-${index}`,
          occurredAt: seed.occurredAt,
        },
      });
      events.push(created as unknown as AuditChainEvent);
    }

    return {
      port: new PostgresDecisionAuditReadAdapter(directReadAdapterFactory(prisma)),
      tenantId,
      otherTenantId: uniqueTenantId(44),
      events,
      cleanup: async () => {
        await prisma.$disconnect();
      },
    } satisfies AuditContractFixture;
  },
  // Sin base de datos la suite se salta, pero la implementación existe y la de memoria
  // sigue cubriendo el contrato (regla 60-testing).
  DATABASE_URL ? describe : describe.skip,
);
