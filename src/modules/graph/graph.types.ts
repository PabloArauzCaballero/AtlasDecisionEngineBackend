export type NodeType =
  | 'START'
  | 'CONDITION'
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
}
