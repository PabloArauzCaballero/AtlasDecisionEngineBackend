import { DomainException } from '../../../common/errors/domain-exception';
import type { IntermediateScope } from '../intermediate-scope';
import type {
  ArtifactReferenceResolver,
  LiveStepEvent,
  NestedReferenceCursor,
  GraphNodeSnapshot,
  WorkerServiceInvoker,
} from '../graph.types';
import type { ExecutionTraceBook } from './execution-result';
import type { NodeEvaluation } from './execution-state';
import { nodeVariableState } from './node-variable-state';

/** Todo lo que vive mientras dura UNA ejecución del grafo. */
export interface ExecutionRun extends ExecutionTraceBook {
  variables: Record<string, unknown>;
  cursor: NestedReferenceCursor;
  referenceResolver?: ArtifactReferenceResolver;
  workerInvoker?: WorkerServiceInvoker;
  onStep?: (event: LiveStepEvent) => void;
  terminalNodeKey?: string;
}

/** Los datos de un paso de la traza: el nodo, su evaluación y de qué estado de intermedias parte. */
export interface StepRecord {
  node: GraphNodeSnapshot;
  evaluation: NodeEvaluation;
  intermediatesBefore: ReturnType<IntermediateScope['snapshot']>;
  durationUs: number;
}

/** Anota en la traza un paso que terminó bien, con la rama tomada si la hubo. */
export function recordStep(run: ExecutionRun, step: StepRecord, branchTaken?: string): void {
  const { node, evaluation, intermediatesBefore, durationUs } = step;
  run.trace.push({
    nodeId: node.id,
    nodeKey: node.key,
    nodeType: node.type,
    ...(branchTaken !== undefined ? { branchTaken } : {}),
    evaluation,
    durationUs,
    variableState: nodeVariableState(
      node,
      run.compiled,
      run.variables,
      run.state,
      intermediatesBefore,
      { durationUs },
    ),
  });
}

/**
 * Sin esto, el nodo que rompe la decisión era justo el único que no aparecía en la traza:
 * quedaba un hueco donde más falta hace la evidencia.
 */
export function recordFailedStep(
  run: ExecutionRun,
  step: Omit<StepRecord, 'durationUs'>,
  durationUs: number,
  error: unknown,
): void {
  const { node, evaluation, intermediatesBefore } = step;
  const failure = {
    code: error instanceof DomainException ? error.code : 'NODE_EXECUTION_FAILED',
    message: error instanceof Error ? error.message : String(error),
  };
  run.trace.push({
    nodeId: node.id,
    nodeKey: node.key,
    nodeType: node.type,
    evaluation,
    durationUs,
    variableState: nodeVariableState(
      node,
      run.compiled,
      run.variables,
      run.state,
      intermediatesBefore,
      { durationUs, error: failure },
    ),
  });
  run.onStep?.({
    status: 'ERROR',
    nodeKey: node.key,
    nodeType: node.type,
    durationUs,
    errorMessage: failure.message,
  });
}
