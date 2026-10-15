import { Inject, Injectable } from '@nestjs/common';
import {
  SEMANTIC_METRICS_RECORDER,
  SEMANTIC_MODEL_PROVIDER,
  SEMANTIC_WORKER_CONFIG,
  SemanticMetricsRecorder,
  SemanticModelProvider,
} from './ports';
import { Decision, DecisionEngine } from './decision-engine';
import { TenantBudgetGuard } from './tenant-budget.guard';
import {
  AnalysisTier,
  CategoryCandidate,
  ModelClassification,
  ModelClassificationInput,
  ProviderUsage,
} from '../domain/semantic-analysis.types';
import { SemanticWorkerConfig } from '../config/semantic-worker.config';
import { SemanticTimeoutError } from '../domain/semantic-analysis.errors';
import { TracingService } from '../../../../../common/observability/tracing.service';
import { SEMANTIC_ATTRIBUTES, SPAN_NAMES } from '../observability/telemetry.constants';
import { classifyAttributes } from './semantic-analysis.attributes';

/** Lo que decidió el modelo y con qué tier y versión, antes de la red de seguridad. */
export interface ModelTierOutcome {
  decision: Decision;
  tier: AnalysisTier;
  model: string;
  modelVersion: string;
  escalated: boolean;
}

/**
 * Las dos pasadas del modelo: la rápida y, sólo si la decisión lo pide, la
 * profunda. Cada llamada al proveedor lleva su span, su métrica y el reloj del
 * análisis; el gasto de llamadas se anota contra el presupuesto del tenant.
 */
@Injectable()
export class TieredModelClassifier {
  public constructor(
    @Inject(SEMANTIC_MODEL_PROVIDER)
    private readonly modelProvider: SemanticModelProvider,
    @Inject(SEMANTIC_WORKER_CONFIG)
    private readonly config: SemanticWorkerConfig,
    @Inject(SEMANTIC_METRICS_RECORDER)
    private readonly metrics: SemanticMetricsRecorder,
    private readonly tracing: TracingService,
    private readonly decisionEngine: DecisionEngine,
    private readonly budget: TenantBudgetGuard,
  ) {}

  /**
   * Las dos pasadas del modelo y su decisión, aparte de la orquestación.
   *
   * Vive fuera de `runAnalysis` porque el rescate por lentitud necesita un
   * `try` que abarque las llamadas al proveedor y nada más: si abarcara también
   * el catálogo, la caché y el presupuesto, un fallo de la base se habría
   * publicado como si el modelo hubiera tardado.
   */
  public async classify(
    tenantId: string | undefined,
    modelInput: ModelClassificationInput,
    candidates: readonly CategoryCandidate[],
    budget: AbortSignal,
  ): Promise<ModelTierOutcome> {
    const candidateCategories = candidates.map((candidate) => candidate.category);

    const fast = await this.callTier(modelInput, 'FAST', budget);
    const fastDecision = this.decisionEngine.decide(
      fast.assessments,
      candidateCategories,
      this.config.ambiguityMargin,
      'FAST',
    );

    if (!fastDecision.requiresDeepAnalysis) {
      await this.budget.recordProviderCalls(tenantId, 1);
      return {
        decision: fastDecision,
        tier: 'FAST',
        model: fast.model,
        modelVersion: fast.modelVersion,
        escalated: false,
      };
    }

    const deep = await this.callTier(modelInput, 'DEEP', budget);
    const deepDecision = this.decisionEngine.decide(
      deep.assessments,
      candidateCategories,
      this.config.ambiguityMargin,
      'DEEP',
    );
    await this.budget.recordProviderCalls(tenantId, 2);
    return {
      decision: deepDecision,
      tier: 'DEEP',
      model: deep.model,
      modelVersion: deep.modelVersion,
      escalated: true,
    };
  }

  private callTier(
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
        // Sólo lo que el proveedor declaró: un atributo ausente dice «no lo
        // dijo», y un cero puesto por nosotros diría «no gastó». Con un gateway
        // que factura por token esa diferencia es la única pista de que la
        // contabilidad de coste dejó de llegar.
        if (classification.modelVersion !== classification.model) {
          span.setAttribute(SEMANTIC_ATTRIBUTES.resolvedModel, classification.modelVersion);
        }
        setUsageAttributes(span, classification.usage);
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

/** Vuelca el consumo declarado sobre el span, omitiendo lo que no llegó. */
function setUsageAttributes(
  span: { setAttribute: (key: string, value: number) => unknown },
  usage: ProviderUsage | undefined,
): void {
  if (usage === undefined) return;
  const { inputTokens, outputTokens, totalTokens, estimatedCost } = usage;
  if (inputTokens !== undefined) span.setAttribute(SEMANTIC_ATTRIBUTES.inputTokens, inputTokens);
  if (outputTokens !== undefined) span.setAttribute(SEMANTIC_ATTRIBUTES.outputTokens, outputTokens);
  if (totalTokens !== undefined) span.setAttribute(SEMANTIC_ATTRIBUTES.totalTokens, totalTokens);
  if (estimatedCost !== undefined) {
    span.setAttribute(SEMANTIC_ATTRIBUTES.estimatedCost, estimatedCost);
  }
}
