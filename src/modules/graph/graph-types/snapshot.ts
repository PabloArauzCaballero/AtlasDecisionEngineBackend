import type { IntermediateVariableSnapshot, NodeType, VariableContractSnapshot } from './contracts';
import type { CalculatedFieldCallSnapshot } from './calculated-fields';

/** Gobierno y origen de un campo del contrato de salida (§4). */
export interface OutputContractFieldSnapshot {
  id?: string;
  code: string;
  name: string;
  description?: string | null;
  sourceKind: 'NODE' | 'EXPRESSION' | 'INTERMEDIATE' | 'CONSTANT' | 'REFERENCE';
  sourceRef: string;
  valueMapping?: Record<string, unknown> | null;
  absenceReasons: string[];
  /** Códigos del catálogo que la decisión puede devolver con este campo (§4). */
  reasonCodes?: string[];
  example?: unknown;
  contractVersion: string;
  sensitivityClass: string;
  tracePolicy: 'FULL' | 'MASKED' | 'REDACTED' | 'EXCLUDED';
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
  /** Campos calculados que este nodo invoca (§5.1). Vacío en la mayoría de nodos. */
  calculatedFieldCalls?: CalculatedFieldCallSnapshot[];
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
    /** Finalidad declarada del tratamiento (LGPD art. 6 I). */
    processingPurpose?: string | null;
    /** Base legal declarada (LGPD arts. 7 y 11); exigida para consumir categorías especiales. */
    legalBasis?: string | null;
  };
  variables: VariableContractSnapshot[];
  /** Variables intermedias declaradas por este grafo (§2). */
  intermediates: IntermediateVariableSnapshot[];
  /** Contrato de salida explícito con el origen de cada campo (§4). */
  outputContract: OutputContractFieldSnapshot[];
  conditions: GraphConditionSnapshot[];
  actions: GraphActionSnapshot[];
  nodes: GraphNodeSnapshot[];
  edges: GraphEdgeSnapshot[];
}
