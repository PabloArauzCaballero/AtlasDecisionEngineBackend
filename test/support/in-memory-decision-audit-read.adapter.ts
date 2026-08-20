/**
 * Segunda implementación del puerto de lectura de auditoría, en memoria.
 *
 * Existe para que la suite de contrato tenga al menos dos implementaciones que superarla,
 * que es lo único que demuestra de verdad que el puerto no está calcado del ORM: si el
 * contrato pudiera cumplirse solo con Prisma, sería el contrato de Prisma.
 *
 * También hace que las pruebas del contrato corran sin base de datos, así que el fallo de
 * una regla de negocio no queda escondido detrás de «no hay Postgres».
 */
import type {
  AuditChainBatchCriteria,
  AuditChainEvent,
  AuditEventCriteria,
  AuditEventCursorCriteria,
  AuditEventPageCriteria,
  AuditEventRow,
  AuditReadModel,
  DecisionAuditReadPort,
  ExecutionMetrics,
  ExecutionSearchCriteria,
} from '../../src/modules/audit-query/ports/decision-audit-read.port';
import type { CountedRows } from '../../src/common/persistence/ports/repository.port';

export interface InMemoryAuditEvent extends AuditChainEvent {
  readonly occurredAt: Date;
}

export interface InMemoryExecution {
  readonly id: bigint;
  readonly tenantId: bigint;
  readonly businessOutcome: string | null;
  readonly decisionStatus: string;
  readonly durationMs: number;
  readonly artifactCode: string;
  readonly requestId: string;
  readonly executedAt: Date;
}

export class InMemoryDecisionAuditReadAdapter implements DecisionAuditReadPort {
  constructor(
    private readonly events: InMemoryAuditEvent[] = [],
    private readonly executions: InMemoryExecution[] = [],
  ) {}

  async findExecutionById(tenantId: bigint, executionId: bigint): Promise<AuditReadModel | null> {
    const found = this.executions.find(
      (execution) => execution.tenantId === tenantId && execution.id === executionId,
    );
    return found ? { ...found } : null;
  }

  async searchExecutions(criteria: ExecutionSearchCriteria): Promise<CountedRows<AuditReadModel>> {
    const matching = this.executions
      .filter((execution) => execution.tenantId === criteria.tenantId)
      .filter((execution) => !criteria.outcome || execution.businessOutcome === criteria.outcome)
      .filter((execution) => !criteria.requestId || execution.requestId === criteria.requestId)
      .filter(
        (execution) => !criteria.artifactCode || execution.artifactCode === criteria.artifactCode,
      )
      .filter((execution) => within(execution.executedAt, criteria))
      .sort((left, right) => right.executedAt.getTime() - left.executedAt.getTime());

    return {
      items: matching
        .slice(criteria.skip, criteria.skip + criteria.take)
        .map((row) => ({ ...row })),
      total: matching.length,
    };
  }

  async listAuditEvents(criteria: AuditEventPageCriteria): Promise<CountedRows<AuditReadModel>> {
    const matching = this.matchingEvents(criteria).sort((left, right) =>
      Number(right.id - left.id),
    );
    return {
      items: matching
        .slice(criteria.skip, criteria.skip + criteria.take)
        .map((row) => ({ ...row })),
      total: matching.length,
    };
  }

  async listAuditEventsByCursor(criteria: AuditEventCursorCriteria): Promise<AuditEventRow[]> {
    return this.matchingEvents(criteria)
      .filter((event) => criteria.beforeId === undefined || event.id < criteria.beforeId)
      .sort((left, right) => Number(right.id - left.id))
      .slice(0, criteria.take)
      .map((row) => ({ ...row }));
  }

  async readAuditChainBatch(criteria: AuditChainBatchCriteria): Promise<AuditChainEvent[]> {
    return this.events
      .filter((event) => event.tenantId === criteria.tenantId && event.id > criteria.afterId)
      .sort((left, right) => Number(left.id - right.id))
      .slice(0, criteria.batchSize);
  }

  async executionMetrics(tenantId: bigint, artifactCode?: string): Promise<ExecutionMetrics> {
    const scoped = this.executions
      .filter((execution) => execution.tenantId === tenantId)
      .filter((execution) => !artifactCode || execution.artifactCode === artifactCode);
    const durations = scoped.map((execution) => execution.durationMs);
    return {
      total: scoped.length,
      outcomes: tally(scoped.map((execution) => execution.businessOutcome)).map(
        ([outcome, count]) => ({ outcome, count }),
      ),
      statuses: tally(scoped.map((execution) => execution.decisionStatus)).map(
        ([status, count]) => ({ status: status, count }),
      ),
      latencyMs: {
        _avg: { durationMs: durations.length ? average(durations) : null },
        _max: { durationMs: durations.length ? Math.max(...durations) : null },
        _min: { durationMs: durations.length ? Math.min(...durations) : null },
      },
    };
  }

  private matchingEvents(criteria: AuditEventCriteria): InMemoryAuditEvent[] {
    return this.events
      .filter((event) => event.tenantId === criteria.tenantId)
      .filter((event) => !criteria.eventType || event.eventType === criteria.eventType)
      .filter((event) => !criteria.aggregateType || event.aggregateType === criteria.aggregateType)
      .filter((event) => !criteria.actorId || event.actorId === criteria.actorId)
      .filter((event) => within(event.occurredAt, criteria));
  }
}

function within(moment: Date, range: { from?: Date; to?: Date }): boolean {
  if (range.from && moment < range.from) return false;
  if (range.to && moment > range.to) return false;
  return true;
}

function tally<T extends string | null>(values: T[]): Array<[T, number]> {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()];
}

function average(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}
