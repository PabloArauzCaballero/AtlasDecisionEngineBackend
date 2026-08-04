import { Inject, Injectable } from '@nestjs/common';
import { SEMANTIC_METRICS_RECORDER, SemanticMetricsRecorder } from './ports';
import type { Decision } from './decision-engine';
import {
  AnalysisTier,
  CategoryCandidate,
  ResolvedEntity,
  SemanticAnalysisRequest,
  SemanticAnalysisResult,
} from '../domain/semantic-analysis.types';
import { TracingService } from '../observability/tracing.service';
import { outcomeAttributes } from './semantic-analysis.attributes';

export interface ResultInput {
  readonly request: SemanticAnalysisRequest;
  readonly normalizedText: string;
  readonly entities: readonly ResolvedEntity[];
  readonly candidates: readonly CategoryCandidate[];
  readonly decision: Decision;
  readonly tier: AnalysisTier;
  readonly model: string;
  readonly modelVersion: string;
  readonly startedAt: number;
  readonly escalated: boolean;
}

/**
 * Ensambla el resultado auditable y publica su telemetría.
 *
 * El pipeline lo invoca desde sus cuatro salidas —presupuesto agotado, sin categorías, tier rápido y
 * tier profundo—, de modo que el resultado, la métrica y los atributos del span se construyen
 * siempre igual. Antes vivía dentro del pipeline; separarlo evita que una salida nueva olvide
 * publicar la métrica o anotar el desenlace, que es un fallo silencioso: el análisis funcionaría y
 * sólo faltaría en los tableros.
 */
@Injectable()
export class SemanticAnalysisResultBuilder {
  public constructor(
    @Inject(SEMANTIC_METRICS_RECORDER)
    private readonly metrics: SemanticMetricsRecorder,
    private readonly tracing: TracingService,
  ) {}

  public build(input: ResultInput): SemanticAnalysisResult {
    const processingTimeMs = Math.round(performance.now() - input.startedAt);
    const result: SemanticAnalysisResult = {
      requestId: input.request.requestId,
      status: input.decision.status,
      normalizedText: input.normalizedText,
      entities: input.entities,
      matches: input.decision.matches,
      evaluatedCategoryCodes: input.candidates.map((candidate) => candidate.category.code),
      tierUsed: input.tier,
      model: input.model,
      modelVersion: input.modelVersion,
      processingTimeMs,
    };

    this.metrics.recordAnalysis({
      status: result.status,
      tierUsed: result.tierUsed,
      escalated: input.escalated,
      processingTimeMs,
      candidateCount: input.candidates.length,
      tenantId: input.request.tenantId,
    });
    // El desenlace se anota en el span del análisis, que sigue activo: son los atributos por los
    // que se filtra en Jaeger.
    this.tracing.setAttributes(
      outcomeAttributes({
        status: result.status,
        tier: result.tierUsed,
        escalated: input.escalated,
        model: result.model,
        candidateCount: input.candidates.length,
      }),
    );
    return result;
  }
}
