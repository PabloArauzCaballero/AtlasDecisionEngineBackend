export type DecisionStatus = 'MATCH' | 'MULTI_MATCH' | 'UNKNOWN' | 'AMBIGUOUS' | 'CONTRADICTED';

export type AnalysisTier = 'FAST' | 'DEEP';

export interface SemanticCategory {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly description: string;
  /**
   * Categoría que la contiene, o `null` si es una raíz.
   *
   * El catálogo es un ÁRBOL: «Alquiler» cuelga de «Vivienda» y ésta de «Gastos».
   * La clasificación sigue recayendo sobre una sola categoría —normalmente una
   * hoja, que es donde está el detalle—; el padre existe para poder agregar por
   * rama y para explicar el resultado con su ruta completa.
   */
  readonly parentCode: string | null;
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
  /**
   * Ruta de nombres, de la raíz a la hoja, para cada categoría evaluada.
   *
   * Se resuelve aquí y no en el consumidor porque el árbol completo sólo existe
   * en este lado: quien lee el resultado ve `GASTOS.VIVIENDA.ALQUILER` y sus
   * ancestros pueden no estar entre los candidatos. Sin la ruta, la pantalla
   * tendría que partir el código por puntos, que es adivinar la jerarquía a
   * partir de una convención de nombres en vez de leerla del catálogo.
   */
  readonly categoryPaths: Readonly<Record<string, readonly string[]>>;
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
