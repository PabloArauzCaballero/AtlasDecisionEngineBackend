import type { SemanticAnalysisRequest } from './core/domain/semantic-analysis.types';

export interface ClaimedRow {
  id: bigint;
  tenant_id: bigint;
  request_id: string;
  idempotency_key: string;
  input_text: string;
  input_metadata: unknown;
  requested_by: string;
  attempt_count: number;
  trace_carrier: unknown;
}

export interface ClaimedRun {
  readonly id: bigint;
  readonly attemptCount: number;
  readonly traceCarrier: unknown;
  readonly request: SemanticAnalysisRequest;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
