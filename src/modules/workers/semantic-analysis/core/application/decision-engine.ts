import { Injectable } from '@nestjs/common';
import {
  CategoryAssessment,
  DecidedBy,
  DecisionStatus,
  SemanticCategory,
} from '../domain/semantic-analysis.types';
import type { MotivoDeRevision } from '../domain/review-reason';

export interface Decision {
  readonly status: DecisionStatus;
  readonly matches: readonly CategoryAssessment[];
  readonly requiresDeepAnalysis: boolean;
  /**
   * Quién produjo la categoría que se publica.
   *
   * Existe porque el resultado dejó de tener un solo autor. Desde que la red de
   * seguridad garantiza que SIEMPRE hay categoría, «tiene categoría» ya no
   * significa «el modelo la entendió», y sin este campo las dos cosas se leen
   * igual en el informe, en la métrica y en la bandeja. Un `MATCH` del modelo y
   * un cajón por sentido no se pueden sumar en el mismo número.
   */
  readonly decidedBy: DecidedBy;
  /**
   * Si el caso debe pasar por la bandeja **aunque tenga categoría**.
   *
   * Es la contrapartida honesta de no abstenerse nunca: se publica algo útil y
   * se dice, en el mismo objeto, que alguien debería mirarlo. Sin esto, dejar de
   * emitir `UNKNOWN` habría vaciado la bandeja de revisión sin haber resuelto un
   * solo caso más.
   */
  readonly requiresReview: boolean;
  /** Por qué hay que revisarlo, con el vocabulario cerrado de la bandeja. */
  readonly reviewReason: MotivoDeRevision | null;
}

/** Una decisión del modelo, que es la única que no necesita revisión por origen. */
function delModelo(
  status: DecisionStatus,
  matches: readonly CategoryAssessment[],
  requiresDeepAnalysis: boolean,
): Decision {
  return {
    status,
    matches,
    requiresDeepAnalysis,
    decidedBy: 'MODEL',
    requiresReview: false,
    reviewReason: null,
  };
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
      return delModelo('CONTRADICTED', [], false);
    }
    if (tier === 'FAST' && (accepted.length === 0 || ambiguous)) {
      return delModelo('AMBIGUOUS', accepted, true);
    }
    if (accepted.length > 1) {
      return delModelo('MULTI_MATCH', accepted, false);
    }
    if (accepted.length === 1 && !ambiguous) {
      return delModelo('MATCH', accepted, false);
    }
    return delModelo(ambiguous ? 'AMBIGUOUS' : 'UNKNOWN', [], false);
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
