import type { WorkerDoubles } from '../worker-doubles';

export interface CoverageCandidate {
  variables: Record<string, unknown>;
  workerDoubles: WorkerDoubles;
}

export interface CoverageObservation {
  /** Falso si el contrato rechazó la entrada o el motor falló: el caso no sirve para la suite. */
  usable: boolean;
  visitedNodeKeys: string[];
  traversedEdgeKeys: string[];
  terminalNodeKey?: string;
  /** Lo que el caso tendrá que esperar: desenlace, motivos y salidas. */
  actual: Record<string, unknown>;
}

export type Observe = (candidate: CoverageCandidate) => Promise<CoverageObservation>;

export interface CoverageCase {
  candidate: CoverageCandidate;
  observation: CoverageObservation;
}

export interface CoverageSearchResult {
  cases: CoverageCase[];
  executions: number;
  exhaustedBudget: boolean;
  nodes: { covered: string[]; missing: string[]; percentage: number };
  edges: { covered: string[]; missing: string[]; percentage: number };
}

export interface CoverageBudget {
  maxExecutions: number;
  maxMillis: number;
  /** Reloj inyectable para las pruebas. */
  now?: () => number;
}

export type Goal = { expression: unknown; truth: boolean };

/** Una dimensión de la búsqueda: una variable de entrada, o algo que responde un worker. */
export interface Dimension {
  key: string;
  values: unknown[];
  numeric: boolean;
  integer: boolean;
  accepts: (value: unknown) => boolean;
  read: (candidate: CoverageCandidate) => unknown;
  apply: (candidate: CoverageCandidate, value: unknown) => void;
}
