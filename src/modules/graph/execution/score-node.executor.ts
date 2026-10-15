import { Injectable } from '@nestjs/common';
import { ExpressionEvaluator } from '../expression-evaluator';
import type { GraphNodeSnapshot } from '../graph.types';
import { evaluationContext, requireFiniteNumber, type NodeScope } from './execution-state';
import { OutputContractService } from './output-contract.service';

/** Evalúa los nodos `SCORE`: puntuación base más los componentes cuya condición se cumple. */
@Injectable()
export class ScoreNodeExecutor {
  constructor(
    private readonly expressions: ExpressionEvaluator,
    private readonly outputs: OutputContractService,
  ) {}

  execute(node: GraphNodeSnapshot, { compiled, variables, state, evaluation }: NodeScope): void {
    let score = requireFiniteNumber(
      node.config.baseScore ?? state.score ?? 0,
      node.key,
      'La puntuación base',
    );
    const components = Array.isArray(node.config.components) ? node.config.components : [];
    const applied: Array<{ conditionCode?: string; points: number }> = [];
    for (const raw of components) {
      const component = raw as Record<string, unknown>;
      const conditionCode = component.conditionCode ? String(component.conditionCode) : undefined;
      const condition = conditionCode ? compiled.conditions[conditionCode] : undefined;
      const matches = condition
        ? Boolean(
            this.expressions.evaluate(condition.expression, evaluationContext(variables, state)),
          )
        : true;
      if (matches) {
        const points = requireFiniteNumber(
          component.pointsExpression
            ? this.expressions.evaluate(
                component.pointsExpression,
                evaluationContext(variables, state),
              )
            : (component.points ?? 0),
          conditionCode ?? node.key,
          'El componente de puntuación',
        );
        score += points;
        applied.push({ conditionCode, points });
      }
    }
    if (node.config.scoreExpression) {
      score = requireFiniteNumber(
        this.expressions.evaluate(node.config.scoreExpression, evaluationContext(variables, state)),
        node.key,
        'La expresión de puntuación',
      );
    }
    state.score = score;
    this.outputs.publishOutput(compiled, state, 'score', score, false);
    evaluation.score = score;
    evaluation.appliedComponents = applied;
  }
}
