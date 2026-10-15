import { Injectable } from '@nestjs/common';
import { ExpressionEvaluator } from '../expression-evaluator';
import type { GraphEdgeSnapshot } from '../graph.types';
import { evaluationContext, type NodeScope } from './execution-state';

/** Elige la arista de salida de un nodo: la primera cuyas condiciones se cumplen, o la de respaldo. */
@Injectable()
export class EdgeSelector {
  constructor(private readonly expressions: ExpressionEvaluator) {}

  select(
    edges: GraphEdgeSnapshot[],
    { compiled, variables, state, evaluation }: NodeScope,
  ): GraphEdgeSnapshot | undefined {
    const results: Record<string, boolean> = {};
    for (const edge of edges.filter((candidate) => !candidate.default)) {
      const passed = [...edge.conditions]
        .sort((a, b) => a.order - b.order)
        .every((reference) => {
          const condition = compiled.conditions[reference.code];
          if (!condition) return false;
          return Boolean(
            this.expressions.evaluate(condition.expression, evaluationContext(variables, state)),
          );
        });
      results[edge.key] = passed;
      if (passed) {
        evaluation.edgeConditions = results;
        return edge;
      }
    }
    const fallback = edges.find((edge) => edge.default);
    if (fallback) results[fallback.key] = true;
    evaluation.edgeConditions = results;
    return fallback;
  }
}
