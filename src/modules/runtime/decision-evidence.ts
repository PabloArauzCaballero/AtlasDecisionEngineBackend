import type { AppendAuditEventInput, AuditService } from '../../common/audit/audit.service';
import type { Prisma } from '@prisma/client';
import type { EngineExecutionResult } from '../graph/graph.types';
import type { ResolvedVariableSnapshot } from '../variables/variable-resolution.service';
import type { AdmittedDecision, DecisionRequest } from './decision-request';
import type { WriteExecutionInput } from './execution-writer.service';

/** Lo que el motor produjo y hay que guardar como evidencia de una decisión ejecutada. */
export interface ExecutionEvidence {
  inputSnapshot: Record<string, unknown>;
  variableSnapshots: ResolvedVariableSnapshot[];
  result: EngineExecutionResult;
  durationMs: number;
}

/** La orden de escritura de una ejecución: lo común a toda decisión más lo propio de cada desenlace. */
export function executionInputOf(
  { request, deployment, subject, now }: AdmittedDecision,
  evidence: Pick<ExecutionEvidence, 'inputSnapshot' | 'variableSnapshots' | 'durationMs'>,
  extra: Partial<WriteExecutionInput>,
): WriteExecutionInput {
  const { dto, tenantId } = request;
  return {
    tenantId,
    deployment,
    requestId: dto.requestId,
    correlationId: dto.correlationId,
    idempotencyKey: dto.idempotencyKey,
    subjectReference: subject.subjectReference,
    subjectAbsenceReason: subject.absenceReason,
    inputSnapshot: evidence.inputSnapshot,
    durationMs: evidence.durationMs,
    decidedAt: now,
    variableSnapshots: evidence.variableSnapshots,
    ...extra,
  };
}

/** Evento de auditoría de una decisión, dentro de la transacción que la confirma. */
export function appendDecisionAudit(
  audit: AuditService,
  request: DecisionRequest,
  event: { eventType: string; aggregateType: string; aggregateId: bigint },
  tx: Prisma.TransactionClient,
  payload: AppendAuditEventInput['payload'],
) {
  return audit.append(
    {
      tenantId: request.tenantId,
      eventType: event.eventType,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId.toString(),
      actorId: request.principal.id,
      requestId: request.principal.requestId,
      payload,
    },
    tx,
  );
}
