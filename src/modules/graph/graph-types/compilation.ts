import type { IntermediateVariableSnapshot, VariableContractSnapshot } from './contracts';
import type {
  ArtifactGraphSnapshot,
  GraphActionSnapshot,
  GraphConditionSnapshot,
  GraphEdgeSnapshot,
  GraphNodeSnapshot,
  OutputContractFieldSnapshot,
} from './snapshot';

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
  runtimeSchemaVersion: '1.0' | '1.1' | '1.2';
  compilerVersion: string;
  artifact: ArtifactGraphSnapshot['artifact'];
  version: ArtifactGraphSnapshot['version'];
  variables: VariableContractSnapshot[];
  /** Compilado a partir del snapshot; `[]` en artefactos compilados antes de §2. */
  intermediates: IntermediateVariableSnapshot[];
  outputContract: OutputContractFieldSnapshot[];
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
