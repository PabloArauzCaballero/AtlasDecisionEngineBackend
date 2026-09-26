/**
 * Suite de contrato del puerto de lectura de auditoría.
 *
 * La ejecuta TODA implementación del puerto, sea cual sea su motor. Es lo que convierte
 * «el dominio no depende de la infraestructura» en algo comprobable: si una segunda
 * implementación —otro motor, una proyección de solo lectura, un doble en memoria— pasa
 * exactamente las mismas pruebas, el servicio puede cambiar de una a otra sin enterarse.
 *
 * Solo describe comportamiento observable a través del puerto. No conoce SQL, ni índices,
 * ni el nombre de una sola tabla.
 */
import type {
  AuditChainEvent,
  DecisionAuditReadPort,
} from '../../src/modules/audit-query/ports/decision-audit-read.port';

export interface AuditContractFixture {
  /** Puerto ya poblado con los eventos indicados, para un tenant aislado. */
  readonly port: DecisionAuditReadPort;
  readonly tenantId: bigint;
  /** Tenant vecino con datos propios: sirve para comprobar el aislamiento. */
  readonly otherTenantId: bigint;
  readonly events: AuditChainEvent[];
  cleanup(): Promise<void>;
}

export interface ContractSeedEvent {
  readonly eventType: string;
  readonly aggregateType: string;
  readonly actorId: string;
  readonly occurredAt: Date;
}

/** Semilla común: dos tipos de evento, dos actores y dos días distintos. */
export const CONTRACT_EVENTS: ContractSeedEvent[] = [
  {
    eventType: 'CONTRACT_ALPHA',
    aggregateType: 'ARTIFACT',
    actorId: 'alice',
    occurredAt: new Date('2026-07-15T10:00:00.000Z'),
  },
  {
    eventType: 'CONTRACT_ALPHA',
    aggregateType: 'ARTIFACT',
    actorId: 'bob',
    occurredAt: new Date('2026-07-15T11:00:00.000Z'),
  },
  {
    eventType: 'CONTRACT_BETA',
    aggregateType: 'DEPLOYMENT',
    actorId: 'alice',
    occurredAt: new Date('2026-07-20T09:00:00.000Z'),
  },
];

export function describeDecisionAuditReadPortContract(
  label: string,
  createFixture: () => Promise<AuditContractFixture>,
  runner: jest.Describe = describe,
): void {
  runner(`DecisionAuditReadPort contract — ${label}`, () => {
    let fixture: AuditContractFixture;

    beforeAll(async () => {
      fixture = await createFixture();
    });

    afterAll(async () => {
      await fixture.cleanup();
    });

    it('lists every event of the tenant and counts them', async () => {
      const { items, total } = await fixture.port.listAuditEvents({
        tenantId: fixture.tenantId,
        skip: 0,
        take: 50,
      });

      expect(total).toBe(CONTRACT_EVENTS.length);
      expect(items).toHaveLength(CONTRACT_EVENTS.length);
    });

    it('never returns another tenant rows', async () => {
      const { items, total } = await fixture.port.listAuditEvents({
        tenantId: fixture.otherTenantId,
        skip: 0,
        take: 50,
      });

      expect(total).toBe(0);
      expect(items).toHaveLength(0);
    });

    it('filters by event type, aggregate type and actor', async () => {
      const byType = await fixture.port.listAuditEvents({
        tenantId: fixture.tenantId,
        eventType: 'CONTRACT_ALPHA',
        skip: 0,
        take: 50,
      });
      const byActor = await fixture.port.listAuditEvents({
        tenantId: fixture.tenantId,
        actorId: 'alice',
        skip: 0,
        take: 50,
      });
      const byAggregate = await fixture.port.listAuditEvents({
        tenantId: fixture.tenantId,
        aggregateType: 'DEPLOYMENT',
        skip: 0,
        take: 50,
      });

      expect(byType.total).toBe(2);
      expect(byActor.total).toBe(2);
      expect(byAggregate.total).toBe(1);
    });

    it('filters by an occurrence window, inclusive on both ends', async () => {
      const inside = await fixture.port.listAuditEvents({
        tenantId: fixture.tenantId,
        from: new Date('2026-07-15T00:00:00.000Z'),
        to: new Date('2026-07-16T00:00:00.000Z'),
        skip: 0,
        take: 50,
      });
      const outside = await fixture.port.listAuditEvents({
        tenantId: fixture.tenantId,
        from: new Date('2026-08-01T00:00:00.000Z'),
        to: new Date('2026-08-02T00:00:00.000Z'),
        skip: 0,
        take: 50,
      });

      expect(inside.total).toBe(2);
      expect(outside.total).toBe(0);
    });

    it('paginates by offset without losing or repeating rows', async () => {
      const first = await fixture.port.listAuditEvents({
        tenantId: fixture.tenantId,
        skip: 0,
        take: 2,
      });
      const second = await fixture.port.listAuditEvents({
        tenantId: fixture.tenantId,
        skip: 2,
        take: 2,
      });

      expect(first.items).toHaveLength(2);
      expect(second.items).toHaveLength(1);
      expect(first.total).toBe(second.total);
    });

    it('walks the cursor view newest first and honours the seek key', async () => {
      const firstPage = await fixture.port.listAuditEventsByCursor({
        tenantId: fixture.tenantId,
        take: 3,
      });
      const ids = firstPage.map((row) => row.id);

      expect([...ids].sort((a, b) => Number(b - a))).toEqual(ids);

      const nextPage = await fixture.port.listAuditEventsByCursor({
        tenantId: fixture.tenantId,
        beforeId: ids[0],
        take: 3,
      });

      expect(nextPage.every((row) => row.id < ids[0])).toBe(true);
    });

    it('reads the chain in ascending batches and terminates', async () => {
      const first = await fixture.port.readAuditChainBatch({
        tenantId: fixture.tenantId,
        afterId: 0n,
        batchSize: 2,
      });

      expect(first).toHaveLength(2);
      expect(first[0].id < first[1].id).toBe(true);

      const last = await fixture.port.readAuditChainBatch({
        tenantId: fixture.tenantId,
        afterId: first[1].id,
        batchSize: 2,
      });

      expect(last).toHaveLength(1);

      const exhausted = await fixture.port.readAuditChainBatch({
        tenantId: fixture.tenantId,
        afterId: last[0].id,
        batchSize: 2,
      });

      expect(exhausted).toHaveLength(0);
    });

    it('reports zero metrics for a tenant with no executions', async () => {
      const metrics = await fixture.port.executionMetrics(fixture.otherTenantId);

      expect(metrics.total).toBe(0);
      expect(metrics.outcomes).toEqual([]);
      expect(metrics.statuses).toEqual([]);
    });

    it('answers null for an execution the tenant does not own', async () => {
      await expect(
        fixture.port.findExecutionById(fixture.tenantId, 999_999_999n),
      ).resolves.toBeNull();
    });
  });
}
