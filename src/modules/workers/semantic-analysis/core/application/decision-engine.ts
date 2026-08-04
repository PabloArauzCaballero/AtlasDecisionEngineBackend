import { Injectable } from '@nestjs/common';
import {
  CategoryAssessment,
  DecisionStatus,
  SemanticCategory,
} from '../domain/semantic-analysis.types';

export interface Decision {
  readonly status: DecisionStatus;
  readonly matches: readonly CategoryAssessment[];
  readonly requiresDeepAnalysis: boolean;
}

@Injectable()
export class DecisionEngine {
  public decide(
    assessments: readonly CategoryAssessment[],
    categories: readonly SemanticCategory[],
    ambiguityMargin: number,
    tier: 'FAST' | 'DEEP',
  ): Decision {
    const categoryByCode = new Map(categories.map((category) => [category.code, category]));
    const accepted = assessments
      .filter((assessment) => {
        const category = categoryByCode.get(assessment.categoryCode);
        return (
          category !== undefined &&
          assessment.supported &&
          !assessment.contradicted &&
          assessment.confidence >= category.acceptanceThreshold
        );
      })
      .sort((left, right) => right.confidence - left.confidence);

    const contradicted = assessments.filter((assessment) => assessment.contradicted);
    const ambiguous = this.hasAmbiguousTopScores(assessments, ambiguityMargin);
    const unanimouslyContradicted =
      assessments.length > 0 && contradicted.length === assessments.length;

    // Una contradicción unánime es concluyente en cualquier tier: escalarla sólo duplica el coste.
    if (unanimouslyContradicted) {
      return { status: 'CONTRADICTED', matches: [], requiresDeepAnalysis: false };
    }
    if (tier === 'FAST' && (accepted.length === 0 || ambiguous)) {
      return { status: 'AMBIGUOUS', matches: accepted, requiresDeepAnalysis: true };
    }
    if (accepted.length > 1) {
      return { status: 'MULTI_MATCH', matches: accepted, requiresDeepAnalysis: false };
    }
    if (accepted.length === 1 && !ambiguous) {
      return { status: 'MATCH', matches: accepted, requiresDeepAnalysis: false };
    }
    return {
      status: ambiguous ? 'AMBIGUOUS' : 'UNKNOWN',
      matches: [],
      requiresDeepAnalysis: false,
    };
  }

  private hasAmbiguousTopScores(
    assessments: readonly CategoryAssessment[],
    ambiguityMargin: number,
  ): boolean {
    const supported = assessments
      .filter((assessment) => assessment.supported && !assessment.contradicted)
      .sort((left, right) => right.confidence - left.confidence);
    const first = supported[0];
    const second = supported[1];
    return first !== undefined && second !== undefined
      ? Math.abs(first.confidence - second.confidence) <= ambiguityMargin
      : false;
  }
}
