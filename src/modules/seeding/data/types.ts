import type { Prisma } from '@prisma/client';

export interface VariableSeed {
  code: string;
  name: string;
  description: string;
  type: 'STRING' | 'BOOLEAN' | 'INTEGER' | 'NUMBER' | 'DATE' | 'DATETIME';
  sensitive?: boolean;
  validation?: Prisma.InputJsonValue;
  /**
   * INPUT (default): resolved from a source system before execution.
   * OUTPUT: a target/scoring value produced by the decision engine (`output.<code>`).
   */
  kind?: 'INPUT' | 'OUTPUT';
  /** Unit of measure recorded on the version (e.g. 'SCORE_0_100', 'BOB', 'PERCENT', 'MONTHS'). */
  unit?: string;
  /**
   * Whether this variable may legitimately be absent. Most OUTPUT variables produced by a
   * staged decision graph are stage-dependent — e.g. `credit_risk_score` is never computed on a
   * path that already declined at KYC — so they must be nullable or every early-exit terminal
   * would fail REQUIRED_OUTPUT_MISSING. Defaults to false.
   */
  nullable?: boolean;
  /** Owning team; defaults to RISK_DECISIONING when omitted. */
  owner?: string;
  /** Declared source system for INPUT variables; defaults to REQUEST_PAYLOAD. */
  source?: string;
}

export interface ReasonSeed {
  code: string;
  category: string;
  publicMessage: string;
  internalMessage: string;
  adverseAction: boolean;
}
