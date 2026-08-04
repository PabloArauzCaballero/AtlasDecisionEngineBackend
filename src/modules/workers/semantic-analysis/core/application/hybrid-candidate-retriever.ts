import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  CANDIDATE_RETRIEVER,
  CATEGORY_EMBEDDING_REPOSITORY,
  CandidateRetriever,
  CategoryEmbeddingRepository,
  EMBEDDING_PROVIDER,
  EmbeddingProvider,
  SEMANTIC_WORKER_CONFIG,
  StoredCategoryEmbedding,
} from './ports';
import { LexicalCandidateRetriever } from './lexical-candidate-retriever';
import { SemanticWorkerConfig } from '../config/semantic-worker.config';
import { CategoryCandidate, SemanticCategory } from '../domain/semantic-analysis.types';

/**
 * Recuperador híbrido: combina solapamiento léxico con similitud vectorial.
 *
 * Resuelve el caso que el recuperador léxico no puede — texto y categoría que significan lo mismo
 * sin compartir vocabulario — sin renunciar a la señal léxica, que sigue siendo la más precisa
 * cuando hay coincidencia literal.
 *
 * La similitud se calcula en el proceso sobre vectores persistidos, no en la base de datos. Un
 * catálogo de categorías es pequeño por naturaleza —decenas o pocos centenares de entradas—, de
 * modo que un producto escalar sobre esa cantidad es despreciable frente a la llamada al modelo, y
 * evita exigir la extensión `pgvector`. Con catálogos de muchos miles de categorías la decisión
 * correcta sería la contraria.
 *
 * Ante un fallo del proveedor de embeddings degrada al recuperador léxico: perder recall es
 * preferible a no clasificar.
 */
@Injectable()
export class HybridCandidateRetriever implements CandidateRetriever {
  private readonly logger = new Logger(HybridCandidateRetriever.name);

  public constructor(
    @Inject(CANDIDATE_RETRIEVER)
    private readonly lexical: LexicalCandidateRetriever,
    @Inject(EMBEDDING_PROVIDER)
    private readonly embeddings: EmbeddingProvider,
    @Inject(CATEGORY_EMBEDDING_REPOSITORY)
    private readonly embeddingRepository: CategoryEmbeddingRepository,
    @Inject(SEMANTIC_WORKER_CONFIG)
    private readonly config: SemanticWorkerConfig,
  ) {}

  public async retrieve(
    normalizedText: string,
    categories: readonly SemanticCategory[],
    limit: number,
    signal?: AbortSignal,
  ): Promise<readonly CategoryCandidate[]> {
    if (categories.length === 0) {
      return [];
    }
    // Se puntúa el catálogo completo, no sólo el recorte léxico: el objetivo es rescatar
    // precisamente las categorías que el léxico descarta.
    const lexicalScores = new Map(
      this.lexical
        .retrieveSync(normalizedText, categories, categories.length)
        .map((candidate) => [candidate.category.id, candidate.retrievalScore]),
    );

    let vectors: ReadonlyMap<string, readonly number[]>;
    let textVector: readonly number[];
    try {
      [vectors, textVector] = await Promise.all([
        this.resolveCategoryVectors(categories, signal),
        this.embedText(normalizedText, signal),
      ]);
    } catch (error: unknown) {
      this.logger.warn(
        'La recuperación por embeddings falló; se degrada al recuperador léxico.',
        error,
      );
      return this.lexical.retrieve(normalizedText, categories, limit);
    }

    const weight = this.config.retrievalSemanticWeight;
    const scored = categories
      .map((category) => {
        const lexicalScore = lexicalScores.get(category.id) ?? 0;
        const vector = vectors.get(category.id);
        const semanticScore = vector === undefined ? 0 : cosineSimilarity(textVector, vector);
        return {
          category,
          retrievalScore: round(weight * semanticScore + (1 - weight) * lexicalScore),
        };
      })
      .sort((left, right) =>
        right.retrievalScore === left.retrievalScore
          ? left.category.code.localeCompare(right.category.code)
          : right.retrievalScore - left.retrievalScore,
      );

    const relevant = scored.filter((candidate) => candidate.retrievalScore > 0);
    return (relevant.length > 0 ? relevant : scored).slice(0, limit);
  }

  /**
   * Devuelve el vector de cada categoría, calculando y persistiendo sólo los que faltan.
   *
   * La clave incluye la versión de la categoría, de modo que publicar una versión nueva invalida
   * su vector sin necesidad de purga manual.
   */
  private async resolveCategoryVectors(
    categories: readonly SemanticCategory[],
    signal?: AbortSignal,
  ): Promise<ReadonlyMap<string, readonly number[]>> {
    const model = this.embeddings.model;
    const stored = await this.embeddingRepository.findByCategoryIds(
      categories.map((category) => category.id),
      model,
    );
    const byId = new Map(
      stored.map((embedding) => [
        `${embedding.categoryId}@${String(embedding.version)}`,
        embedding,
      ]),
    );

    const missing = categories.filter(
      (category) => !byId.has(`${category.id}@${String(category.version)}`),
    );
    if (missing.length > 0) {
      const computed = await this.embeddings.embed(
        missing.map((category) => this.describeCategory(category)),
        signal,
      );
      const fresh: StoredCategoryEmbedding[] = missing.flatMap((category, index) => {
        const vector = computed[index];
        return vector === undefined
          ? []
          : [{ categoryId: category.id, version: category.version, model, vector }];
      });
      await this.embeddingRepository.save(fresh);
      for (const embedding of fresh) {
        byId.set(`${embedding.categoryId}@${String(embedding.version)}`, embedding);
      }
      this.logger.log(`Calculados ${String(fresh.length)} vectores de categoría con ${model}.`);
    }

    return new Map(
      categories.flatMap((category) => {
        const embedding = byId.get(`${category.id}@${String(category.version)}`);
        return embedding === undefined ? [] : [[category.id, embedding.vector] as const];
      }),
    );
  }

  private async embedText(text: string, signal?: AbortSignal): Promise<readonly number[]> {
    const [vector] = await this.embeddings.embed([text], signal);
    if (vector === undefined) {
      throw new Error('El proveedor de embeddings no devolvió ningún vector.');
    }
    return vector;
  }

  /**
   * Los contraejemplos se excluyen a propósito: describen lo que la categoría **no** es, y meterlos
   * en el vector acercaría la categoría justo a los textos que debe rechazar.
   */
  private describeCategory(category: SemanticCategory): string {
    return [category.name, category.description, ...category.positiveExamples].join('. ');
  }
}

export function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
  const length = Math.min(left.length, right.length);
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftNorm += leftValue * leftValue;
    rightNorm += rightValue * rightValue;
  }
  if (leftNorm === 0 || rightNorm === 0) {
    return 0;
  }
  // Se acota a [0, 1]: una similitud negativa no aporta señal de recuperación.
  return Math.max(0, dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm)));
}

function round(value: number): number {
  return Number(value.toFixed(6));
}
