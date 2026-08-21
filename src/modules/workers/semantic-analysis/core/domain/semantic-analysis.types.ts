export type DecisionStatus = 'MATCH' | 'MULTI_MATCH' | 'UNKNOWN' | 'AMBIGUOUS' | 'CONTRADICTED';

/**
 * Quién decidió la categoría publicada.
 *
 * `UNKNOWN` sigue existiendo en `DecisionStatus` porque el motor de decisión lo
 * produce internamente —es su forma de decir «ninguna candidata alcanzó su
 * umbral»— pero **ya no sale del worker**: la red de seguridad lo convierte en
 * una categoría por regla o en un cajón por sentido antes de publicar. Lo que
 * viaja al consumidor es este campo, que distingue las tres cosas que antes se
 * confundían en un mismo `MATCH`.
 *
 * - `MODEL`: una candidata superó el umbral de su categoría.
 * - `RULE`: la glosa nombra el rubro o el instrumento, y una regla determinista
 *   lo leyó. Más fiable que el modelo cuando el nombre es literal.
 * - `BIN`: el último escalón, `GASTOS.OTROS` / `INGRESOS.OTROS`. Afirma el signo
 *   del movimiento y nada más, y siempre va marcado para revisión.
 */
export type DecidedBy = 'MODEL' | 'RULE' | 'BIN';

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

/**
 * Lo que costó la llamada, tal como lo declaró quien la atendió.
 *
 * Es OPCIONAL en todos sus campos y en el conjunto: un adaptador local no
 * consume tokens y un gateway puede no publicar el coste. Rellenar ceros para
 * que el tipo cuadre haría indistinguible «no gastó» de «no lo dijo», y es la
 * segunda la que hay que investigar cuando el panel de coste se queda plano.
 */
export interface ProviderUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
  /** Coste estimado por el gateway, en su moneda de facturación (USD en LiteLLM). */
  readonly estimatedCost?: number;
}

export interface ModelClassification {
  readonly assessments: readonly CategoryAssessment[];
  /**
   * El modelo que se PIDIÓ. Con un gateway por delante es el alias lógico
   * (`semantic-classifier-fast`), no el proveedor físico: es lo que mantiene
   * acotada la etiqueta de las métricas y lo que sigue siendo cierto cuando el
   * gateway cambia de proveedor por debajo.
   */
  readonly model: string;
  /**
   * El modelo que RESPONDIÓ. Con un gateway es el despliegue físico que atendió
   * la llamada, que es justo lo que hace falta para saber si contestó el modelo
   * primario o su suplente.
   */
  readonly modelVersion: string;
  readonly usage?: ProviderUsage;
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
  /** Quién decidió: el modelo, una regla determinista o el cajón por sentido. */
  readonly decidedBy: DecidedBy;
  /**
   * El caso tiene categoría **y** debería mirarlo alguien.
   *
   * Los consumidores que antes filtraban por `status === 'UNKNOWN'` para saber
   * qué revisar deben mirar esto: el estado ya no se queda en `UNKNOWN`.
   */
  readonly requiresReview: boolean;
  /** Motivo de revisión con el vocabulario cerrado de la bandeja, o `null`. */
  readonly reviewReason: string | null;
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
