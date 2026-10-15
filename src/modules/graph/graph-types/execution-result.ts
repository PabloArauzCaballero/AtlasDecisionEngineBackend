import type { CalculatedFieldTraceEntry } from './calculated-fields';
import type { WorkerCallTraceEntry } from './worker-calls';
import type { DecisionReasonResult } from './compilation';
import type { NodeVariableState } from './execution-state';
import type { NestedExecutionTraceEntry } from './nested';

export interface ExecutionTraceStep {
  nodeId?: string;
  nodeKey: string;
  nodeType: string;
  branchTaken?: string;
  evaluation: Record<string, unknown>;
  durationUs: number;
  /** Ausente en artefactos compilados antes de §3. */
  variableState?: NodeVariableState;
}

export interface EngineExecutionResult {
  status: 'SUCCEEDED' | 'NO_DECISION' | 'FAILED';
  outcome: string;
  score?: number;
  riskBand?: string;
  limit?: number;
  output: Record<string, unknown>;
  primaryResult?: { code: string; value: unknown };
  reasons: DecisionReasonResult[];
  trace: ExecutionTraceStep[];
  visitedNodeKeys: string[];
  traversedEdgeKeys: string[];
  terminalNodeKey?: string;
  manualReview?: {
    queueCode: string;
    priority: number;
    slaMinutes: number;
    evidence: Record<string, unknown>;
  };
  /**
   * Flattened trace of every nested artifact-reference invocation this execution made
   * (Fase 7 — nested decision trees), in preorder. Empty unless the compiled graph
   * contains a RESULT node with `mode: 'REFERENCE'` and a resolver was supplied to
   * `execute()`. See ArtifactReferenceResolver.
   */
  nestedExecutions: NestedExecutionTraceEntry[];
  /** Toda invocación de campo calculado de esta ejecución, en orden (§12). */
  calculatedFieldCalls: CalculatedFieldTraceEntry[];
  /**
   * Toda llamada a un servicio de worker de esta ejecución, en orden. Vacío salvo que el
   * grafo tenga nodos `WORKER`.
   */
  workerCalls: WorkerCallTraceEntry[];
}
