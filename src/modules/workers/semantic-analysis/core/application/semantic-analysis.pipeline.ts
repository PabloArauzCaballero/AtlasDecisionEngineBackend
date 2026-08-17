import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  CANDIDATE_RETRIEVER,
  CandidateRetriever,
  SEMANTIC_METRICS_RECORDER,
  SEMANTIC_MODEL_PROVIDER,
  SEMANTIC_WORKER_CONFIG,
  SemanticMetricsRecorder,
  SemanticModelProvider,
} from './ports';
import { CatalogCache } from './catalog-cache';
import { CachedClassification, ClassificationCache } from './classification-cache';
import { EntityResolver } from './entity-resolver';
import { Decision, DecisionEngine } from './decision-engine';
import { GlosaFallbackClassifier } from './glosa-fallback';
import { TenantBudgetGuard } from './tenant-budget.guard';
import { TextNormalizer } from './text-normalizer';
import {
  AnalysisTier,
  CategoryCandidate,
  ModelClassification,
  ModelClassificationInput,
  SemanticAnalysisRequest,
  SemanticAnalysisResult,
  SemanticCategory,
} from '../domain/semantic-analysis.types';
import { semanticAnalysisRequestSchema } from '../domain/semantic-analysis.schemas';
import { leavesOf } from '../domain/category-tree';
import { SemanticWorkerConfig } from '../config/semantic-worker.config';
import { SemanticTimeoutError } from '../domain/semantic-analysis.errors';
import { TracingService } from '../../../../../common/observability/tracing.service';
import { SEMANTIC_ATTRIBUTES, SPAN_NAMES } from '../observability/telemetry.constants';
import {
  analyzeAttributes,
  classifyAttributes,
  retrieveAttributes,
} from './semantic-analysis.attributes';
import { SemanticAnalysisResultBuilder } from './semantic-analysis.result-builder';

const NO_CATEGORIES_MODEL = 'none';
const BUDGET_EXHAUSTED_MODEL = 'budget-exhausted';

const UNRESOLVED: Decision = { status: 'UNKNOWN', matches: [], requiresDeepAnalysis: false };

/**
 * Orquesta el análisis semántico completo: catálogo, normalización, entidades, presupuesto,
 * recuperación, clasificación por tiers y decisión.
 *
 * Sólo coordina. Lo que es separable vive fuera: la decisión en `DecisionEngine`, la recuperación
 * tras el puerto `CandidateRetriever`, el ensamblado del resultado y su telemetría en
 * `SemanticAnalysisResultBuilder` y los atributos de span en `semantic-analysis.attributes.ts`.
 */
@Injectable()
export class SemanticAnalysisPipeline {
  private readonly logger = new Logger(SemanticAnalysisPipeline.name);

  public constructor(
    @Inject(SEMANTIC_MODEL_PROVIDER)
    private readonly modelProvider: SemanticModelProvider,
    @Inject(SEMANTIC_WORKER_CONFIG)
    private readonly config: SemanticWorkerConfig,
    @Inject(SEMANTIC_METRICS_RECORDER)
    private readonly metrics: SemanticMetricsRecorder,
    @Inject(CANDIDATE_RETRIEVER)
    private readonly candidateRetriever: CandidateRetriever,
    private readonly catalog: CatalogCache,
    private readonly clasificaciones: ClassificationCache,
    private readonly budget: TenantBudgetGuard,
    private readonly normalizer: TextNormalizer,
    private readonly entityResolver: EntityResolver,
    private readonly decisionEngine: DecisionEngine,
    private readonly tracing: TracingService,
    private readonly resultBuilder: SemanticAnalysisResultBuilder,
    private readonly fallback: GlosaFallbackClassifier,
  ) {}

  /**
   * La decisión final, con la red de seguridad puesta.
   *
   * Si el modelo resolvió, manda el modelo y aquí no pasa nada. Si no —umbral no
   * alcanzado, empate, o ni siquiera hubo candidatas—, la glosa se lee por
   * REGLAS de instrumento: `TRASPASO`, `QR`, `RETIRO DE EFECTIVO` y compañía son
   * literales, están en todos los extractos bolivianos y no necesitan modelo.
   *
   * Lo que se gana no es precisión, es COBERTURA honesta: «salió dinero por
   * transferencia» consta en la glosa; «sin determinar» no dice nada y obliga a
   * quien recibe el informe a resolverlo por su cuenta, fila por fila.
   */
  private conRedDeSeguridad(
    decision: Decision,
    normalizedText: string,
    categories: readonly SemanticCategory[],
  ): Decision {
    if (decision.status !== 'UNKNOWN' && decision.status !== 'AMBIGUOUS') return decision;
    const disponibles = new Set(leavesOf(categories).map((categoria) => categoria.code));
    const regla = this.fallback.clasificar(normalizedText, disponibles);
    if (regla === null) return decision;

    this.logger.debug(`Glosa resuelta por regla como ${regla.categoryCode}.`);
    return {
      status: 'MATCH',
      requiresDeepAnalysis: false,
      matches: [
        {
          categoryCode: regla.categoryCode,
          confidence: regla.confidence,
          supported: true,
          contradicted: false,
          evidence: [regla.evidence],
          rationale: regla.rationale,
        },
      ],
    };
  }

