/**
 * Adaptador PostgreSQL del puerto de lectura de auditoría.
 *
 * Es el único archivo del módulo que habla Prisma. Toda consulta pasa por el asa que
 * entrega la fábrica, así que hereda sin código extra el enrutamiento por módulo, el
 * interruptor de separación de rutas, el fallback al primario, la normalización de errores
 * y las métricas por conexión.
 *
 * El descriptor pide `rowLevelSecurity`: este módulo sirve evidencia regulatoria de un
 * tenant y no puede enrutarse a un motor sin aislamiento a nivel de fila. Si alguien lo
 * apunta a uno, el contenedor no levanta.
 */
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { CountedRows } from '../../../common/persistence/ports/repository.port';
import {
  PersistenceAdapterFactory,
  type ReadAdapterHandle,
} from '../../../common/persistence/factory/persistence-adapter.factory';
import type {
  AuditChainBatchCriteria,
  AuditChainEvent,
  AuditEventCursorCriteria,
  AuditEventCriteria,
  AuditEventPageCriteria,
  AuditEventRow,
  AuditReadModel,
  DecisionAuditReadPort,
  ExecutionMetrics,
  ExecutionSearchCriteria,
} from '../ports/decision-audit-read.port';

/** Nombre del módulo en las reglas de routing y en las etiquetas de métrica. */
export const AUDIT_QUERY_MODULE = 'audit-query';

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

  /** Ruta efectiva actual; la usa `/health/data-sources` y las pruebas del router. */
  describe() {
    return this.reads.describe();
  }

  async findExecutionById(tenantId: bigint, executionId: bigint): Promise<AuditReadModel | null> {
    return this.reads.run('findExecutionById', async (client) =>
      client.decisionExecution.findFirst({
        where: { id: executionId, tenantId },
        include: {
          deployment: { include: { environment: true, compiledArtifact: true } },
          artifactVersion: { include: { artifact: true } },
          variables: { include: { variableVersion: { include: { definition: true } } } },
          steps: { include: { node: true }, orderBy: { stepOrder: 'asc' } },
          reasons: {
            include: { reasonCode: true, sourceAction: true },
            orderBy: { priority: 'asc' },
          },
          errors: true,
          manualReview: true,
        },
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

function executionWhere(criteria: ExecutionSearchCriteria): Prisma.DecisionExecutionWhereInput {
  return {
    tenantId: criteria.tenantId,
    ...(criteria.outcome ? { businessOutcome: criteria.outcome } : {}),
    ...(criteria.requestId ? { requestId: criteria.requestId } : {}),
    ...(criteria.artifactCode
      ? { artifactVersion: { artifact: { artifactCode: criteria.artifactCode } } }
      : {}),
    ...(criteria.from || criteria.to
      ? {
          executedAt: {
            ...(criteria.from ? { gte: criteria.from } : {}),
            ...(criteria.to ? { lte: criteria.to } : {}),
          },
        }
      : {}),
  };
}

function auditEventWhere(criteria: AuditEventCriteria): Prisma.DecisionAuditEventWhereInput {
  return {
    tenantId: criteria.tenantId,
    ...(criteria.eventType ? { eventType: criteria.eventType } : {}),
    ...(criteria.aggregateType ? { aggregateType: criteria.aggregateType } : {}),
    ...(criteria.actorId ? { actorId: criteria.actorId } : {}),
    ...(criteria.from || criteria.to
      ? {
          // `DecisionAuditEvent` sella sus filas con `occurredAt`; no existe columna
          // `createdAt`, así que filtrar por from/to contra ella fallaba en tiempo de consulta.
          occurredAt: {
            ...(criteria.from ? { gte: criteria.from } : {}),
            ...(criteria.to ? { lte: criteria.to } : {}),
          },
        }
      : {}),
  };
}
