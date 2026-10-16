import type { Prisma } from '@prisma/client';
import { escapeLikeTerm } from '../../../../common/persistence/like-escape';
import type {
  AuditEventCriteria,
  ExecutionSearchCriteria,
} from '../../ports/decision-audit-read.port';

export function executionWhere(
  criteria: ExecutionSearchCriteria,
): Prisma.DecisionExecutionWhereInput {
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

export function auditEventWhere(criteria: AuditEventCriteria): Prisma.DecisionAuditEventWhereInput {
  const term = criteria.search ? escapeLikeTerm(criteria.search) : undefined;
  return {
    tenantId: criteria.tenantId,
    ...(criteria.eventType ? { eventType: criteria.eventType } : {}),
    ...(criteria.aggregateType ? { aggregateType: criteria.aggregateType } : {}),
    ...(criteria.actorId ? { actorId: criteria.actorId } : {}),
    ...(term
      ? {
          /*
           * `contains` + `mode: 'insensitive'` es `ILIKE '%…%'`; Prisma NO escapa `%` ni `_`, así
           * que se escapan aquí (`escapeLikeTerm`): buscar «100%» busca un porcentaje, no «todo».
           * Antes el buscador de la
           * bitácora mandaba `eventType` y el motor lo comparaba por IGUALDAD, así que escribir
           * «DEPLOY» no encontraba «ARTIFACT_DEPLOYED» aunque la ayuda dijera «basta una parte».
           */
          OR: [
            { eventType: { contains: term, mode: 'insensitive' as const } },
            { aggregateType: { contains: term, mode: 'insensitive' as const } },
            { aggregateId: { contains: term, mode: 'insensitive' as const } },
            { actorId: { contains: term, mode: 'insensitive' as const } },
            { requestId: { contains: term, mode: 'insensitive' as const } },
          ],
        }
      : {}),
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
