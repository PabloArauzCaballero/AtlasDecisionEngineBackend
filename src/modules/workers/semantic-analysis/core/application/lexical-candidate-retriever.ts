import { Injectable } from '@nestjs/common';
import { CandidateRetriever } from './ports';
import { CategoryCandidate, SemanticCategory } from '../domain/semantic-analysis.types';

const DIACRITIC = /\p{Diacritic}/gu;
const NON_ALPHANUMERIC = /[^\p{Letter}\p{Number}]+/u;
const MINIMUM_TOKEN_LENGTH = 3;

@Injectable()
export class LexicalCandidateRetriever implements CandidateRetriever {
  /**
   * Reduce el universo de categorías mediante solapamiento léxico.
   * No toma la decisión semántica final.
   *
   * Descarta las categorías sin ningún solapamiento cuando existe al menos una con evidencia
   * léxica: enviarlas al modelo sólo añade coste y ruido. Si ninguna categoría solapa se
   * conserva el corte por límite, para no perder recall en textos con vocabulario distinto.
   */
  public retrieve(
    normalizedText: string,
    categories: readonly SemanticCategory[],
    limit: number,
  ): Promise<readonly CategoryCandidate[]> {
    return Promise.resolve(this.retrieveSync(normalizedText, categories, limit));
  }

  /** Variante síncrona: el modo híbrido la usa como componente léxico de su puntuación. */
  public retrieveSync(
    normalizedText: string,
    categories: readonly SemanticCategory[],
    limit: number,
  ): readonly CategoryCandidate[] {
    const inputTokens = this.tokenize(normalizedText);
    const scored = categories
      .map((category) => ({
        category,
        retrievalScore: this.calculateScore(inputTokens, category),
      }))
      .sort((left, right) => this.compareCandidates(left, right));

    const relevant = scored.filter((candidate) => candidate.retrievalScore > 0);
    return (relevant.length > 0 ? relevant : scored).slice(0, limit);
  }

  /**
   * Ordena por score y desempata por código para que el conjunto de candidatos sea determinista.
   */
  private compareCandidates(left: CategoryCandidate, right: CategoryCandidate): number {
    return right.retrievalScore === left.retrievalScore
      ? left.category.code.localeCompare(right.category.code)
      : right.retrievalScore - left.retrievalScore;
  }

  private calculateScore(inputTokens: ReadonlySet<string>, category: SemanticCategory): number {
    const categoryText = [
      category.name,
      category.description,
      ...category.positiveExamples,
      ...category.relatedCategoryCodes,
    ].join(' ');
    const categoryTokens = this.tokenize(categoryText);
    const matchingTokens = [...inputTokens].filter((token) => categoryTokens.has(token)).length;
    const denominator = Math.max(1, Math.sqrt(inputTokens.size * categoryTokens.size));
    return Number((matchingTokens / denominator).toFixed(6));
  }

  private tokenize(text: string): ReadonlySet<string> {
    const tokens = text
      .toLocaleLowerCase()
      .normalize('NFD')
      .replace(DIACRITIC, '')
      .split(NON_ALPHANUMERIC)
      .filter((token) => token.length >= MINIMUM_TOKEN_LENGTH);
    return new Set(tokens);
  }
}
