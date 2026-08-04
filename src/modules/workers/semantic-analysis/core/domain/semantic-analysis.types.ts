export type DecisionStatus = 'MATCH' | 'MULTI_MATCH' | 'UNKNOWN' | 'AMBIGUOUS' | 'CONTRADICTED';

export type AnalysisTier = 'FAST' | 'DEEP';

export interface SemanticCategory {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly description: string;
  readonly positiveExamples: readonly string[];
  readonly counterExamples: readonly string[];
  readonly restrictions: readonly string[];
  readonly relatedCategoryCodes: readonly string[];
  readonly acceptanceThreshold: number;
  readonly version: number;
}

export interface ResolvedEntity {
  readonly type: string;
  readonly canonicalName: string;
  readonly sourceText: string;
  readonly confidence: number;
}

export interface CategoryCandidate {
  readonly category: SemanticCategory;
  readonly retrievalScore: number;
}

export interface CategoryAssessment {
  readonly categoryCode: string;
  readonly confidence: number;
  readonly supported: boolean;
  readonly contradicted: boolean;
  readonly evidence: readonly string[];
  readonly rationale: string;
}

export interface ModelClassification {
  readonly assessments: readonly CategoryAssessment[];
  readonly model: string;
  readonly modelVersion: string;
}

export interface SemanticAnalysisRequest {
  readonly requestId: string;
  readonly idempotencyKey: string;
  readonly text: string;
  readonly tenantId?: string | undefined;
  readonly requestedBy?: string | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface SemanticAnalysisResult {
  readonly requestId: string;
  readonly status: DecisionStatus;
  readonly normalizedText: string;
  readonly entities: readonly ResolvedEntity[];
  readonly matches: readonly CategoryAssessment[];
  readonly evaluatedCategoryCodes: readonly string[];
  readonly tierUsed: AnalysisTier;
  readonly model: string;
  readonly modelVersion: string;
  readonly processingTimeMs: number;
}

export interface ModelClassificationInput {
  readonly originalText: string;
  readonly normalizedText: string;
  readonly entities: readonly ResolvedEntity[];
  readonly candidates: readonly CategoryCandidate[];
}

export interface EntityAlias {
  readonly alias: string;
  readonly canonicalName: string;
  readonly entityType: string;
}
