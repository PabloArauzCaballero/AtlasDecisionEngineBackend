export type NodeType =
  | 'START'
  | 'CONDITION'
  | 'SWITCH'
  | 'EXPRESSION'
  | 'DECISION_TABLE'
  | 'SCORE'
  | 'ACTION'
  | 'RESULT'
  | 'MANUAL_REVIEW'
  | 'END';

export interface VariableContractSnapshot {
  variableVersionId: string;
  usageType?: string;
  dependencyPath?: string;
  code: string;
  version: number;
  dataType: string;
  unitCode?: string | null;
  nullable: boolean;
  defaultValue?: unknown;
  validationSchema?: unknown;
  validationRules: Array<{
    ruleType: string;
    config: unknown;
    severity: string;
    errorCode: string;
  }>;
  sources: Array<{
    system: string;
    path: string;
    field: string;
    precedence: number;
    freshnessSlaSeconds: number;
    authoritative: boolean;
  }>;
  required: boolean;
  fallbackPolicy: string;
  sensitive: boolean;
}

export interface GraphConditionSnapshot {
  id?: string;
  code: string;
  name: string;
  expressionType: string;
  expression: unknown;
  severity: string;
  reusable: boolean;
}

export interface GraphActionSnapshot {
  id?: string;
  code: string;
  type: string;
  payload: Record<string, unknown>;
  terminal: boolean;
  reasonCodes: Array<{
    id?: string;
    code: string;
    category: string;
    publicMessage: string;
    internalMessage: string;
    severity: string;
    adverseAction: boolean;
    priority: number;
  }>;
}

export interface GraphNodeSnapshot {
  id?: string;
  key: string;
  type: NodeType;
  label: string;
  config: Record<string, unknown>;
  x: number;
  y: number;
  order: number;
  terminal: boolean;
  conditions: Array<{ code: string; order: number; expected: boolean }>;
  actions: Array<{ code: string; order: number }>;
}

export interface GraphEdgeSnapshot {
  id?: string;
  key: string;
  from: string;
  to: string;
  type: string;
  priority: number;
  default: boolean;
  conditions: Array<{ code: string; order: number }>;
}

export interface ArtifactGraphSnapshot {
  artifact: {
    id: string;
    tenantId: string;
    code: string;
    type: string;
    name: string;
    riskDomain: string;
  };
  version: {
    id: string;
    number: number;
    semanticVersion: string;
    status: string;
    checksum?: string | null;
    authoringNotes?: string | null;
  };
  variables: VariableContractSnapshot[];
  conditions: GraphConditionSnapshot[];
  actions: GraphActionSnapshot[];
  nodes: GraphNodeSnapshot[];
  edges: GraphEdgeSnapshot[];
}

export interface ValidationIssue {
  code: string;
  message: string;
  severity: 'ERROR' | 'WARNING';
  entityType?: 'VERSION' | 'VARIABLE' | 'NODE' | 'EDGE' | 'CONDITION' | 'ACTION';
  entityKey?: string;
  path?: string;
}

export interface GraphValidationReport {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  metrics: {
    nodeCount: number;
    edgeCount: number;
    reachableNodeCount: number;
    terminalNodeCount: number;
    terminalPathCount: number;
  };
  canonicalAst?: ArtifactGraphSnapshot;
  checksum?: string;
}

export interface CompiledDecisionArtifact {
  runtimeSchemaVersion: '1.0' | '1.1';
  compilerVersion: string;
  artifact: ArtifactGraphSnapshot['artifact'];
  version: ArtifactGraphSnapshot['version'];
  variables: VariableContractSnapshot[];
  startNodeKey: string;
  nodes: Record<string, GraphNodeSnapshot>;
  edgesByNode: Record<string, GraphEdgeSnapshot[]>;
  conditions: Record<string, GraphConditionSnapshot>;
  actions: Record<string, GraphActionSnapshot>;
  totals: {
    nodes: number;
    edges: number;
    terminalPaths: number;
  };
}

export interface DecisionReasonResult {
  reasonCodeId?: string;
  sourceActionId?: string;
  code: string;
  category: string;
  message: string;
  internalMessage: string;
  severity: string;
  adverseAction: boolean;
  priority: number;
}

export interface ExecutionTraceStep {
  nodeId?: string;
  nodeKey: string;
  nodeType: string;
  branchTaken?: string;
  evaluation: Record<string, unknown>;
  durationUs: number;
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
}

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
