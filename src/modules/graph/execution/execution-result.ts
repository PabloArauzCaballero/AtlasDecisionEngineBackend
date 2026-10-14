import type { CompiledDecisionArtifact, EngineExecutionResult } from '../graph.types';
import { outputContractsOf, type MutableExecutionState } from './execution-state';

/** Lo que se recoge durante el recorrido del grafo y el resultado publica. */
export interface ExecutionTraceBook {
  compiled: CompiledDecisionArtifact;
  state: MutableExecutionState;
  trace: EngineExecutionResult['trace'];
  visitedNodeKeys: string[];
  traversedEdgeKeys: string[];
  nestedExecutions: EngineExecutionResult['nestedExecutions'];
}

/** El resultado público de una ejecución que llegó a un nodo terminal. */
export function executionResultOf(
  run: ExecutionTraceBook,
  terminalNodeKey: string,
): EngineExecutionResult {
  const { compiled, state } = run;

  return {
    status:
      state.outcome === 'NO_DECISION' && !outputContractsOf(compiled).length
        ? 'NO_DECISION'
        : 'SUCCEEDED',
    outcome: state.outcome,
    score: state.score,
    riskBand: state.riskBand,
    limit: state.limit,
    output: {
      ...state.output,
      outcome: state.outcome,
      ...(state.score !== undefined ? { score: state.score } : {}),
      ...(state.riskBand !== undefined ? { riskBand: state.riskBand } : {}),
      ...(state.limit !== undefined ? { limit: state.limit } : {}),
    },
    primaryResult: state.primaryResult,
    reasons: [...state.reasons].sort(
      (a, b) => a.priority - b.priority || a.code.localeCompare(b.code),
    ),
    trace: run.trace,
    visitedNodeKeys: run.visitedNodeKeys,
    traversedEdgeKeys: run.traversedEdgeKeys,
    terminalNodeKey,
    manualReview: state.manualReview,
    nestedExecutions: run.nestedExecutions,
    calculatedFieldCalls: state.calculatedFieldCalls,
    workerCalls: state.workerCalls,
  };
}
