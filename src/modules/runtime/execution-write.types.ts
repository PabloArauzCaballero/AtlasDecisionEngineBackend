import { ExecutionStatus, Prisma, SubjectReferencePolicy } from '@prisma/client';
import type { ResolvedDeployment } from '../deployments/deployment-resolver.service';
import type { EngineExecutionResult } from '../graph/graph.types';
import type { ResolvedVariableSnapshot } from '../variables/variable-resolution.service';

/** Complete persistence payload for one decision execution and its evidence. */
export interface WriteExecutionInput {
  tenantId: bigint;
  deployment: ResolvedDeployment;
  requestId: string;
  correlationId?: string;
  idempotencyKey: string;
  subjectReference?: string;
  /** Por qué no hay sujeto, cuando no lo hay. Lo decide `subject-policy.ts`. */
  subjectAbsenceReason?: SubjectReferencePolicy | null;
  inputSnapshot: Record<string, unknown>;
  durationMs: number;
  variableSnapshots: ResolvedVariableSnapshot[];
  result?: EngineExecutionResult;
  errors?: Array<{
    code: string;
    type: string;
    message: string;
    retryable: boolean;
    details?: unknown;
  }>;
  /**
   * Estado impuesto por el runtime cuando el grafo terminó pero su resultado no es utilizable
   * (salida económica fuera de rango). Se conserva el resultado completo como evidencia y la
   * ejecución queda `NO_DECISION`: sin esto, el estado se derivaba del grafo y salía SUCCEEDED.
   */
  statusOverride?: ExecutionStatus;
  /** El reloj de la decisión: de él cuelgan las ventanas de observación y el plazo de revisión. */
  decidedAt?: Date;
}

/**
 * Lo que se guarda como evaluación de un paso: lo que el nodo evaluó y, si el motor lo
 * calculó, el estado de las variables antes y después del nodo (§3.1).
 *
 * Sin `variableState`, el detalle de una ejecución real podía decir por dónde pasó la
 * decisión pero no POR QUÉ: qué valor tenía cada variable al llegar a cada nodo. El
 * estado ya sale enmascarado del motor —una entrada sensible viaja como `null` y las
 * intermedias y salidas respetan su `tracePolicy`—, el mismo enmascarado que ya protege
 * la respuesta del simulador. Va dentro de la evaluación y no
 * en una columna propia: es evidencia del mismo paso y se lee siempre junto a ella.
 */
export function persistedStepEvaluation(
  step: EngineExecutionResult['trace'][number],
): Prisma.InputJsonValue {
  const evaluation = { ...step.evaluation };
  if (step.variableState) evaluation.variableState = step.variableState;
  return evaluation as Prisma.InputJsonValue;
}
