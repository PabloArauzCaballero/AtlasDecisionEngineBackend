export type UnresolvedStatus = 'PENDING' | 'RESOLVED' | 'IGNORED' | 'REJECTED' | 'AUTO_RESOLVED';

export type ResolutionType =
  | 'USE_SUGGESTED'
  | 'ASSIGN_EXISTING'
  | 'CREATE_CATEGORY'
  | 'CREATE_ALIAS'
  | 'DISCARD'
  | 'NOT_CATEGORIZED';

export interface CandidateSuggestion {
  categoryCode: string;
  confidence: number;
}

export interface RecordUnresolvedInput {
  tenantId: bigint;
  /** El valor tal como se recibió. */
  rawValue: string;
  /** Quién lo produjo: `semantic-analysis`, `bank-statement`, `code-import`… */
  source: string;
  /** Dónde apareció: ejecución, artefacto, variable, fila del lote. */
  context?: Record<string, unknown>;
  /** Candidatas ordenadas de mayor a menor confianza. La primera es la sugerida. */
  candidates?: readonly CandidateSuggestion[];
  correlationId?: string;
}
