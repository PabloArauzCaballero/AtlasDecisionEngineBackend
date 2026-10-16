import type { SerializedRows } from './row-serializer';

/** Funciones que pueden aparecer como origen de filas en un plan. Espeja la guardia. */
export const ALLOWED_FUNCTION_SCANS = new Set([
  'generate_series',
  'unnest',
  'jsonb_array_elements',
  'json_array_elements',
]);

export interface QueryEstimate {
  /** Filas que el planificador espera. Es una ESTIMACIÓN, y la vista lo dice así. */
  readonly estimatedRows: number;
  /** Bytes estimados = filas × ancho medio de fila que calcula el planificador. */
  readonly estimatedBytes: number;
  /** Coste del plan en las unidades de PostgreSQL. Sirve para comparar, no para prometer. */
  readonly planCost: number;
  /** Relaciones que el plan recorre de verdad, no las que el texto nombra. */
  readonly scannedRelations: readonly string[];
}

export interface QueryOutcome extends SerializedRows {
  readonly estimate: QueryEstimate;
  readonly durationMs: number;
  /** Se alcanzó el tope de filas y hay más resultado del que se devuelve. */
  readonly truncated: boolean;
}

export class SqlConsoleQueryError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'SqlConsoleQueryError';
  }
}

export interface PlanNode {
  readonly 'Node Type'?: string;
  readonly Schema?: string;
  readonly 'Relation Name'?: string;
  readonly 'Function Name'?: string;
  readonly 'Plan Rows'?: number;
  readonly 'Plan Width'?: number;
  readonly 'Total Cost'?: number;
  readonly Plans?: readonly PlanNode[];
  readonly 'CTE Name'?: string;
}
