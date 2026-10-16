import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { CountedRows } from '../../../../common/persistence/ports/repository.port';
import {
  PersistenceAdapterFactory,
  type ReadAdapterHandle,
} from '../../../../common/persistence/factory/persistence-adapter.factory';
import type {
  AuditChainBatchCriteria,
  AuditChainEvent,
  AuditEventCursorCriteria,
  AuditEventPageCriteria,
  AuditEventRow,
  AuditReadModel,
  DecisionAuditReadPort,
  ExecutionMetrics,
  ExecutionSearchCriteria,
  ScreenRunSummary,
} from '../../ports/decision-audit-read.port';
import { AUDIT_QUERY_MODULE, EXECUTION_DETAIL_INCLUDE } from './shared';
import { auditEventWhere, executionWhere } from './where';

@Injectable()
export class PostgresDecisionAuditReadAdapter implements DecisionAuditReadPort {
  private readonly reads: ReadAdapterHandle;

  constructor(factory: PersistenceAdapterFactory) {
    this.reads = factory.createReadAdapter({
      module: AUDIT_QUERY_MODULE,
      engine: 'postgresql',
      requires: ['rowLevelSecurity'],
    });
  }

  /**
   * Resumen de accesos HTTP por (método, controlador.handler) dentro de una ventana.
   *
   * Es lo que este bloque tiene como evidencia de ejecución real: `AccessAuditInterceptor` escribe
   * una fila por petición AUTENTICADA con `resource = "MÉTODO Clase.handler"` y `decision`
   * ALLOW/DENY. Desde el 2026-09-10 lleva además el CÓDIGO HTTP, que es lo que distingue «el flujo
   * rechazó una entrada inválida» de «el flujo reventó»: sin él, un DENY sólo dice «el handler
   * lanzó» y quien lo consuma acaba llamando roto a lo primero. Las filas anteriores no lo tienen y
   * se devuelven con `status: null`, que es lo honesto. Las peticiones anónimas (login, health) no
   * dejan rastro aquí, por diseño.
   */
  summarizeAccessRuns(windowDays: number) {
    return this.reads.run('summarizeAccessRuns', async (client) => {
      const rows = await client.decisionAccessAudit.groupBy({
        by: ['resource', 'decision', 'status'],
        where: { occurredAt: { gte: new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000) } },
        _count: { _all: true },
        _max: { occurredAt: true },
      });
      return rows.map((row) => ({
        resource: row.resource,
        decision: row.decision,
        // Nulo en las filas anteriores al 2026-09-10, cuando el interceptor aún no lo guardaba: se
        // devuelve como nulo en vez de suponerle un código, que es lo que haría creer que un
        // rechazo antiguo fue un 500.
        status: row.status ?? null,
        count: row._count._all,
        lastAt: row._max.occurredAt,
      }));
    });
  }

  summarizeScreenRuns(windowDays: number, limit: number) {
    return this.reads.run('summarizeScreenRuns', async (client) => {
      const rows = await client.decisionAccessAudit.groupBy({
        by: ['originClient', 'originScreen', 'resource', 'status'],
        where: {
          occurredAt: { gte: new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000) },
          originClient: { not: null },
          originScreen: { not: null },
        },
        _count: { _all: true },
        _max: { occurredAt: true },
        // Lo más reciente primero: si hay que cortar, se pierde lo más viejo, y se dice.
        orderBy: { _max: { occurredAt: 'desc' } },
        take: limit,
      });
      return rows.map((row): ScreenRunSummary => ({
        client: row.originClient ?? '',
        screen: row.originScreen ?? '',
        resource: row.resource,
        status: row.status ?? null,
        count: row._count._all,
        lastAt: row._max.occurredAt,
      }));
    });
  }

  /** Ruta efectiva actual; la usa `/health/data-sources` y las pruebas del router. */
  describe() {
    return this.reads.describe();
  }

  async findExecutionById(tenantId: bigint, executionId: bigint): Promise<AuditReadModel | null> {
    return this.reads.run('findExecutionById', async (client) =>
      client.decisionExecution.findFirst({
        where: { id: executionId, tenantId },
        include: EXECUTION_DETAIL_INCLUDE,
      }),
    );
  }

  async searchExecutions(criteria: ExecutionSearchCriteria): Promise<CountedRows<AuditReadModel>> {
    const where = executionWhere(criteria);
    return this.reads.run('searchExecutions', async (client) => {
      // `$transaction` en forma de array sobre la ruta de lectura: agrupa filas y total en
      // una sola instantánea, así la página y su contador no pueden discrepar por una
      // escritura concurrente. No abre una transacción de escritura.
      const [items, total] = await client.$transaction([
        client.decisionExecution.findMany({
          where,
          include: {
            artifactVersion: { include: { artifact: true } },
            deployment: { include: { environment: true } },
            reasons: { include: { reasonCode: true }, orderBy: { priority: 'asc' } },
          },
          orderBy: { executedAt: 'desc' },
          skip: criteria.skip,
          take: criteria.take,
        }),
        client.decisionExecution.count({ where }),
      ]);
      return { items, total };
    });
  }

  async listAuditEvents(criteria: AuditEventPageCriteria): Promise<CountedRows<AuditReadModel>> {
    const where = auditEventWhere(criteria);
    return this.reads.run('listAuditEvents', async (client) => {
      const [items, total] = await client.$transaction([
        client.decisionAuditEvent.findMany({
          where,
          orderBy: { id: 'desc' },
          skip: criteria.skip,
          take: criteria.take,
        }),
        client.decisionAuditEvent.count({ where }),
      ]);
      return { items, total };
    });
  }

  async listAuditEventsByCursor(criteria: AuditEventCursorCriteria): Promise<AuditEventRow[]> {
    return this.reads.run('listAuditEventsByCursor', async (client) =>
      client.decisionAuditEvent.findMany({
        where: {
          ...auditEventWhere(criteria),
          ...(criteria.beforeId === undefined ? {} : { id: { lt: criteria.beforeId } }),
        },
        orderBy: { id: 'desc' },
        take: criteria.take,
      }),
    );
  }

  async readAuditChainBatch(criteria: AuditChainBatchCriteria): Promise<AuditChainEvent[]> {
    return this.reads.run('readAuditChainBatch', async (client) =>
      client.decisionAuditEvent.findMany({
        where: { tenantId: criteria.tenantId, id: { gt: criteria.afterId } },
        orderBy: { id: 'asc' },
        take: criteria.batchSize,
      }),
    ) as Promise<AuditChainEvent[]>;
  }

  async executionMetrics(tenantId: bigint, artifactCode?: string): Promise<ExecutionMetrics> {
    const where: Prisma.DecisionExecutionWhereInput = {
      tenantId,
      ...(artifactCode ? { artifactVersion: { artifact: { artifactCode } } } : {}),
    };
    return this.reads.run('executionMetrics', async (client) => {
      const [outcomes, statuses, latency, total] = await Promise.all([
        client.decisionExecution.groupBy({
          by: ['businessOutcome'],
          where,
          _count: { _all: true },
        }),
        client.decisionExecution.groupBy({
          by: ['decisionStatus'],
          where,
          _count: { _all: true },
        }),
        client.decisionExecution.aggregate({
          where,
          _avg: { durationMs: true },
          _max: { durationMs: true },
          _min: { durationMs: true },
        }),
        client.decisionExecution.count({ where }),
      ]);
      return {
        total,
        outcomes: outcomes.map((item) => ({
          outcome: item.businessOutcome,
          count: item._count._all,
        })),
        statuses: statuses.map((item) => ({
          status: item.decisionStatus,
          count: item._count._all,
        })),
        latencyMs: latency,
      };
    });
  }
}
