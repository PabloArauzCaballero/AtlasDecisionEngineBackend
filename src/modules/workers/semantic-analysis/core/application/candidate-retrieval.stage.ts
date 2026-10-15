import { Inject, Injectable } from '@nestjs/common';
import { CANDIDATE_RETRIEVER, CandidateRetriever, SEMANTIC_WORKER_CONFIG } from './ports';
import { CategoryCandidate, SemanticCategory } from '../domain/semantic-analysis.types';
import { leavesOf } from '../domain/category-tree';
import { SemanticWorkerConfig } from '../config/semantic-worker.config';
import { TracingService } from '../../../../../common/observability/tracing.service';
import { SEMANTIC_ATTRIBUTES, SPAN_NAMES } from '../observability/telemetry.constants';
import { retrieveAttributes } from './semantic-analysis.attributes';

/** La recuperación de candidatas tras el puerto `CandidateRetriever`, con su span. */
@Injectable()
export class CandidateRetrievalStage {
  public constructor(
    @Inject(SEMANTIC_WORKER_CONFIG)
    private readonly config: SemanticWorkerConfig,
    @Inject(CANDIDATE_RETRIEVER)
    private readonly candidateRetriever: CandidateRetriever,
    private readonly tracing: TracingService,
  ) {}

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
  public retrieve(
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
}