  /**
   * Envuelve el análisis en su span de negocio: la ruta crítica del sistema. Bajo él cuelgan el
   * catálogo, el presupuesto, la recuperación, el proveedor y todo el SQL que disparen.
   */
  public analyze(request: SemanticAnalysisRequest): Promise<SemanticAnalysisResult> {
    return this.tracing.runInSpan(
      SPAN_NAMES.analyze,
      analyzeAttributes(request, this.config.retrievalMode),
      () => this.runAnalysis(request),
    );
  }

  /**
   * Ejecuta recuperación, clasificación rápida, escalamiento selectivo y decisión final.
   *
   * El análisis completo está acotado por `analysisTimeoutSeconds`: agotarlo aborta la llamada al
   * proveedor en curso y produce un error reintentable antes de que la cola expire el job, de modo
   * que un intento colgado nunca coexiste con su propio reintento.
   */
  private async runAnalysis(
    untrustedRequest: SemanticAnalysisRequest,
  ): Promise<SemanticAnalysisResult> {
    const startedAt = performance.now();
    const request = semanticAnalysisRequestSchema.parse(untrustedRequest);
    const budget = AbortSignal.timeout(this.config.analysisTimeoutSeconds * 1_000);

    const { categories, aliases, signature } = await this.catalog.load(request.tenantId);
    /*
     * Dos textos, y no por comodidad: el resolutor de entidades busca los
     * nombres canónicos, así que necesita los alias YA desplegados; el
     * clasificador necesita lo contrario —la glosa como el banco la escribió y
     * sin los identificadores que la ahogan—. Compartir un solo texto obligaba a
     * elegir cuál de los dos trabajaba mal, y el que trabajaba mal era el que
     * decide la categoría.
     *
     * `normalizedText` es el que se guarda y se enseña porque es el que se
     * clasificó: una traza que mostrara otro texto no explicaría el veredicto.
     */
    const textoConAlias = this.normalizer.normalize(request.text, aliases);
    const normalizedText = this.normalizer.forClassification(request.text, aliases);
    const entities = this.entityResolver.resolve(textoConAlias, aliases);

    /*
     * Antes del presupuesto, y no después: un acierto de caché no llama al
     * proveedor, así que reservar cuota por él cobraría un gasto que no se ha
     * producido. Con un extracto lleno de glosas repetidas eso agotaba el
     * presupuesto del tenant clasificando veinte conceptos distintos.
     */
    const recordada = this.clasificaciones.read(request.tenantId, signature, normalizedText);
    if (recordada !== undefined) {
      this.logger.debug(`Glosa de ${request.requestId} resuelta desde la caché de clasificación.`);
      return this.resultBuilder.build({
        request,
        normalizedText,
        entities,
        candidates: recordada.candidates,
        categories,
        decision: recordada.decision,
        tier: recordada.tier,
        model: recordada.model,
        modelVersion: recordada.modelVersion,
        startedAt,
        escalated: recordada.escalated,
      });
    }

    const allowance = await this.budget.reserve(request.tenantId);
    if (!allowance.allowed) {
      // Degradar en lugar de fallar: un error haría que la cola reintentara y gastara justo la
      // cuota que el presupuesto pretende proteger.
      this.logger.warn(`Solicitud ${request.requestId} degradada a UNKNOWN: ${allowance.reason}.`);
      return this.resultBuilder.build({
        request,
        normalizedText,
        entities,
        candidates: [],
        categories,
        decision: UNRESOLVED,
        tier: 'FAST',
        model: BUDGET_EXHAUSTED_MODEL,
        modelVersion: BUDGET_EXHAUSTED_MODEL,
        startedAt,
        escalated: false,
      });
    }

    const candidates = await this.retrieveCandidates(normalizedText, categories, budget);

    if (candidates.length === 0) {
      this.logger.warn(
        `Sin categorías activas aplicables para la solicitud ${request.requestId}; no se invoca al modelo.`,
      );
      return this.resultBuilder.build({
        request,
        normalizedText,
        entities,
        categories,
        startedAt,
        ...this.recuerda(request.tenantId, signature, normalizedText, {
          candidates,
          decision: this.conRedDeSeguridad(UNRESOLVED, normalizedText, categories),
          tier: 'FAST',
          model: NO_CATEGORIES_MODEL,
          modelVersion: NO_CATEGORIES_MODEL,
          escalated: false,
        }),
      });
    }

    const modelInput: ModelClassificationInput = {
      originalText: request.text,
      normalizedText,
      entities,
      candidates,
    };
    const candidateCategories = candidates.map((candidate) => candidate.category);

    const fast = await this.classify(modelInput, 'FAST', budget);
    const fastDecision = this.decisionEngine.decide(
      fast.assessments,
      candidateCategories,
      this.config.ambiguityMargin,
      'FAST',
    );

    if (!fastDecision.requiresDeepAnalysis) {
      await this.budget.recordProviderCalls(request.tenantId, 1);
      return this.resultBuilder.build({
        request,
        normalizedText,
        entities,
        categories,
        startedAt,
        ...this.recuerda(request.tenantId, signature, normalizedText, {
          candidates,
          decision: this.conRedDeSeguridad(fastDecision, normalizedText, categories),
          tier: 'FAST',
          model: fast.model,
          modelVersion: fast.modelVersion,
          escalated: false,
        }),
      });
    }

    const deep = await this.classify(modelInput, 'DEEP', budget);
    const deepDecision = this.decisionEngine.decide(
      deep.assessments,
      candidateCategories,
      this.config.ambiguityMargin,
      'DEEP',
    );
    await this.budget.recordProviderCalls(request.tenantId, 2);

    return this.resultBuilder.build({
      request,
      normalizedText,
      entities,
      categories,
      startedAt,
      ...this.recuerda(request.tenantId, signature, normalizedText, {
        candidates,
        decision: this.conRedDeSeguridad(deepDecision, normalizedText, categories),
        tier: 'DEEP',
        model: deep.model,
        modelVersion: deep.modelVersion,
        escalated: true,
      }),
    });
  }

