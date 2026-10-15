/**
 * One nested-artifact-reference invocation, as recorded during execution. Persisted
 * as a `DecisionExecutionTreeLink` row once the owning (root) execution is written —
 * see NestedTreeExecutionService and ExecutionWriterService.
 */
export interface NestedExecutionTraceEntry {
  /** Preorder position of this call within the root execution's nested-call trace. */
  sequence: number;
  /** Sequence of the nested call that invoked this one; null for a depth-1 call made
   *  directly from the root artifact's own graph. */
  parentSequence: number | null;
  depth: number;
  nodeKey: string;
  /** Null only for a FALLBACK/SKIP entry recorded before a child version could be resolved. */
  childArtifactVersionId: string | null;
  status: 'SUCCEEDED' | 'FAILED' | 'FALLBACK' | 'SKIPPED';
  durationMs: number;
  output?: Record<string, unknown>;
  error?: { code: string; message: string };
}

export interface ArtifactReferenceResolution {
  /** This call's own output, keyed by the CHILD artifact's output variable codes. */
  output: Record<string, unknown>;
  /** This call's own trace entry plus every descendant call it made, flattened. */
  trace: NestedExecutionTraceEntry[];
}

/** Mutable cursor threaded through a nested-call chain to assign global sequence
 *  numbers and track recursion depth without any shared engine state. */
export interface NestedReferenceCursor {
  sequence: { value: number };
  parentSequence: number | null;
  depth: number;
}

/**
 * Resolves a RESULT node's `mode: 'REFERENCE'` invocation to a child artifact's output.
 * Implemented by NestedTreeExecutionService (src/modules/nested-trees) and passed into
 * ExecutionEngineService.execute() as a plain call argument — never a constructor
 * dependency — so the graph engine stays decoupled from the nested-trees module and
 * every existing caller that omits it keeps working unchanged (a REFERENCE node hit
 * without a resolver fails closed with NESTED_REFERENCE_NOT_CONFIGURED).
 */
export interface ArtifactReferenceResolver {
  resolve(
    parentArtifactVersionId: string,
    nodeKey: string,
    context: Record<string, unknown>,
    cursor: NestedReferenceCursor,
  ): Promise<ArtifactReferenceResolution>;
}

/**
 * One node-by-node progress update during execution (Fase 8 — live execution).
 * Passed as a plain call argument to `execute()`, never a constructor dependency —
 * same reasoning as ArtifactReferenceResolver: callers that don't care (most of
 * them) simply omit it, with zero change to their behavior or dependency graph.
 */
export interface LiveStepEvent {
  status: 'RUNNING' | 'COMPLETED' | 'ERROR';
  nodeKey: string;
  nodeType: string;
  /** The edge actually taken, once selected (absent on RUNNING or a terminal node). */
  branchTaken?: string;
  /** Outgoing edges NOT taken at this node, with the reason the engine already
   *  computed while selecting the real one (graph-editor "ramas descartadas"). */
  discardedEdgeKeys?: string[];
  durationUs?: number;
  errorMessage?: string;
}