  /**
   * Graba el veredicto y lo devuelve para armar el resultado de esta solicitud.
   *
   * Se graba la decisión YA pasada por la red de seguridad: es la que el motor
   * publica, y guardar la anterior obligaría a volver a aplicar las reglas en
   * cada acierto para llegar al mismo sitio.
   *
   * Sólo pasa por aquí lo que se calculó de verdad. La degradación por
   * presupuesto agotado retorna antes y no toca esta función: ese `UNKNOWN`
   * describe la cuota, no el texto.
   */
  private recuerda(
    tenantId: string | undefined,
    signature: string,
    normalizedText: string,
    clasificacion: CachedClassification,
  ): CachedClassification {
    this.clasificaciones.write(tenantId, signature, normalizedText, clasificacion);
    return clasificacion;
  }

  /**
   * Span propio porque es la etapa que más varía entre configuraciones: en modo híbrido añade una
   * llamada de embeddings y una consulta de vectores que, sin él, colgarían del análisis sin
   * explicación.
   *
   * **Sólo se proponen las HOJAS del árbol de categorías.** Un nodo intermedio —«Vivienda»— agrupa
   * a sus hijas y no describe ningún caso concreto: aceptarlo como resultado sería clasificar con
   * menos detalle del que el catálogo ofrece, y encima competiría con sus propias hojas por el
   * mismo texto. En un catálogo plano, donde ninguna categoría tiene hijas, todas son hojas y esto
   * no cambia nada.
   */
  private retrieveCandidates(
    normalizedText: string,
    categories: readonly SemanticCategory[],
    budget: AbortSignal,
  ): Promise<readonly CategoryCandidate[]> {
    const classifiable = leavesOf(categories);
    return this.tracing.runInSpan(
      SPAN_NAMES.retrieve,
      retrieveAttributes(this.config.retrievalMode, classifiable.length),
      async (span) => {
        const candidates = await this.candidateRetriever.retrieve(
          normalizedText,
          classifiable,
          this.config.candidateLimit,
          budget,
        );
        span.setAttribute(SEMANTIC_ATTRIBUTES.candidateCount, candidates.length);
        return candidates;
      },
    );
  }

  private classify(
    input: ModelClassificationInput,
    tier: AnalysisTier,
    budget: AbortSignal,
  ): Promise<ModelClassification> {
    return this.tracing.runInSpan(
      SPAN_NAMES.classify,
      classifyAttributes(tier, input.candidates.length),
      async (span) => {
        const classification = await this.callProvider(input, tier, budget);
        span.setAttribute(SEMANTIC_ATTRIBUTES.model, classification.model);
        return classification;
      },
    );
  }

  private async callProvider(
    input: ModelClassificationInput,
    tier: AnalysisTier,
    budget: AbortSignal,
  ): Promise<ModelClassification> {
    if (budget.aborted) {
      throw new SemanticTimeoutError(
        `El presupuesto de ${String(this.config.analysisTimeoutSeconds)} s se agotó antes del tier ${tier}.`,
      );
    }
    const startedAt = performance.now();
    try {
      const classification = await this.modelProvider.classify(input, tier, budget);
      this.metrics.recordProviderCall({
        tier,
        model: classification.model,
        durationMs: Math.round(performance.now() - startedAt),
        attempts: 1,
        outcome: 'SUCCESS',
      });
      return classification;
    } catch (error: unknown) {
      this.metrics.recordProviderCall({
        tier,
        model: this.modelProvider.modelFor?.(tier) ?? 'unknown',
        durationMs: Math.round(performance.now() - startedAt),
        attempts: 1,
        outcome: 'FAILURE',
      });
      if (budget.aborted) {
        throw new SemanticTimeoutError(
          `El análisis superó ${String(this.config.analysisTimeoutSeconds)} s durante el tier ${tier}.`,
          { cause: error },
        );
      }
      throw error;
    }
  }
}
